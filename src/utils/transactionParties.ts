import type { Transaction } from '../types';

type TransactionWithPartyMetadata = Transaction & {
  agentId?: string;
  metadata?: Record<string, unknown>;
};

function firstId(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const id = String(value).trim();
    if (id && id !== 'undefined' && id !== 'null') return id;
  }
  return '';
}

/** Resolve the party IDs for both normal and legacy transfer records. */
export function getTransactionPartyIds(transaction: Transaction): { senderId: string; receiverId: string } {
  const tx = transaction as TransactionWithPartyMetadata;
  const metadata = tx.metadata || {};
  const type = String(tx.type || '').toUpperCase();
  const isOutgoing = type === 'TRANSFER_SENT' || type === 'AGENT_TRANSFER_SENT';
  const isIncoming = type === 'TRANSFER_RECEIVED' || type === 'AGENT_TRANSFER_RECEIVED';

  return {
    senderId: firstId(
      tx.senderId,
      metadata.senderId,
      isOutgoing ? tx.userId : undefined,
    ),
    receiverId: firstId(
      tx.recipientId,
      metadata.recipientId,
      type === 'AGENT_TRANSFER_SENT' ? tx.agentId || metadata.agentId : undefined,
      isIncoming ? tx.userId : undefined,
    ),
  };
}
