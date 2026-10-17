import { FC, useState, useEffect } from 'react';
import { Send, X, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { BoostPayStore } from '../services/store';
import { User } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onSuccess: (updatedUser: User) => void;
}

export const P2PTransferModal: FC<Props> = ({
  isOpen,
  onClose,
  currentUser,
  onSuccess
}) => {
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'INPUT' | 'SUCCESS'>('INPUT');
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset state completely whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setRecipientId('');
      setAmount('');
      setError('');
      setStep('INPUT');
      setIsProcessing(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setRecipientId('');
    setAmount('');
    setError('');
    setStep('INPUT');
    setIsProcessing(false);
    onClose();
  };

  if (!isOpen) return null;

  const isBoostActive = currentUser.boostState.isActive && !currentUser.boostState.isPaused;

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Check if boost is running
    if (isBoostActive) {
      setError('Active boost running! You must pause your boost before sending money.');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid transfer amount.');
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

    setIsProcessing(true);

    try {
      // 1. Attempt server-side authoritative transfer
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // Offline fallback: perform locally
    }

    // Local Fallback Execution
    const allUsers = BoostPayStore.getUsers();
    const recipient = allUsers.find(u => u.id === cleanRecipient);
    if (!recipient) {
      setError(`Recipient User ID #${cleanRecipient} was not found on BoostPay.`);
      setIsProcessing(false);
      return;
    }

    if (recipient.isBlocked) {
      setError('Recipient account is currently restricted.');
      setIsProcessing(false);
      return;
    }

    const sender = allUsers.find(u => u.id === currentUser.id);
    if (!sender) {
      setError('Transaction failed: User not found.');
      setIsProcessing(false);
      return;
    }

    sender.balance -= numAmount;
    recipient.balance += numAmount;

    const sentTx = BoostPayStore.addTransaction({
      userId: sender.id,
      type: 'TRANSFER_SENT',
      amount: numAmount,
      recipientId: recipient.id,
      notes: `P2P transfer sent to #${recipient.id}`
    });

    const recvTx = BoostPayStore.addTransaction({
      userId: recipient.id,
      type: 'TRANSFER_RECEIVED',
      amount: numAmount,
      senderId: sender.id,
      notes: `P2P transfer received from #${sender.id}`
    });

    // Create notifications for local fallback
    BoostPayStore.addNotification({
      id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
      userId: sender.id,
      type: 'TRANSFER_SENT',
      title: 'BOOSTPAY-ALERTS',
      message: `DEBIT ALERT: $${numAmount.toFixed(2)} was transferred to Peer #${recipient.id}. Remaining Balance: $${sender.balance.toFixed(2)}. Ref: ${sentTx.id}`,
      amount: numAmount,
      referenceId: sentTx.id,
      timestamp: Date.now(),
      isRead: false,
      metadata: {
        recipientId: recipient.id,
        balanceAfter: sender.balance
      }
    });

    BoostPayStore.addNotification({
      id: 'NOTIF-' + Math.floor(10000000 + Math.random() * 90000000),
      userId: recipient.id,
      type: 'TRANSFER_RECEIVED',
      title: 'BOOSTPAY-ALERTS',
      message: `CREDIT ALERT: $${numAmount.toFixed(2)} has been credited to your wallet from Peer #${sender.id}. Available Balance: $${recipient.balance.toFixed(2)}. Ref: ${recvTx.id}`,
      amount: numAmount,
      referenceId: recvTx.id,
      timestamp: Date.now(),
      isRead: false,
      metadata: {
        senderId: sender.id,
        balanceAfter: recipient.balance
      }
    });

    sender.boostState.targetDurationMs = BoostPayStore.calculateDynamicDuration(sender.balance, allUsers);
    recipient.boostState.targetDurationMs = BoostPayStore.calculateDynamicDuration(recipient.balance, allUsers);

    BoostPayStore.saveUsers(allUsers);
    BoostPayStore.setCurrentUser(sender);

    setIsProcessing(false);
    setStep('SUCCESS');
    onSuccess(sender);
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
            {/* Boost Active Protection Warning */}
            {isBoostActive && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Active Compounding Boost Running</strong>
                  Funds are currently locked in session. You must pause your boost on the wallet screen before sending funds.
                </div>
              </div>
            )}

            {/* Recipient User ID Input */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Recipient Numeric User ID
              </label>
              <input
                type="text"
                placeholder="Enter 6-digit numeric User ID (e.g., 541290)"
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
                type="number"
                step="any"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-base font-mono text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>

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
