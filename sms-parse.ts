/**
 * sms-parse.ts — read a bKash / Nagad "money received" SMS.
 *
 * The relay app on the phone that holds the receiving SIM forwards the raw SMS
 * text; this module turns it into { provider, direction, amount, trxId, ... }.
 * It is deliberately tolerant: bKash and Nagad change their wording, mix English
 * and Bangla, use ৳ / Tk / টাকা, and sometimes omit the label before the TrxID.
 *
 * Pure function, no I/O — unit-tested by tools/sms-check.mjs.
 */

export type SmsDirection = 'CREDIT' | 'DEBIT' | 'UNKNOWN';

export interface ParsedSms {
  ok: boolean;
  reason?: string;
  provider: 'BKASH' | 'NAGAD' | 'UNKNOWN';
  direction: SmsDirection;
  /** Amount in the SMS currency (BDT for bKash/Nagad). */
  amount: number;
  trxId: string;
  senderMsisdn: string;
  receiverMsisdn: string;
  /** true when the text is an OTP / promo / balance notice rather than a transfer. */
  noise: boolean;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const i = BN_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

function normalizeText(raw: string): string {
  return normalizeDigits(String(raw || ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[৳]/g, ' Tk ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(s: string): number {
  const n = Number(String(s || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:tk|bdt|taka|টাকা)\s*\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,          // "Tk 500.00" / "টাকা ৫০০"
  /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:tk|bdt|taka|টাকা)/i,                 // "500.00 Tk"
  /amount\s*[:=]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,                       // "Amount: 500"
  /(?:received|credited|জমা)\s*(?:tk|bdt)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
];

const TRX_PATTERNS: RegExp[] = [
  /(?:trx|txn|transaction|trans)\s*(?:id|no|number|#)\s*[:#\-]?\s*([a-z0-9]{6,24})/i,
  /(?:ট্রানজেকশন|ট্রান্সএকশন|লেনদেন)\s*(?:আইডি|নম্বর)\s*[:#\-]?\s*([a-z0-9]{6,24})/i,
  /(?:ref|reference|rrn)\s*(?:no|number|#)?\s*[:#\-]?\s*([a-z0-9]{6,24})/i,
  /\b([a-z]{0,3}[0-9]{2}[a-z0-9]{6,14})\b/i                                   // bare id such as "9A1B2C3D4E"
];

const CREDIT_WORDS = /(received|credited|cash\s*in|deposited|পেয়েছেন|পেয়েছি|জমা\s*হয়েছে|ক্যাশ\s*ইন|গৃহীত)/i;
const DEBIT_WORDS = /(sent|paid|debited|withdrawn|পাঠিয়েছেন|দিয়েছেন|কাটা\s*হয়েছে|কেটে\s*নেওয়া|উত্তোলন)/i;
const NOISE_WORDS = /(otp|one[-\s]*time\s*(password|pin)|verification\s*code|do not share|পিন\s*কোড|গোপন\s*কোড|কেউ\s*জানতে)/i;

export function parseSms(rawBody: string, senderHint = ''): ParsedSms {
  const text = normalizeText(rawBody);
  const hint = String(senderHint || '');
  const empty: ParsedSms = {
    ok: false, provider: 'UNKNOWN', direction: 'UNKNOWN', amount: 0,
    trxId: '', senderMsisdn: '', receiverMsisdn: '', noise: false,
  };
  if (!text) return { ...empty, reason: 'empty message' };

  const provider: ParsedSms['provider'] =
    /bkash|বিকাশ/i.test(text) || /bkash/i.test(hint) ? 'BKASH'
      : /nagad|নগদ/i.test(text) || /nagad/i.test(hint) ? 'NAGAD'
        : 'UNKNOWN';

  const noise = NOISE_WORDS.test(text);
  const direction: SmsDirection =
    CREDIT_WORDS.test(text) ? 'CREDIT'
      : DEBIT_WORDS.test(text) ? 'DEBIT'
        : 'UNKNOWN';

  let amount = 0;
  for (const rx of AMOUNT_PATTERNS) {
    const m = text.match(rx);
    if (m) { amount = toNumber(m[1]); if (amount > 0) break; }
  }

  let trxId = '';
  for (const rx of TRX_PATTERNS) {
    const m = text.match(rx);
    if (!m) continue;
    const candidate = String(m[1] || '').toUpperCase();
    // a bare 10-13 digit number is almost always an amount or a phone number
    if (!/(trx|txn|transaction|trans|ref|rrn|ট্রান)/i.test(m[0]) && /^[0-9]{10,}$/.test(candidate)) continue;
    trxId = candidate;
    break;
  }

  const msisdns = Array.from(text.matchAll(/(?:\+?88)?(01[3-9][0-9]{8})/g)).map((m) => m[1]);
  const fromMatch = text.match(/(?:from|প্রেরক)\s*[:\-]?\s*(?:\+?88)?(01[3-9][0-9]{8})/i);
  const toMatch = text.match(/(?:to|প্রাপক)\s*[:\-]?\s*(?:\+?88)?(01[3-9][0-9]{8})/i);

  let reason = '';
  if (noise) reason = 'notifications/OTP message — ignored';
  else if (direction !== 'CREDIT') reason = 'not a "money received" message';
  else if (!amount) reason = 'no amount found';
  else if (!trxId) reason = 'no transaction id found';

  return {
    ok: !reason,
    reason: reason || undefined,
    provider,
    direction,
    amount,
    trxId,
    senderMsisdn: (fromMatch && fromMatch[1]) || msisdns[0] || '',
    receiverMsisdn: (toMatch && toMatch[1]) || '',
    noise,
  };
}

/** Normalise a user-typed TrxID / reference so "trx-9a1b2c" == "9A1B2C". */
export function normalizeTrxId(raw: any): string {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
