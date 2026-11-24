import React, {useState} from 'react';
import {
  AlertOctagon,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {CURRENT_DB_VERSION} from '../db/indexedDb';
import {t} from '../i18n/translations';
import {PasswordConfirmModal} from './PasswordConfirmModal';

export const SecurityView: React.FC = () => {
  const {
    settings,
    vaultMeta,
    transactions,
    migrations,
    updateSettings,
    changeMasterPassword,
    enableQuickPin,
    disableQuickPin,
    deleteAllTransactions,
    secureResetAllData,
  } = useVault();

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Quick PIN state (with dedicated inline feedback)
  const [pinPw, setPinPw] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [showPinDigits, setShowPinDigits] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinNotice, setPinNotice] = useState('');
  const [pinError, setPinError] = useState('');

  // Password Change state
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');

  // Secure Reset state
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  // Password confirmation modal state for Auto-Lock & Protection / Transaction Wipe
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger: boolean;
    run: (password: string) => Promise<void>;
  } | null>(null);

  const clearFeedback = () => {
    setNotice('');
    setError('');
  };

  const handleEnablePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinNotice('');
    setPinError('');
    const cleanPin = pinCode.trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      setPinError('Quick PIN must be exactly 4 to 6 digits (0-9).');
      return;
    }
    setPinBusy(true);
    try {
      await enableQuickPin(pinPw, cleanPin);
      setPinNotice('Quick PIN saved! Next time you lock the vault, you can unlock with this 4-6 digit PIN.');
      setPinPw('');
      setPinCode('');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to enable Quick PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const handleDisablePin = async () => {
    setPinNotice('');
    setPinError('');
    setPinBusy(true);
    try {
      await disableQuickPin();
      setPinNotice('Quick PIN unlock has been disabled.');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to disable Quick PIN.');
    } finally {
      setPinBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (newPw.length < 8) {
      setError('New Master Password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmNewPw) {
      setError('New passwords do not match.');
      return;
    }
    try {
      await changeMasterPassword(oldPw, newPw);
      setNotice('Master Password updated. Your DEK has been re-wrapped with a fresh salt.');
      setOldPw('');
      setNewPw('');
      setConfirmNewPw('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    }
  };

  const handleSecureReset = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (resetPhrase !== 'RESET') {
      setError('Type RESET in uppercase to confirm wiping all local data.');
      return;
    }
    try {
      await secureResetAllData(resetPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    }
  };

  const pinLockedOut = Boolean(vaultMeta?.pinEnabled && (vaultMeta.pinFailedAttempts || 0) >= 3);

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 pb-4 border-b app-border">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          {t(settings.language, 'navSecurity')}
        </h1>
        <p className="mt-1 text-xs sm:text-sm app-text-muted">
          Quick PIN unlock, Master Password wrapping (PBKDF2-HMAC-SHA-256), auto-lock protection, and schema versioning.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      {/* Quick PIN & Auto-Lock Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick PIN Unlock Card */}
        <div className="rounded-xl border app-surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-500" />
              <h2 className="text-base font-semibold">Quick PIN Unlock</h2>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium ${
                  pinLockedOut
                    ? 'text-amber-400'
                    : vaultMeta?.pinEnabled
                      ? 'text-emerald-400'
                      : 'app-text-muted'
                }`}
              >
                {pinLockedOut
                  ? 'Locked after 3 failed attempts'
                  : vaultMeta?.pinEnabled
                    ? 'Active (4–6 Digit PIN)'
                    : 'Not Configured'}
              </span>
              {vaultMeta?.pinEnabled && (
                <button
                  type="button"
                  disabled={pinBusy}
                  onClick={() => void handleDisablePin()}
                  className="text-xs text-rose-400 hover:underline font-medium"
                >
                  Disable PIN
                </button>
              )}
            </div>
          </div>

          <p className="text-xs app-text-muted">
            Set a 4 to 6 digit numeric PIN for quick unlocking on this device. Your DEK is separately wrapped with your PIN using PBKDF2-HMAC-SHA-256.
          </p>

          {pinNotice && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
              {pinNotice}
            </div>
          )}
          {pinError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {pinError}
            </div>
          )}

          <form onSubmit={handleEnablePin} className="space-y-3" autoComplete="off">
            <div>
              <label className="block text-xs font-medium mb-1">Verify Master Password</label>
              <input
                type="password"
                name="verify_master_password_for_pin"
                autoComplete="off"
                value={pinPw}
                onChange={(e) => setPinPw(e.target.value)}
                placeholder="Enter Master Password..."
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Quick PIN (4–6 Digits)</label>
              <div className="relative">
                <input
                  type={showPinDigits ? 'text' : 'password'}
                  name="quick_pin_digits"
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 4-6 digit PIN (e.g. 1234)"
                  className="w-full rounded-lg border app-input px-3 py-2 pr-10 text-sm font-mono-tabular tracking-widest min-h-[42px]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPinDigits((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 app-text-muted"
                  aria-label="Toggle PIN visibility"
                >
                  {showPinDigits ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={pinBusy}
              className="w-full rounded-lg py-2.5 text-xs font-semibold text-white min-h-[42px] disabled:opacity-60"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              {pinBusy
                ? 'Wrapping Key with PIN...'
                : vaultMeta?.pinEnabled
                  ? 'Update Quick PIN'
                  : 'Enable Quick PIN'}
            </button>
          </form>
        </div>

        {/* Auto-Lock & Protection */}
        <div className="rounded-xl border app-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold">Auto-Lock &amp; Protection</h2>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Auto-Lock Timeout</label>
            <select
              value={settings.autoLockMinutes}
              onChange={(e) => {
                const nextMinutes = Number(e.target.value);
                if (nextMinutes === settings.autoLockMinutes) return;
                clearFeedback();
                setPendingProtectedAction({
                  title: 'Verify Master Password',
                  description: `Enter your Master Password to change Auto-Lock Timeout to ${
                    nextMinutes === 0
                      ? 'Disabled (Manual Lock Only)'
                      : `${nextMinutes} minute${nextMinutes === 1 ? '' : 's'}`
                  }.`,
                  confirmLabel: 'Verify & Save Timeout',
                  danger: false,
                  run: async () => {
                    await updateSettings({autoLockMinutes: nextMinutes});
                    setNotice('Auto-Lock Timeout updated.');
                  },
                });
              }}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
            >
              <option value={1}>1 minute of inactivity</option>
              <option value={5}>5 minutes of inactivity</option>
              <option value={15}>15 minutes of inactivity</option>
              <option value={30}>30 minutes of inactivity</option>
              <option value={0}>Disabled (Manual Lock Only)</option>
            </select>
          </div>

          <label className="flex items-start gap-2.5 text-xs cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={settings.confirmOnSensitiveActions}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                clearFeedback();
                setPendingProtectedAction({
                  title: 'Verify Master Password',
                  description: nextEnabled
                    ? 'Enter your Master Password to turn ON protection and display the Edit/Delete Actions column.'
                    : 'Enter your Master Password to turn OFF protection and hide the Edit/Delete Actions column.',
                  confirmLabel: nextEnabled ? 'Verify & Enable' : 'Verify & Disable',
                  danger: false,
                  run: async () => {
                    await updateSettings({confirmOnSensitiveActions: nextEnabled});
                    setNotice(
                      nextEnabled
                        ? 'Protection enabled: Edit & Delete Actions column is now visible and Master Password protected.'
                        : 'Protection turned off: Edit & Delete Actions column is now hidden.'
                    );
                  },
                });
              }}
              className="w-4 h-4 mt-0.5 accent-emerald-600"
            />
            <span className="app-text-secondary">
              Require Master Password re-entry when editing or deleting transactions
            </span>
          </label>
        </div>
      </div>

      {/* Change Master Password */}
      <form onSubmit={handleChangePassword} className="rounded-xl border app-surface p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <h2 className="text-base font-semibold">Change Master Password</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Current Master Password</label>
            <input
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">New Master Password (min 8 chars)</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Confirm New Master Password</label>
            <input
              type="password"
              value={confirmNewPw}
              onChange={(e) => setConfirmNewPw(e.target.value)}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              minLength={8}
              required
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg px-5 py-2.5 text-xs font-semibold text-white min-h-[42px]"
          style={{backgroundColor: 'var(--accent-primary)'}}
        >
          Update Master Password
        </button>
      </form>

      {/* Schema Versioning & Crypto Specs */}
      <div className="rounded-xl border app-surface p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-500" />
          <h2 className="text-base font-semibold">Database Schema Versioning &amp; Crypto Profile</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="rounded-lg border app-border p-3 app-surface-elevated">
            <div className="app-text-muted">IndexedDB &amp; Schema Version</div>
            <div className="font-mono-tabular font-semibold mt-1">
              DB v{CURRENT_DB_VERSION} · Data Schema v{settings.schemaVersion}
            </div>
          </div>
          <div className="rounded-lg border app-border p-3 app-surface-elevated">
            <div className="app-text-muted">Cipher &amp; Key Wrapping</div>
            <div className="font-mono-tabular font-semibold mt-1">
              AES-256-GCM · 128-bit Tag · 12B IV
            </div>
          </div>
          <div className="rounded-lg border app-border p-3 app-surface-elevated">
            <div className="app-text-muted">KDF Parameters</div>
            <div className="font-mono-tabular font-semibold mt-1">
              PBKDF2-SHA-256 · {(vaultMeta?.iterations || 600000).toLocaleString()} iter
            </div>
          </div>
        </div>

        {migrations.length > 0 && (
          <div className="text-xs space-y-1.5 pt-2">
            <div className="font-medium app-text-secondary flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Applied Migrations</span>
            </div>
            {migrations.map((m) => (
              <div
                key={m.version}
                className="flex flex-wrap items-center justify-between gap-2 app-text-muted font-mono-tabular"
              >
                <span>
                  v{m.version} · {m.name}
                </span>
                <span>{new Date(m.appliedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Secure Data Reset */}
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-5 space-y-5">
        <div className="flex items-center gap-2 text-rose-400">
          <AlertOctagon className="w-4 h-4" />
          <h2 className="text-base font-semibold">Secure Data Reset</h2>
        </div>

        {/* Option 1: Delete All Encrypted Transactions Only */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <div className="text-sm font-semibold text-amber-400">
              Delete All Encrypted Transactions Only ({transactions.length})
            </div>
            <p className="text-xs app-text-secondary">
              Permanently deletes all encrypted transactions and Trash entries from this device while keeping your Categories, Settings, Master Password, Quick PIN, and Monthly Backups intact.
            </p>
          </div>
          <button
            type="button"
            disabled={transactions.length === 0}
            onClick={() => {
              clearFeedback();
              setPendingProtectedAction({
                title: 'Delete All Encrypted Transactions',
                description: `Enter your Master Password to permanently delete all ${transactions.length} encrypted transaction(s) and Trash entries. Your Categories, Settings, and Master Password will be kept.`,
                confirmLabel: 'Verify & Delete All Transactions',
                danger: true,
                run: async (verifiedPw) => {
                  await deleteAllTransactions(verifiedPw);
                  setNotice('All encrypted transactions have been permanently deleted.');
                },
              });
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-600/90 px-4 py-2.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40 min-h-[40px] shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete All Encrypted Transactions</span>
          </button>
        </div>

        {/* Option 2: Full Vault Reset */}
        <form onSubmit={handleSecureReset} className="pt-4 border-t border-rose-500/20 space-y-3">
          <div className="text-sm font-semibold text-rose-400">Full Encrypted Vault Wipe</div>
          <p className="text-xs app-text-secondary">
            Permanently wipes all encrypted transactions, categories, backups, settings, and keys from IndexedDB and localStorage on this device. Export a backup before resetting.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              placeholder='Type "RESET" to confirm'
              className="rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              required
            />
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Verify Master Password"
              className="rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              required
            />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 min-h-[40px]"
          >
            Wipe All Encrypted Vault Data
          </button>
        </form>
      </div>

      {/* Master Password Confirmation Modal */}
      <PasswordConfirmModal
        isOpen={Boolean(pendingProtectedAction)}
        title={pendingProtectedAction?.title || 'Verify Master Password'}
        description={pendingProtectedAction?.description || ''}
        confirmLabel={pendingProtectedAction?.confirmLabel || 'Verify'}
        danger={pendingProtectedAction?.danger ?? false}
        onCancel={() => setPendingProtectedAction(null)}
        onVerified={async (verifiedPw) => {
          if (pendingProtectedAction) {
            await pendingProtectedAction.run(verifiedPw);
          }
        }}
      />
    </div>
  );
};
