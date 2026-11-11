/**
 * Deposit / withdrawal payment methods — configuration, defaults and validation.
 *
 * Kept out of server.ts so the rules stay readable and testable. Nothing here
 * touches balances: the routes do that, server-side, after these checks pass.
 *
 * Storage: the project has no SQL layer — state lives in the JSON database
 * (`db.paymentMethods`, `db.depositRequests`, `db.withdrawRequests`). That keeps
 * the new feature inside the existing persistence and backup path; no migration
 * framework is introduced.
 */

export type PaymentCategory = 'EWALLET' | 'BANK' | 'CRYPTO' | 'AGENT';

export const PAYMENT_CATEGORIES: Array<{ id: PaymentCategory; label: string; icon: string }> = [
  { id: 'EWALLET', label: 'E-Wallets', icon: '📱' },
  { id: 'BANK', label: 'Internet Banking', icon: '🏦' },
  { id: 'CRYPTO', label: 'Cryptocurrency', icon: '₿' },
  { id: 'AGENT', label: 'Telegram Agent', icon: '💬' },
];

export type PaymentMethod = {
  id: string;
  name: string;
  logo: string;                 // emoji or short label shown in the card
  category: PaymentCategory;
  enabled: boolean;
  recommended: boolean;
  recommendedOrder: number;
  order: number;

  depositEnabled: boolean;
  withdrawEnabled: boolean;

  // audience switches — a method can be open to users and closed to agents
  userDeposit: boolean;
  userWithdraw: boolean;
  agentDeposit: boolean;
  agentWithdraw: boolean;

  /** ['*'] or ISO codes; an empty list means "not configured yet" */
  currencies: string[];
  countries: string[];          // ISO-2; empty = no restriction

  minDeposit: number;           // USD
  maxDeposit: number;
  minWithdraw: number;
  maxWithdraw: number;
  depositFeePercent: number;
  withdrawFeePercent: number;

  processingTime: string;
  maintenance: boolean;
  maintenanceMessage: string;

  /** where the money goes for a deposit (the user-facing instruction block) */
  accountName: string;
  accountNumber: string;
  instructions: string;

  createdAt: number;
  updatedAt: number;
};

const now = () => Date.now();

function method(partial: Partial<PaymentMethod> & { id: string; name: string; category: PaymentCategory }): PaymentMethod {
  return {
    logo: '💳',
    enabled: true,
    recommended: false,
    recommendedOrder: 0,
    order: 100,
    depositEnabled: true,
    withdrawEnabled: true,
    userDeposit: true,
    userWithdraw: true,
    agentDeposit: true,
    agentWithdraw: true,
    currencies: ['*'],
    countries: [],
    minDeposit: 1,
    maxDeposit: 100000,
    minWithdraw: 1,
    maxWithdraw: 100000,
    depositFeePercent: 0,
    withdrawFeePercent: 0,
    processingTime: 'Usually within 5–30 minutes',
    maintenance: false,
    maintenanceMessage: '',
    accountName: '',
    accountNumber: '',
    instructions: '',
    createdAt: now(),
    updatedAt: now(),
    ...partial,
  };
}

/**
 * Seed catalogue. The account numbers are deliberately empty: an admin has to
 * paste the real receiving account before the method can take a deposit. Until
 * then the flow refuses to submit, so no user sends money to a placeholder.
 */
export function defaultPaymentMethods(): PaymentMethod[] {
  return [
    method({ id: 'PM-BKASH', countries: ['BD'], name: 'bKash', logo: '🟥', category: 'EWALLET', recommended: true, recommendedOrder: 1, order: 10 }),
    method({ id: 'PM-NAGAD', countries: ['BD'], name: 'Nagad', logo: '🟧', category: 'EWALLET', recommended: true, recommendedOrder: 2, order: 20 }),
    method({ id: 'PM-ROCKET', countries: ['BD'], name: 'Rocket', logo: '🟪', category: 'EWALLET', recommended: true, recommendedOrder: 3, order: 30 }),
    method({ id: 'PM-UPAY', countries: ['BD'], name: 'Upay', logo: '🟦', category: 'EWALLET', recommended: true, recommendedOrder: 4, order: 40 }),
    method({ id: 'PM-NAGAD-FAST', countries: ['BD'], name: 'Fast Nagad', logo: '⚡', category: 'EWALLET', order: 50, processingTime: 'Usually within 2 minutes' }),
    method({ id: 'PM-NAGAD-LOCAL', countries: ['BD'], name: 'The Local Nagad', logo: '🏪', category: 'EWALLET', order: 60 }),
    method({ id: 'PM-BKASH-LOCAL', countries: ['BD'], name: 'The Local bKash', logo: '🏬', category: 'EWALLET', order: 70 }),
    method({ id: 'PM-BKASH-LIGHT', countries: ['BD'], name: 'LightSpeed bKash', logo: '🚀', category: 'EWALLET', order: 80 }),
    method({ id: 'PM-NAGAD-LIGHT', countries: ['BD'], name: 'LightSpeed Nagad', logo: '🛰️', category: 'EWALLET', order: 90 }),
    method({ id: 'PM-CELLFIN', countries: ['BD'], name: 'CellFin', logo: '🟩', category: 'EWALLET', order: 100 }),
    method({ id: 'PM-NEXUSPAY', countries: ['BD'], name: 'NexusPay', logo: '🔷', category: 'BANK', order: 10 }),
    method({ id: 'PM-BANK', countries: ['BD'], name: 'Bank Transfer', logo: '🏦', category: 'BANK', order: 20, processingTime: '1–2 business days' }),
    method({ id: 'PM-CELLFIN-BANK', countries: ['BD'], name: 'CellFin Internet Banking', logo: '🌐', category: 'BANK', order: 30 }),
    method({ id: 'PM-USDT-TRC20', name: 'Tether (USDT) · TRC20', logo: '💠', category: 'CRYPTO', order: 10, currencies: ['*'] }),
    method({ id: 'PM-USDT-BEP20', name: 'Tether (USDT) · BSC', logo: '🟡', category: 'CRYPTO', order: 20 }),
    method({ id: 'PM-USDT-ERC20', name: 'Tether (USDT) · ERC20', logo: '🔵', category: 'CRYPTO', order: 30 }),
    method({ id: 'PM-USDT-TON', name: 'Tether (USDT) · TON', logo: '💎', category: 'CRYPTO', order: 40 }),
    method({ id: 'PM-TRX', name: 'TRON (TRX)', logo: '🔴', category: 'CRYPTO', order: 50 }),
    method({ id: 'PM-ETH', name: 'Ethereum (ETH)', logo: '⟠', category: 'CRYPTO', order: 60 }),
    method({
      id: 'PM-TG-AGENT', name: 'Telegram Agent', logo: '💬', category: 'AGENT',
      recommended: true, recommendedOrder: 5, order: 10,
      processingTime: 'Cash handover, minutes',
      instructions: 'Tap the card to open the agent payout screen and pick an agent.',
    }),
  ];
}


/**
 * One-time country migration (owner spec 2026-11-10: a user only ever sees the
 * local methods of the country their currency belongs to).
 *
 * The first catalogue was seeded with `countries: []`, i.e. "everywhere", which
 * made bKash/Nagad appear to a user in the United States. The seed rows are
 * tagged with their real country once; a method the admin later edits is left
 * exactly as configured, and the flag stops the migration from ever running
 * again (so clearing a country on purpose is respected).
 */
const BD_SEEDED_METHODS = [
  'PM-BKASH', 'PM-NAGAD', 'PM-ROCKET', 'PM-UPAY', 'PM-NAGAD-FAST', 'PM-NAGAD-LOCAL',
  'PM-BKASH-LOCAL', 'PM-BKASH-LIGHT', 'PM-NAGAD-LIGHT', 'PM-CELLFIN', 'PM-NEXUSPAY',
  'PM-BANK', 'PM-CELLFIN-BANK'
];

export function migrateDefaultCountries(db: any): void {
  try {
    if (!db || typeof db !== 'object') return;
    if (db.countriesMigratedAt) return;
    for (const m of (db.paymentMethods || [])) {
      if (!BD_SEEDED_METHODS.includes(String(m.id))) continue;
      if (Array.isArray(m.countries) && m.countries.length > 0) continue;
      m.countries = ['BD'];
      m.updatedAt = Date.now();
    }
    db.countriesMigratedAt = Date.now();
  } catch { /* never block a request */ }
}

/** Adds the new collections to an existing database without touching anything else. */
export function ensurePaymentCollections(db: any): any {
  if (!Array.isArray(db.paymentMethods) || db.paymentMethods.length === 0) {
    db.paymentMethods = defaultPaymentMethods();
  }
  migrateDefaultCountries(db);
  if (!Array.isArray(db.depositRequests)) db.depositRequests = [];
  if (!Array.isArray(db.withdrawRequests)) db.withdrawRequests = [];
  if (!db.paymentMeta || typeof db.paymentMeta !== 'object') db.paymentMeta = { version: 1 };
  return db;
}

export function findMethod(db: any, id: string): PaymentMethod | undefined {
  return (db.paymentMethods || []).find((m: PaymentMethod) => String(m.id) === String(id));
}

/** True when the method accepts this ISO currency. `*` means "any". */
export function acceptsCurrency(m: PaymentMethod, code: string): boolean {
  const list = Array.isArray(m.currencies) ? m.currencies : ['*'];
  if (list.length === 0) return false;                  // nothing configured
  return list.includes('*') || list.map((c) => String(c).toUpperCase()).includes(String(code || '').toUpperCase());
}

export function countryAllowed(m: PaymentMethod, country: string): boolean {
  const list = Array.isArray(m.countries) ? m.countries : [];
  if (list.length === 0) return true;
  if (!country) return false;
  return list.map((c) => String(c).toUpperCase()).includes(String(country).toUpperCase());
}

export type Mode = 'deposit' | 'withdraw';
export type Role = 'user' | 'agent';

export type Availability = { ok: true } | { ok: false; reason: string };

/**
 * One place that decides whether a method can be used — the client only renders
 * what this allows, and every request is re-checked on the server.
 */
export function methodAvailable(m: PaymentMethod, mode: Mode, role: Role, currency: string, country?: string): Availability {
  if (!m || !m.enabled) return { ok: false, reason: 'This method is turned off.' };
  if (m.maintenance) return { ok: false, reason: m.maintenanceMessage || 'This method is under maintenance.' };
  const enabled = mode === 'deposit' ? m.depositEnabled : m.withdrawEnabled;
  if (!enabled) return { ok: false, reason: `This method is not accepting ${mode}s right now.` };
  const audience = mode === 'deposit'
    ? (role === 'agent' ? m.agentDeposit : m.userDeposit)
    : (role === 'agent' ? m.agentWithdraw : m.userWithdraw);
  if (!audience) return { ok: false, reason: `This method is not available for ${role} ${mode}s.` };
  if (!acceptsCurrency(m, currency)) return { ok: false, reason: `This method does not accept ${currency}.` };
  if (!countryAllowed(m, String(country || ''))) return { ok: false, reason: 'This method is not available in your country.' };
  if (mode === 'deposit' && m.category !== 'AGENT' && !String(m.accountNumber || '').trim()) {
    return { ok: false, reason: 'This method is not configured yet. Please pick another one.' };
  }
  return { ok: true };
}

export function limitsFor(m: PaymentMethod, mode: Mode): { min: number; max: number; feePercent: number } {
  return mode === 'deposit'
    ? { min: Number(m.minDeposit) || 0, max: Number(m.maxDeposit) || 0, feePercent: Number(m.depositFeePercent) || 0 }
    : { min: Number(m.minWithdraw) || 0, max: Number(m.maxWithdraw) || 0, feePercent: Number(m.withdrawFeePercent) || 0 };
}

/** Public shape — no account numbers for withdrawals, no internal fields leak. */
export function toPublicMethod(db: any, m: PaymentMethod, mode: Mode) {
  const lim = limitsFor(m, mode);
  return {
    id: m.id,
    name: m.name,
    logo: m.logo,
    category: m.category,
    recommended: !!m.recommended,
    recommendedOrder: Number(m.recommendedOrder) || 0,
    order: Number(m.order) || 0,
    currencies: m.currencies,
    min: lim.min,
    max: lim.max,
    feePercent: lim.feePercent,
    processingTime: m.processingTime,
    maintenance: !!m.maintenance,
    maintenanceMessage: m.maintenanceMessage || '',
    // only the deposit side needs somewhere to send the money
    payTo: mode === 'deposit'
      ? { accountName: m.accountName || '', accountNumber: m.accountNumber || '', instructions: m.instructions || '' }
      : null,
    requires: mode === 'withdraw' ? withdrawFieldsFor(m) : [],
    flow: m.category === 'AGENT' ? 'AGENT' : 'FORM',
  };
}

/** What the user must type so the payout can actually be sent. */
export function withdrawFieldsFor(m: PaymentMethod): Array<{ key: string; label: string; placeholder: string }> {
  if (m.category === 'CRYPTO') {
    return [{ key: 'address', label: 'Your wallet address', placeholder: 'Paste the address that should receive the funds' }];
  }
  if (m.category === 'BANK') {
    return [
      { key: 'accountName', label: 'Account holder name', placeholder: 'Name on the bank account' },
      { key: 'accountNumber', label: 'Account / IBAN number', placeholder: 'Account number' },
      { key: 'bankName', label: 'Bank name', placeholder: 'Bank or branch' },
    ];
  }
  return [
    { key: 'accountName', label: 'Account holder name', placeholder: 'Name on the wallet' },
    { key: 'accountNumber', label: 'Wallet number', placeholder: 'The number that should receive the money' },
  ];
}
