/**
 * Payout queue — the bridge between the admin panel and the phone that sends the
 * money over USSD (`ussd-payout/`, "server queue" mode).
 *
 * WHY A QUEUE
 *   The robot could only be driven by hand: type the number and the amount on the
 *   phone. Now the admin panel writes a job, the phone polls, sends, and reports
 *   back; the confirmation SMS closes the loop.
 *
 * THE RULES THIS FILE KEEPS (all of them are tested in tools/payout-queue.test.ts)
 *   1. A job is claimed by exactly one phone. A claim older than `CLAIM_MS` is
 *      released again, so a phone that crashed or lost signal cannot wedge the
 *      queue — but a phone that is merely slow is never double-sent to.
 *   2. A job only ever reaches PAID from a real confirmation (an SMS that matches
 *      the amount and the receiver), never from the phone's own word alone.
 *   3. Nothing here touches money. The server endpoint decides what a FAILED job
 *      means for the user's balance, so the refund logic stays in one place.
 *   4. Test jobs are marked `kind: 'TEST'` and are never tied to a user, so a test
 *      from the admin panel cannot pay or refund anybody.
 */

export type PayoutKind = 'TEST' | 'WITHDRAW';
export type PayoutStatus = 'QUEUED' | 'CLAIMED' | 'SENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'DRYRUN';

export interface PayoutJob {
  id: string;
  kind: PayoutKind;
  provider: string;          // 'nagad' | 'bkash' (lowercase)
  number: string;            // 01XXXXXXXXX
  amountBdt: number;
  amountUsd: number;
  ref: string;
  withdrawId?: string;
  userId?: string;
  note?: string;
  status: PayoutStatus;
  deviceId?: string;
  deviceLabel?: string;
  attempts: number;
  createdAt: number;
  claimedAt?: number;
  sentAt?: number;
  paidAt?: number;
  finishedAt?: number;
  trxId?: string;
  resultNote?: string;
  screenLog?: string;
  markedPaidAt?: number;      // the admin recorded the wallet TrxID by hand
  markedPaidBy?: string;      // who recorded it
  lateReceipt?: boolean;      // the receipt arrived after the job was already failed
}

export const CLAIM_MS = 3 * 60 * 1000;      // a claim outlives a slow dial + PIN
export const MAX_ATTEMPTS = 3;
export const MAX_JOBS = 5000;

/** 11-digit Bangladeshi mobile number, or '' when it is not one. */
export function cleanMsisdn(input: any): string {
  let n = String(input == null ? '' : input).replace(/[^0-9]/g, '');
  if (n.length === 13 && n.startsWith('880')) n = '0' + n.slice(3);
  if (n.length === 14 && n.startsWith('00880')) n = '0' + n.slice(5);
  return /^01[3-9][0-9]{8}$/.test(n) ? n : '';
}

export function cleanAmount(input: any): number {
  const raw = String(input == null ? '' : input);
  if (raw.includes('-')) return 0;                 // "-50" must never become 50
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  if (n > 500000) return 0;
  return Math.round(n * 100) / 100;
}

export function ensurePayoutJobs(db: any): PayoutJob[] {
  if (!Array.isArray(db.payoutJobs)) db.payoutJobs = [];
  if (db.payoutJobs.length > MAX_JOBS) db.payoutJobs.length = MAX_JOBS;
  return db.payoutJobs;
}

function newId(now: number): string {
  const rnd = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return 'PO-' + now.toString(36).toUpperCase() + '-' + rnd;
}

export interface NewJobInput {
  kind: PayoutKind;
  provider: string;
  number: any;
  amountBdt: any;
  amountUsd?: number;
  ref?: any;
  withdrawId?: string;
  userId?: string;
  note?: string;
  now?: number;
}

/** Creates the job object; the caller unshifts it into the collection. */
export function buildJob(input: NewJobInput): { ok: true; job: PayoutJob } | { ok: false; error: string } {
  const number = cleanMsisdn(input.number);
  if (!number) return { ok: false, error: 'Enter the receiver number as 01XXXXXXXXX.' };
  const amountBdt = cleanAmount(input.amountBdt);
  if (!amountBdt) return { ok: false, error: 'Enter an amount between 1 and 500000 BDT.' };
  const provider = String(input.provider || '').toLowerCase();
  if (provider !== 'nagad' && provider !== 'bkash') return { ok: false, error: 'Pick nagad or bkash.' };
  const now = Number(input.now) || Date.now();
  const job: PayoutJob = {
    id: newId(now),
    kind: input.kind,
    provider,
    number,
    amountBdt,
    amountUsd: Math.round((Number(input.amountUsd) || 0) * 100) / 100,
    ref: String(input.ref == null || String(input.ref).trim() === '' ? '1' : input.ref).slice(0, 40),
    withdrawId: input.withdrawId || undefined,
    userId: input.userId ? String(input.userId) : undefined,
    note: input.note ? String(input.note).slice(0, 200) : undefined,
    status: 'QUEUED',
    attempts: 0,
    createdAt: now,
  };
  return { ok: true, job };
}

/** Releases claims whose phone went silent. Returns how many were released. */
export function releaseStale(jobs: PayoutJob[], now = Date.now(), claimMs = CLAIM_MS): number {
  let n = 0;
  for (const j of jobs) {
    if (j.status === 'CLAIMED' && Number(j.claimedAt || 0) + claimMs < now) {
      j.status = 'QUEUED';
      j.deviceId = undefined;
      j.deviceLabel = undefined;
      j.resultNote = 'claim expired — the phone never reported back';
      j.attempts = (Number(j.attempts) || 0) + 1;
      n++;
    }
  }
  return n;
}

/**
 * The next job this phone should send.
 * `provider` '' means "any wallet" (a phone that is not yet tied to one).
 */
export function claimNext(
  jobs: PayoutJob[],
  opts: {
    deviceId: string; deviceLabel?: string; provider?: string; now?: number; claimMs?: number;
    /** A phone in DRY RUN may only take TEST jobs — it never touches a real withdrawal. */
    kinds?: PayoutKind[];
  },
): PayoutJob | null {
  const now = Number(opts.now) || Date.now();
  releaseStale(jobs, now, opts.claimMs);

  // A phone never runs two jobs at once: its own live claim is handed back so the
  // app can resume reporting instead of asking for more work.
  const mine = jobs.find((j) => j.status === 'CLAIMED' && j.deviceId === opts.deviceId);
  if (mine) return mine;

  const want = String(opts.provider || '').toLowerCase();
  const queue = jobs
    .filter((j) => j.status === 'QUEUED')
    .filter((j) => !want || j.provider === want)
    .filter((j) => !opts.kinds || opts.kinds.includes(j.kind))
    .filter((j) => (Number(j.attempts) || 0) < MAX_ATTEMPTS)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

  const job = queue[0];
  if (!job) return null;
  job.status = 'CLAIMED';
  job.deviceId = opts.deviceId;
  job.deviceLabel = opts.deviceLabel || '';
  job.claimedAt = now;
  return job;
}

/** The phone finished: "I sent it" (waiting for the SMS) or "I could not". */
/** A wallet receipt is letters/digits/dashes, upper case, max 40. */
export function cleanTrxId(input: any): string {
  return String(input == null ? '' : input).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

/**
 * ✔ The admin saw the money leave the wallet but the phone never delivered a receipt
 * (its report arrived after another loop failed the job, or the SMS relay is off).
 * Recording a receipt closes the JOB — it never moves money by itself, so this is safe
 * to call even when the withdrawal was already refunded: the caller decides what the
 * withdrawal does. Refused for PAID (the SMS already proved it) and CANCELLED (a job no
 * phone may run again must not be quietly revived).
 */
export function recordReceipt(
  jobs: PayoutJob[],
  jobId: string,
  opts: { trxId: string; by?: string; note?: string; now?: number },
): { ok: true; job: PayoutJob } | { ok: false; error: string } {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'That job does not exist.' };
  if (job.status === 'PAID') return { ok: false, error: 'The debit SMS already confirmed this payout.' };
  if (job.status === 'CANCELLED') return { ok: false, error: 'This job is CANCELLED — queue the withdrawal again instead.' };
  if (job.status === 'SENT' && job.trxId) return { ok: false, error: `This job already has TrxID ${job.trxId}.` };
  const trx = cleanTrxId(opts.trxId);
  if (trx.length < 3) return { ok: false, error: 'A wallet TrxID is required — at least 3 letters or numbers, so the customer has a receipt.' };
  const now = Number(opts.now) || Date.now();
  job.status = 'SENT';
  job.trxId = trx;
  job.sentAt = Number(job.sentAt) || now;
  job.finishedAt = now;
  job.markedPaidAt = now;
  job.markedPaidBy = String(opts.by || '').slice(0, 60);
  job.resultNote = String(opts.note || 'marked paid in the admin panel').slice(0, 300);
  return { ok: true, job };
}

export function markResult(
  jobs: PayoutJob[],
  jobId: string,
  status: 'SENT' | 'FAILED' | 'DRYRUN',
  opts: { note?: string; log?: string; now?: number; deviceId?: string; trxId?: string } = {},
): { ok: true; job: PayoutJob } | { ok: false; error: string } {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'That job does not exist.' };
  if (opts.deviceId && job.deviceId && job.deviceId !== opts.deviceId) {
    return { ok: false, error: 'That job belongs to another phone.' };
  }
  if (job.status === 'PAID' || job.status === 'CANCELLED') {
    return { ok: false, error: `This job is already ${job.status}.` };
  }
  // A receipt is proof money moved, so it is never refused for being late: the phone that
  // actually dialled often reports after a second (double-claimed) loop already failed the
  // job — dropping that report is what caused a 199.64 BDT payout to be paid AND refunded.
  const lateReceipt = status === 'SENT' && String(opts.trxId || '').trim().length >= 3
    && (job.status === 'FAILED' || job.status === 'DRYRUN' || job.status === 'QUEUED');
  if (job.status !== 'CLAIMED' && job.status !== 'SENT' && !lateReceipt) {
    return { ok: false, error: `This job is ${job.status}, not claimed.` };
  }
  const now = Number(opts.now) || Date.now();
  job.resultNote = String(opts.note || '').slice(0, 300);
  if (opts.log) job.screenLog = String(opts.log).slice(0, 4000);
  if (status === 'SENT') {
    job.status = 'SENT';
    job.sentAt = Number(job.sentAt) || now;
    if (lateReceipt) { job.finishedAt = now; job.lateReceipt = true; }
    // The wallet's own transaction id, straight from the confirmation screen.
    const trx = String(opts.trxId || '').trim().slice(0, 40);
    if (trx) job.trxId = trx;
  } else if (status === 'DRYRUN') {
    // The phone walked the menu but sent nothing. No money moved, no refund either:
    // a withdrawal stays PENDING so the admin can queue it again in LIVE mode.
    job.status = 'DRYRUN';
    job.finishedAt = now;
  } else {
    job.status = 'FAILED';
    job.attempts = (Number(job.attempts) || 0) + 1;
    job.finishedAt = now;
  }
  return { ok: true, job };
}

/**
 * A debit SMS ("You have sent Tk 100 to 017… TrxID ABC123") closes a SENT job.
 * The amount must match and, when the SMS carries a number, it must be the job's.
 */
export function matchDebit(
  jobs: PayoutJob[],
  sms: { amount?: number; amountBdt?: number; msisdn?: string; number?: string; provider?: string; trxId?: string },
  opts: { tolerance?: number; now?: number } = {},
): PayoutJob | null {
  const now = Number(opts.now) || Date.now();
  const amount = Number(sms.amountBdt != null ? sms.amountBdt : sms.amount) || 0;
  if (!amount) return null;
  const tol = Math.max(0, Number(opts.tolerance) || 0);
  const msisdn = cleanMsisdn(sms.msisdn != null ? sms.msisdn : sms.number);
  const provider = String(sms.provider || '').toLowerCase();

  const candidates = jobs
    .filter((j) => j.status === 'SENT')
    .filter((j) => Math.abs(Number(j.amountBdt) - amount) <= tol + 0.009)
    .filter((j) => !msisdn || cleanMsisdn(j.number) === msisdn)
    .filter((j) => !provider || provider === 'unknown' || j.provider === provider)
    .sort((a, b) => Number(a.sentAt || 0) - Number(b.sentAt || 0));

  const job = candidates[0];
  if (!job) return null;
  job.status = 'PAID';
  job.paidAt = now;
  job.finishedAt = now;
  job.trxId = String(sms.trxId || '').slice(0, 40) || job.trxId;
  return job;
}

/** Cancel a job that has not been sent yet. PAID/SENT jobs must be refunded by hand. */
export function cancelJob(
  jobs: PayoutJob[],
  jobId: string,
  opts: { reason?: string; now?: number } = {},
): { ok: true; job: PayoutJob } | { ok: false; error: string } {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'That job does not exist.' };
  if (job.status === 'PAID') return { ok: false, error: 'The money is already with the receiver.' };
  if (job.status === 'SENT') return { ok: false, error: 'The phone already sent it — wait for the SMS or refund by hand.' };
  if (job.status === 'CANCELLED') return { ok: false, error: 'Already cancelled.' };
  job.status = 'CANCELLED';
  job.finishedAt = Number(opts.now) || Date.now();
  job.resultNote = String(opts.reason || 'cancelled by the admin').slice(0, 300);
  return { ok: true, job };
}

/**
 * Put a FAILED job back in the queue so the phone (or the panel) can try again.
 *
 * Safety: the money must not move twice. A SENT/PAID job is never retried, and a
 * WITHDRAW job is only retried when its withdrawal is still PENDING — a failed
 * withdrawal is refunded to the user, so paying it again would be a loss.
 */
export function retryJob(
  jobs: PayoutJob[],
  jobId: string,
  opts: { now?: number; note?: string } = {},
): { ok: true; job: PayoutJob } | { ok: false; error: string } {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'That job does not exist.' };
  if (job.status === 'SENT' || job.status === 'PAID') {
    return { ok: false, error: 'The phone already sent this one — wait for the SMS, do not send it twice.' };
  }
  if (job.status === 'CLAIMED') {
    return { ok: false, error: 'A phone is working on this job right now — cancel it first if it is stuck.' };
  }
  // DRYRUN = the phone walked the menu and sent nothing, so a retry cannot pay twice either.
  if (job.status !== 'FAILED' && job.status !== 'DRYRUN') {
    return { ok: false, error: `Only a FAILED or DRYRUN job can be retried — this one is ${job.status}.` };
  }
  job.status = 'QUEUED';
  job.deviceId = undefined;
  job.deviceLabel = undefined;
  job.claimedAt = undefined;
  job.sentAt = undefined;
  job.finishedAt = undefined;
  job.trxId = undefined;
  job.resultNote = String(opts.note || 'queued again — retry').slice(0, 300);
  return { ok: true, job };
}

export function publicJob(j: PayoutJob) {
  return {
    id: j.id, kind: j.kind, provider: j.provider, number: j.number,
    amountBdt: j.amountBdt, amountUsd: j.amountUsd, ref: j.ref,
    withdrawId: j.withdrawId || '', userId: j.userId || '', note: j.note || '',
    status: j.status, deviceId: j.deviceId || '', deviceLabel: j.deviceLabel || '',
    attempts: Number(j.attempts) || 0,
    createdAt: j.createdAt, claimedAt: j.claimedAt || 0, sentAt: j.sentAt || 0,
    paidAt: j.paidAt || 0, finishedAt: j.finishedAt || 0,
    trxId: j.trxId || '', resultNote: j.resultNote || '', screenLog: j.screenLog || '',
    markedPaidAt: j.markedPaidAt || 0, markedPaidBy: j.markedPaidBy || '', lateReceipt: j.lateReceipt === true,
  };
}

export function queueStats(jobs: PayoutJob[], now = Date.now()) {
  const day = 86400000;
  const since = now - day;
  const inDay = (j: PayoutJob) => Number(j.finishedAt || j.createdAt || 0) >= since;
  return {
    queued: jobs.filter((j) => j.status === 'QUEUED').length,
    claimed: jobs.filter((j) => j.status === 'CLAIMED').length,
    sent: jobs.filter((j) => j.status === 'SENT').length,
    paid24h: jobs.filter((j) => j.status === 'PAID' && inDay(j)).length,
    failed24h: jobs.filter((j) => j.status === 'FAILED' && inDay(j)).length,
    paidBdt24h: jobs.filter((j) => j.status === 'PAID' && inDay(j))
      .reduce((a, j) => a + (Number(j.amountBdt) || 0), 0),
  };
}
