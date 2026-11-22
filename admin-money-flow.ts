export interface P2PTransferFilter {
  senderId?: unknown;
  recipientId?: unknown;
  limit?: unknown;
}

export interface P2PTransferRow {
  id: string;
  senderId: string;
  recipientId: string;
  amount: number;
  timestamp: number;
}

function cleanAccountId(value: unknown): string {
  return String(value ?? '').trim().replace(/^#/, '').slice(0, 64);
}

function cleanLimit(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(500, Math.max(1, parsed));
}

/**
 * Build an admin-safe P2P list from the debit-side ledger rows only.
 * TRANSFER_RECEIVED rows are intentionally excluded because each transfer also
 * has a matching TRANSFER_SENT row; including both would double-count it.
 */
export function listP2PTransfers(
  transactions: unknown,
  filter: P2PTransferFilter = {},
): { items: P2PTransferRow[]; total: number; limit: number } {
  const senderFilter = cleanAccountId(filter.senderId);
  const recipientFilter = cleanAccountId(filter.recipientId);
  const limit = cleanLimit(filter.limit);
  const rows: P2PTransferRow[] = (Array.isArray(transactions) ? transactions : [])
    .filter((transaction: any) => transaction && transaction.type === 'TRANSFER_SENT')
    .map((transaction: any) => {
      const amount = Number(transaction.amount);
      const timestamp = Number(transaction.timestamp);
      return {
        id: String(transaction.id ?? ''),
        senderId: cleanAccountId(transaction.userId),
        recipientId: cleanAccountId(transaction.recipientId),
        amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      };
    })
    .filter((row) => row.senderId && row.recipientId && row.amount > 0)
    .filter((row) => !senderFilter || row.senderId === senderFilter)
    .filter((row) => !recipientFilter || row.recipientId === recipientFilter)
    .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));

  return { items: rows.slice(0, limit), total: rows.length, limit };
}
