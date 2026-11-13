/**
 * Plain-JavaScript tests for payout-queue.ts — run with:
 *
 *   npx tsx tools/payout-queue.test.ts
 *
 * No database, no HTTP: every rule that decides who sends money, and whether a job
 * is really paid, is exercised here first.
 */
import {
  buildJob, claimNext, markResult, matchDebit, cancelJob, releaseStale, retryJob,
  recordReceipt, cleanTrxId,
  queueStats, cleanMsisdn, cleanAmount, CLAIM_MS, type PayoutJob,
} from '../payout-queue';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got: any = '') => {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  [' + got + ']'); }
};

const jobs: PayoutJob[] = [];
const make = (over: any = {}) => {
  const built = buildJob({ kind: 'TEST', provider: 'nagad', number: '01780240277', amountBdt: 100, now: 1000, ...over });
  if (!built.ok) throw new Error(built.error);
  jobs.push(built.job);
  return built.job;
};

// ── input cleaning ───────────────────────────────────────────────────────────
check('number: spaces and +880 are cleaned', cleanMsisdn('+880 1780-240277') === '01780240277', cleanMsisdn('+880 1780-240277'));
check('number: 13-digit 880 form becomes 01…', cleanMsisdn('8801780240277') === '01780240277', cleanMsisdn('8801780240277'));
check('number: a landline is refused', cleanMsisdn('029998887') === '', cleanMsisdn('029998887'));
check('amount: "Tk 1,000" becomes 1000', cleanAmount('Tk 1,000') === 1000, cleanAmount('Tk 1,000'));
check('amount: 0 is refused', cleanAmount('0') === 0, cleanAmount('0'));
check('amount: negative is refused', cleanAmount('-50') === 0, cleanAmount('-50'));
check('amount: over the cap is refused', cleanAmount('999999') === 0, cleanAmount('999999'));

// ── building a job ───────────────────────────────────────────────────────────
const bad = buildJob({ kind: 'TEST', provider: 'nagad', number: '12345', amountBdt: 100 });
check('a bad number never becomes a job', !bad.ok, bad.ok ? 'accepted' : 'refused');
const badProvider = buildJob({ kind: 'TEST', provider: 'rocket', number: '01780240277', amountBdt: 100 });
check('an unknown wallet never becomes a job', !badProvider.ok, badProvider.ok ? 'accepted' : 'refused');

const j1 = make();
check('a good job starts QUEUED', j1.status === 'QUEUED' && j1.kind === 'TEST', j1.status);
check('a TEST job carries no user', !j1.userId, j1.userId);
check('the reference defaults to 1', j1.ref === '1', j1.ref);

// ── claiming ─────────────────────────────────────────────────────────────────
const c1 = claimNext(jobs, { deviceId: 'D1', provider: 'nagad', now: 2000 });
check('the phone claims the queued job', !!c1 && c1.id === j1.id && c1.status === 'CLAIMED', c1 && c1.id);
check('a second phone gets nothing while the first holds it',
  claimNext(jobs, { deviceId: 'D2', provider: 'nagad', now: 2100 }) === null, 'handed out twice');
check('the same phone is handed its own live claim again',
  (claimNext(jobs, { deviceId: 'D1', provider: 'nagad', now: 2200 }) || ({} as any)).id === j1.id, 'lost its job');

const j2 = make({ provider: 'bkash', number: '01812345678', amountBdt: 50 });
check('a nagad phone never claims a bKash job',
  claimNext(jobs, { deviceId: 'D3', provider: 'nagad', now: 2300 }) === null, 'cross-wallet claim');
check('a bKash phone gets the bKash job',
  (claimNext(jobs, { deviceId: 'D4', provider: 'bkash', now: 2400 }) || ({} as any)).id === j2.id, 'no claim');

// ── a phone that went silent must not wedge the queue ────────────────────────
check('a fresh claim is NOT released', releaseStale(jobs, 2500) === 0, 'released too early');
check('only the claim that is really expired is released',
  releaseStale(jobs, 2000 + CLAIM_MS + 1) === 1, 'released the wrong number');
check('both expired claims are released',
  releaseStale(jobs, 2400 + CLAIM_MS + 1) === 1, 'second claim stuck');
check('the released jobs are queued again', jobs.filter((j) => j.status === 'QUEUED').length === 2, 'status');
const c2 = claimNext(jobs, { deviceId: 'D5', provider: 'nagad', now: 2400 + CLAIM_MS + 2 });
check('another phone can pick up the released job', !!c2 && c2.id === j1.id, c2 && c2.id);

// ── reporting back ───────────────────────────────────────────────────────────
// the bKash job goes back to its own phone, so it stops being queued
const reClaimed = claimNext(jobs, { deviceId: 'D4', provider: 'bkash', now: 2400 + CLAIM_MS + 3 });
check('the released bKash job goes back to the bKash phone', !!reClaimed && reClaimed.id === j2.id, reClaimed && reClaimed.id);

const wrongPhone = markResult(jobs, j1.id, 'SENT', { deviceId: 'D9' });
check('a phone cannot report on a job it does not hold', !wrongPhone.ok, wrongPhone.ok ? 'allowed' : 'refused');
const sent = markResult(jobs, j1.id, 'SENT', { deviceId: 'D5', note: 'PIN sent', now: 400000 });
check('"sent" moves the job to SENT (not PAID)', sent.ok && j1.status === 'SENT', j1.status);
check('SENT alone never pays the user', j1.status !== 'PAID', j1.status);

// ── the confirmation SMS closes the loop ─────────────────────────────────────
check('an SMS with the wrong amount does not close it',
  matchDebit(jobs, { amount: 999, msisdn: '01780240277', trxId: 'X1' }) === null, 'matched a wrong amount');
check('an SMS for another number does not close it',
  matchDebit(jobs, { amount: 100, msisdn: '01899999999', trxId: 'X1' }) === null, 'matched a wrong number');
const paid = matchDebit(jobs, { amount: 100, msisdn: '01780240277', provider: 'nagad', trxId: 'ABC123', }, { now: 401000 });
check('the matching SMS marks the job PAID', !!paid && j1.status === 'PAID', j1.status);
check('the TrxID is stored on the job', j1.trxId === 'ABC123', j1.trxId);
check('a paid job cannot be cancelled',
  cancelJob(jobs, j1.id).ok === false, 'cancelled a paid job');
check('a paid job cannot be re-paid by a second SMS',
  matchDebit(jobs, { amount: 100, msisdn: '01780240277', trxId: 'ABC999' }) === null, 'paid twice');

// ── failure + cancel ─────────────────────────────────────────────────────────
const j3 = make({ kind: 'WITHDRAW', amountBdt: 500, amountUsd: 4.2, userId: 'U1', withdrawId: 'WDR-1' });
claimNext(jobs, { deviceId: 'D6', provider: 'nagad', now: 5000 });
const failed = markResult(jobs, j3.id, 'FAILED', { deviceId: 'D6', note: 'Invalid account number', now: 5100 });
check('a failed job is marked FAILED', failed.ok && j3.status === 'FAILED', j3.status);
check('a failed job counts an attempt', j3.attempts === 1, String(j3.attempts));
check('a FAILED job is never paid by a stray SMS',
  matchDebit(jobs, { amount: 500, msisdn: '01780240277' }) === null, 'failed job paid');

const j4 = make({ kind: 'WITHDRAW', amountBdt: 700, userId: 'U2' });
const cancelled = cancelJob(jobs, j4.id, { reason: 'owner stop', now: 6000 });
check('an unsent job can be cancelled', cancelled.ok && j4.status === 'CANCELLED', j4.status);
check('a cancelled job is not claimable',
  claimNext(jobs, { deviceId: 'D7', provider: 'nagad', now: 6100 }) === null, 'handed out');

// ── stats ────────────────────────────────────────────────────────────────────
const st = queueStats(jobs, 7000);
check('stats count the queue', st.queued === 0 && st.paid24h === 1 && st.failed24h === 1,
  JSON.stringify(st));
check('stats add up the paid BDT', st.paidBdt24h === 100, String(st.paidBdt24h));

// ── dry-run phones only ever see TEST jobs ──────────────────────────────────
const real = make({ kind: 'WITHDRAW', amountBdt: 250, userId: 'U9' });
const dry = claimNext(jobs, { deviceId: 'DF', provider: 'nagad', now: 9000, kinds: ['TEST'] });
check('a dry-run phone never claims a WITHDRAW job', !dry || dry.kind === 'TEST', dry && dry.kind);
const live = claimNext(jobs, { deviceId: 'DL', provider: 'nagad', now: 9100 });
check('a live phone does get the withdrawal', !!live && live.id === real.id, live && live.kind);
const dryRunResult = markResult(jobs, real.id, 'DRYRUN', { deviceId: 'DL', note: 'dry run', now: 9200 });
check('a dry run ends the job without paying it',
  dryRunResult.ok && real.status === 'DRYRUN' && !real.paidAt, real.status);
check('a dry run is not a payment', matchDebit(jobs, { amount: 250, msisdn: '01780240277' }) === null, 'paid a dry run');

// ── a phone that is not tied to a wallet takes any job ───────────────────────
const j5 = make({ provider: 'bkash', number: '01812345678', amountBdt: 30 });
const anyPhone = claimNext(jobs, { deviceId: 'D8', provider: '', now: 8000 });
check('a phone with no wallet set takes the oldest job', !!anyPhone && anyPhone.id === j5.id, anyPhone && anyPhone.id);

// ── ↻ RETRY: only a FAILED job, and never one that already paid out ─────────
const rj = make({ kind: 'TEST', amountBdt: 120 });
const claimed = claimNext(jobs, { deviceId: 'DR', provider: rj.provider, now: 9500 });
check('retry test setup: the job was claimed', !!claimed && claimed.id === rj.id, claimed && claimed.id);
check('a job still being worked on cannot be retried', !retryJob(jobs, rj.id).ok, 'retried a CLAIMED job');
markResult(jobs, rj.id, 'FAILED', { deviceId: 'DR', note: 'menu never appeared', now: 9600 });
const back = retryJob(jobs, rj.id, { note: 'retry' });
check('a FAILED job goes back to the queue', back.ok && rj.status === 'QUEUED', rj.status);
check('the retry forgets the old phone', back.ok && !rj.deviceId && !rj.claimedAt, rj.deviceId);
check('the retry keeps the attempt count', Number(rj.attempts) >= 1, String(rj.attempts));
check('the retried job can be claimed again',
  (claimNext(jobs, { deviceId: 'DR2', provider: rj.provider, now: 9700 }) || {}).id === rj.id, 'not claimable');

const sentJob = make({ kind: 'TEST', amountBdt: 70 });
claimNext(jobs, { deviceId: 'DS', provider: sentJob.provider, now: 9800 });
markResult(jobs, sentJob.id, 'SENT', { deviceId: 'DS', now: 9900 });
const sentRetry = retryJob(jobs, sentJob.id);
check('a SENT job is never retried (no double payment)', !sentRetry.ok && sentJob.status === 'SENT', sentJob.status);

const retryCancel = make({ kind: 'TEST', amountBdt: 55 });
cancelJob(jobs, retryCancel.id, { reason: 'test' });
check('a CANCELLED job is not retried', !retryJob(jobs, retryCancel.id).ok, retryCancel.status);
check('an unknown job is not retried', !retryJob(jobs, 'PAY-NOPE').ok, 'no error');

// ── ✔ THE RECEIPT IS THE ONLY PROOF: late reports and hand-recorded TrxIDs ────
const claimByHand = (j: PayoutJob, dev: string, now: number) => {
  j.status = 'CLAIMED'; j.deviceId = dev; j.claimedAt = now; return j;
};

const late = make({ kind: 'TEST', amountBdt: 200 });
claimByHand(late, 'DL', 10100);
markResult(jobs, late.id, 'FAILED', { deviceId: 'DL', note: 'another run is still in progress', now: 10200 });
const lateOk = markResult(jobs, late.id, 'SENT', { deviceId: 'DL', trxId: '76BA500O', now: 10300 });
check('a SENT report with a TrxID lands on a FAILED job (the 2026-11-13 loss)', lateOk.ok && late.status === 'SENT', late.status);
check('the late receipt is flagged so the audit trail can see it', late.lateReceipt === true, String(late.lateReceipt));
check('the late receipt keeps the wallet TrxID', late.trxId === '76BA500O', late.trxId);
check('a late receipt closes the job on time', Number(late.finishedAt) === 10300, String(late.finishedAt));
const lateNoTrx = make({ kind: 'TEST', amountBdt: 210 });
claimByHand(lateNoTrx, 'DL', 10350);
markResult(jobs, lateNoTrx.id, 'FAILED', { deviceId: 'DL', note: 'no reason', now: 10400 });
check('a SENT report with NO TrxID cannot resurrect a FAILED job',
  !markResult(jobs, lateNoTrx.id, 'SENT', { deviceId: 'DL', now: 10500 }).ok, 'accepted');
check('…and the job stays FAILED, so nothing is proved paid', lateNoTrx.status === 'FAILED', lateNoTrx.status);

const rr = make({ kind: 'TEST', amountBdt: 220 });
claimByHand(rr, 'DM', 10600);
markResult(jobs, rr.id, 'FAILED', { deviceId: 'DM', note: 'the report never arrived', now: 10700 });
check('mark paid refuses a blank TrxID (the customer needs a receipt)', !recordReceipt(jobs, rr.id, { trxId: '   ' }).ok, 'accepted');
check('mark paid refuses a TrxID shorter than 3 characters', !recordReceipt(jobs, rr.id, { trxId: 'AB' }).ok, 'accepted');
check('…and the job is untouched by a refused receipt', rr.status === 'FAILED', rr.status);
const rec = recordReceipt(jobs, rr.id, { trxId: ' 76ba-500o ', by: 'admin:root', now: 10800 });
check('the admin can record the wallet TrxID by hand', rec.ok && rr.status === 'SENT', rr.status);
check('the recorded TrxID is cleaned to one form', rr.trxId === '76BA-500O', rr.trxId);
check('the receipt says who recorded it', rec.ok && rr.markedPaidBy === 'admin:root', String(rr.markedPaidBy));
check('the receipt carries the time it was recorded', Number(rr.markedPaidAt) === 10800, String(rr.markedPaidAt));
check('a job paid by hand is never retried again', !retryJob(jobs, rr.id).ok, rr.status);
check('a second hand receipt on the same job is refused', !recordReceipt(jobs, rr.id, { trxId: 'OTHER123' }).ok, 'accepted');
const rrCancel = make({ kind: 'TEST', amountBdt: 230 });
claimByHand(rrCancel, 'DM', 10850);
markResult(jobs, rrCancel.id, 'FAILED', { deviceId: 'DM', now: 10900 });
cancelJob(jobs, rrCancel.id, { reason: 'refunded from the payout panel' });
check('a refunded/cancelled job cannot be marked paid', !recordReceipt(jobs, rrCancel.id, { trxId: 'XYZ123' }).ok, rrCancel.status);

// ── DRYRUN is retryable: the phone walked the menu and sent nothing ────────────
const dr = make({ kind: 'TEST', amountBdt: 240 });
claimByHand(dr, 'DD', 11000);
markResult(jobs, dr.id, 'DRYRUN', { deviceId: 'DD', note: 'the wallet never saw this job', now: 11100 });
check('a DRYRUN job can be queued again', retryJob(jobs, dr.id, { note: 'retry live' }).ok && dr.status === 'QUEUED', dr.status);
check('a DRYRUN job burns no attempt (nothing was tried and failed)', Number(dr.attempts) === 0, String(dr.attempts));

// ── the receipt text is cleaned before anything stores it ──────────────────────
check('cleanTrxId keeps only receipt-shaped characters', cleanTrxId(' 76ba500o! ') === '76BA500O', cleanTrxId(' 76ba500o! '));
check('cleanTrxId caps a long id at 40 characters', cleanTrxId('x'.repeat(90)).length === 40, String(cleanTrxId('x'.repeat(90)).length));

console.log('\n' + pass + ' pass / ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
