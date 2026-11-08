import { FC, useState, useEffect } from 'react';
import { Send, X, AlertTriangle, CheckCircle2, ArrowRight, QrCode } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSuccess: (updatedUser: User) => void;
  /** Filled from a scanned BoostPay QR code. */
  recipientPrefill?: { userId: string; name?: string } | null;
  onOpenQR?: () => void;
}

export const P2PTransferModal: FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  onSuccess,
  recipientPrefill,
  onOpenQR
}) => {
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  // Admin "sent money" hold — shown ONLY when the user taps Send (owner request:
  // no standing notice anywhere else in the app).
  const [lockNotice, setLockNotice] = useState('');
  // Admin "send to refer only" rule — fetched when the sheet opens, and the server
  // is still the final authority on every transfer.
  const [rule, setRule] = useState<any>(null);
  const [step, setStep] = useState<'INPUT' | 'SUCCESS'>('INPUT');
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset state completely whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setRecipientId(recipientPrefill ? recipientPrefill.userId : '');
      setAmount('');
      setError('');
      setStep('INPUT');
      setIsProcessing(false);
    } else {
      setRecipientId('');
    }
  }, [isOpen, recipientPrefill]);

  const handleClose = () => {
    setRecipientId('');
    setAmount('');
    setError('');
    setStep('INPUT');
    setIsProcessing(false);
    onClose();
  };

  // Reading the admin hold the server put on this account (not shown up-front).
  const sendLock = ((currentUser as any)?.sendLock || null) as
    | { full?: boolean; amount?: number; sendable?: number }
    | null;
  const lockHeld = Number(sendLock?.amount || 0);
  const lockFull = !!sendLock?.full;
  const lockCap = typeof sendLock?.sendable === 'number' ? sendLock.sendable : null;

  useEffect(() => { setLockNotice(''); }, [amount, recipientId]);

  useEffect(() => {
    let alive = true;
    if (!isOpen) return;
    setRule(null);
    fetch('/api/user/refer-send', { headers: BoostPayStore.authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setRule(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOpen]);

  const ruleMode = rule?.restricted ? String(rule.mode) : 'off';
  const ruleAllowed: string[] = Array.isArray(rule?.allowedRecipients) ? rule.allowedRecipients.map(String) : [];
  const ruleRemaining = rule?.remaining === null || rule?.remaining === undefined ? null : Number(rule.remaining);

  /** Client-side pre-check so the user never has to trigger a server refusal. */
  const ruleError = (toId: string, amt: number): string | null => {
    if (ruleMode === 'off') return null;
    const who = rule?.allowUpline === false
      ? (ruleMode === 'l1' ? 'nobody — sending up to your referrer is switched off' : 'your own team members only (not your referrer)')
      : (ruleMode === 'l1' ? 'your direct referrer' : 'your referrer or your own team members');
    if (toId && !ruleAllowed.includes(toId)) {
      return `Sending is limited on this account — you can only send to ${who}. #${toId} is not in that list.`;
    }
    if (ruleRemaining !== null && amt > ruleRemaining + 1e-9) {
      const per = rule?.period === 'day' ? ' per day' : rule?.period === 'total' ? ' in total' : ' per transfer';
      return ruleRemaining <= 0
        ? `You have used your whole sending limit of $${Number(rule.amount).toFixed(2)}${per} for sending to ${who}.`
        : `Your sending limit is $${Number(rule.amount).toFixed(2)}${per} to ${who} — you can send at most $${ruleRemaining.toFixed(2)} right now.`;
    }
    return null;
  };

  if (!isOpen) return null;

  const isBoostActive = currentUser.boostState.isActive && !currentUser.boostState.isPaused;

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLockNotice('');

    // Check if boost is running
    if (isBoostActive) {
      setError('Active boost running! You must pause your boost before sending money.');
      return;
    }

    if (lockFull) {
      setLockNotice('Sending money is temporarily locked on your account by support. Receiving money still works — please contact support.');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0.1) {
      setError('Minimum transfer is 0.1 — enter at least 0.10');
      return;
    }

    if (lockCap !== null && numAmount > lockCap) {
      setLockNotice(lockCap > 0
        ? `$${lockHeld.toFixed(2)} of your balance is temporarily held by support. You can send up to $${lockCap.toFixed(2)} right now.`
        : `$${lockHeld.toFixed(2)} is temporarily held on your account by support, which currently covers your whole balance. You cannot send money right now. Please contact support.`);
      return;
    }

    if (numAmount > currentUser.balance) {
      setError('Insufficient wallet balance for this transfer.');
      return;
    }

    const cleanRecipient = recipientId.trim();
    if (!cleanRecipient || cleanRecipient === currentUser.id) {
      setError('Please enter a valid recipient User ID different from your own.');
      return;
    }

    const blocked = ruleError(cleanRecipient, numAmount);
    if (blocked) {
      setError(blocked);
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Attempt server-side authoritative transfer
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: BoostPayStore.authHeaders(),
        body: JSON.stringify({
          senderId: currentUser.id,
          recipientId: cleanRecipient,
          amount: numAmount
        })
      });

      if (res.ok) {
        const data = await res.json();
        const allUsers = BoostPayStore.getUsers();
        const sIdx = allUsers.findIndex(u => u.id === currentUser.id);
        if (sIdx >= 0) allUsers[sIdx] = { ...allUsers[sIdx], balance: data.sender.balance, boostState: data.sender.boostState };
        const rIdx = allUsers.findIndex(u => u.id === cleanRecipient);
        if (rIdx >= 0) allUsers[rIdx] = { ...allUsers[rIdx], balance: data.recipient.balance, boostState: data.recipient.boostState };
        BoostPayStore.saveUsers(allUsers);

        if (data.sentTx) BoostPayStore.addTransactionRecord(data.sentTx);
        if (data.recvTx) BoostPayStore.addTransactionRecord(data.recvTx);
        if (data.sentNotif) BoostPayStore.addNotification(data.sentNotif);
        if (data.recvNotif) BoostPayStore.addNotification(data.recvNotif);

        const updatedSender: User = {
          ...currentUser,
          balance: data.sender.balance,
          boostState: data.sender.boostState || currentUser.boostState
        };
        BoostPayStore.setCurrentUser(updatedSender);

        setIsProcessing(false);
        setStep('SUCCESS');
        onSuccess(updatedSender);
        return;
      } else {
        const errData = await res.json().catch(() => null);
        if (errData?.error) {
          setError(errData.error);
          setIsProcessing(false);
          return;
        }
      }
    } catch {
      setError('Network error — please try again. Server transfer required.');
      setIsProcessing(false);
      return;
    }
    setError('Transfer failed — server validation required. Please try again.');
    setIsProcessing(false);
    return;
    // Local fallback removed for security (server authoritative only)
    // const allUsers = BoostPayStore.getUsers();
    // const recipient = allUsers.find(u => u.id === cleanRecipient);
    // if (!recipient) {
    //   setError(`Recipient User ID #${cleanRecipient} was not found on BoostPay.`);
    //   setIsProcessing(false);
    //   return;
    // }
    // if (recipient.isBlocked) {
    //   setError('Recipient account is currently restricted.');
    //   setIsProcessing(false);
    //   return;
    // }
    // const sender = allUsers.find(u => u.id === currentUser.id);
    // if (!sender) {
    //   setError('Transaction failed: User not found.');
    //   setIsProcessing(false);
    //   return;
    // }
    // sender.balance -= numAmount;
    // recipient.balance += numAmount;
    // Local fallback fully disabled — server authoritative only
    // (removed for security: local balance manipulation bypass)
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl text-zinc-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-500/20 p-2 text-amber-400">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Send Money</h3>
              <p className="text-[11px] text-zinc-400">Instant off-chain zero-fee transfer</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Clean Input Form */}
        {step === 'INPUT' && (
          <form onSubmit={handleExecuteTransfer} className="space-y-4">
            {/* Send-to-refer rule (set by admin) — shown only when it exists */}
            {ruleMode !== 'off' && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-[11px] leading-relaxed text-emerald-200">
                <p className="font-bold text-emerald-300">
                  {rule?.allowUpline === false
                    ? (ruleMode === 'l1' ? 'Sending is closed on this account' : 'You can send only to your own team members')
                    : (ruleMode === 'l1' ? 'You can send only to your direct referrer' : 'You can send only to your referrer and team members')}
                </p>
                <p className="mt-0.5 text-emerald-200/80">
                  {rule?.referrerId ? `Referrer: #${rule.referrerId}${rule?.allowUpline === false ? ' (sending to them is off)' : ''}. ` : ''}
                  {Number(rule?.amount) > 0
                    ? `Limit $${Number(rule.amount).toFixed(2)} ${rule?.period === 'day' ? 'per day' : rule?.period === 'total' ? 'in total' : 'per transfer'} — $${Number(rule?.remaining ?? 0).toFixed(2)} left.`
                    : 'No amount limit.'}
                </p>
                {rule?.inherited ? (
                  <p className="mt-0.5 text-emerald-200/70">
                    This rule came with money you received{rule?.inheritedFrom ? ` from #${rule.inheritedFrom}` : ''}.
                  </p>
                ) : null}
                {rule?.note && !rule?.inherited ? <p className="mt-0.5 text-emerald-200/60">“{rule.note}”</p> : null}
              </div>
            )}

            {/* Boost Active Protection Warning */}
            {isBoostActive && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Active Boosting Running</strong>
                  Funds are currently locked in session. You must pause your boost on the wallet screen before sending funds.
                </div>
              </div>
            )}

            {/* Recipient User ID Input */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Recipient User ID
              </label>
              <input
                type="text"
                placeholder="Enter recipient User ID (e.g., 2)"
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value.replace(/\D/g, ''))}
                maxLength={8}
                autoFocus
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Amount Input */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <label className="font-medium text-zinc-400">
                  Transfer Amount ($)
                </label>
                <div className="flex items-center gap-1.5 text-zinc-500 font-mono text-[11px]">
                  <span>Available: <strong className="text-emerald-400 font-bold">${currentUser.balance.toFixed(2)}</strong></span>
                  <button
                    type="button"
                    onClick={() => setAmount(currentUser.balance.toFixed(2))}
                    className="ml-1 px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700 font-bold text-[10px] cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-base font-mono text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {lockNotice && (
              <p className="flex items-start gap-1.5 rounded-lg bg-orange-500/10 border border-orange-500/40 p-2.5 text-[11px] text-orange-200 font-semibold">
                <span className="mt-[1px] leading-none">🔒</span>
                <span className="min-w-0 break-words">{lockNotice}</span>
              </p>
            )}

            {error && (
              <p className="rounded-lg bg-red-950/40 border border-red-500/30 p-2.5 text-xs text-red-400 font-medium">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isBoostActive || isProcessing}
              className={`w-full rounded-xl py-3 text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg cursor-pointer ${
                isBoostActive || isProcessing
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-amber-500/20'
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-zinc-950 border-t-transparent" />
                  Sending...
                </span>
              ) : (
                <>
                  <span>Send Money</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 2: Success Confirmation */}
        {step === 'SUCCESS' && (
          <div className="text-center py-6 space-y-4">
            <div className="inline-flex rounded-full bg-emerald-500/20 p-4 text-emerald-400 ring-8 ring-emerald-500/10">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">Transfer Completed</h4>
              <p className="text-xs text-zinc-400 mt-1">
                Successfully sent <strong className="text-emerald-400 font-mono">${parseFloat(amount).toFixed(2)} USD</strong> to User <strong className="font-mono text-white">#{recipientId}</strong>.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="w-full rounded-xl bg-zinc-800 py-2.5 text-xs font-bold text-zinc-100 hover:bg-zinc-700 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
