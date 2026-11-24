import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {Lock, X} from 'lucide-react';
import {useVault} from '../context/VaultContext';

interface PasswordConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onVerified: (verifiedPassword: string) => Promise<void>;
}

export const PasswordConfirmModal: React.FC<PasswordConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = true,
  onCancel,
  onVerified,
}) => {
  const {verifyCurrentPassword} = useVault();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError('');
      setBusy(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password) {
      setError('Please enter your Master Password.');
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyCurrentPassword(password);
      if (!ok) {
        setError('Incorrect Master Password.');
        setBusy(false);
        return;
      }
      await onVerified(password);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border app-surface p-6 shadow-xl space-y-4 animate-mfa-modal">
        <div className="flex items-center justify-between pb-3 border-b app-border">
          <div className="flex items-center gap-2">
            <Lock className={`w-4 h-4 ${danger ? 'text-rose-500' : 'text-emerald-500'}`} />
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-2 rounded-lg app-text-muted hover:opacity-80 min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs app-text-secondary leading-relaxed">{description}</p>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium app-text-secondary mb-1.5">
              Master Password (Required for Modifications)
            </label>
            <input
              type="password"
              name="confirm_sensitive_action_password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter Master Password to authorize..."
              className="w-full rounded-lg border app-input px-3 py-2.5 text-sm min-h-[44px]"
              autoFocus
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border app-border px-4 py-2 text-xs font-medium min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`rounded-lg px-4 py-2 text-xs font-semibold text-white min-h-[40px] disabled:opacity-60 ${
                danger ? 'bg-rose-600 hover:bg-rose-700' : ''
              }`}
              style={!danger ? {backgroundColor: 'var(--accent-primary)'} : undefined}
            >
              {busy ? 'Verifying...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
