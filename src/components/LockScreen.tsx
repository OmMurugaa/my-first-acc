import React, {useState} from 'react';
import {Eye, EyeOff, KeyRound, Lock, Moon, Sun, Upload} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';

export const LockScreen: React.FC = () => {
  const {
    vaultMeta,
    settings,
    setTheme,
    unlockWithPassword,
    unlockWithPin,
    restoreFromBackupFile,
  } = useVault();

  const pinAvailable = Boolean(vaultMeta?.pinEnabled && (vaultMeta.pinFailedAttempts || 0) < 3);
  const [mode, setMode] = useState<'password' | 'pin'>(pinAvailable ? 'pin' : 'password');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (vaultMeta?.pinEnabled && (vaultMeta.pinFailedAttempts || 0) < 3) {
      setMode('pin');
      setSecret('');
    } else if (!vaultMeta?.pinEnabled || (vaultMeta.pinFailedAttempts || 0) >= 3) {
      setMode('password');
    }
  }, [vaultMeta?.pinEnabled, vaultMeta?.pinFailedAttempts]);

  // Emergency backup recovery modal
  const [showRecovery, setShowRecovery] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [backupFileName, setBackupFileName] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [newMasterPassword, setNewMasterPassword] = useState('');

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!secret) return;
    setLoading(true);
    try {
      if (mode === 'pin') {
        await unlockWithPin(secret);
      } else {
        await unlockWithPassword(secret);
      }
      setSecret('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t(settings.language, 'wrongPassword');
      setError(msg);
      if (msg.includes('Master Password')) {
        setMode('password');
        setSecret('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackupFileName(f.name);
    setBackupJson(await f.text());
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!backupJson) {
      setError('Select an encrypted backup file.');
      return;
    }
    if (newMasterPassword && newMasterPassword.length < 8) {
      setError('New Master Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await restoreFromBackupFile(backupJson, backupPassword, newMasterPassword || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed.');
      setLoading(false);
    }
  };

  const pinLockedOut = (vaultMeta?.pinFailedAttempts || 0) >= 3;

  return (
    <div className="min-h-screen app-canvas flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border app-surface p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">MyFirst Account</h1>
              <p className="text-xs app-text-muted">{t(settings.language, 'offlineReady')}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void setTheme(settings.theme === 'dark' ? 'gray' : 'dark')}
            className="p-2.5 rounded-lg border app-border app-text-secondary hover:opacity-80 min-w-[40px] min-h-[40px] flex items-center justify-center"
            title={settings.theme === 'dark' ? 'Switch to Gray Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {!showRecovery ? (
          <>
            <div className="mb-5">
              <h2 className="text-base font-semibold">{t(settings.language, 'unlockTitle')}</h2>
              <p className="mt-1 text-xs app-text-muted leading-relaxed">
                {t(settings.language, 'unlockSubtitle')}
              </p>
            </div>

            {vaultMeta?.pinEnabled && !pinLockedOut && (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg border app-border app-surface-elevated mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('pin');
                    setSecret('');
                    setError('');
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'pin' ? 'text-white' : 'app-text-muted'
                  }`}
                  style={mode === 'pin' ? {backgroundColor: 'var(--accent-primary)'} : undefined}
                >
                  Quick PIN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('password');
                    setSecret('');
                    setError('');
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    mode === 'password' ? 'text-white' : 'app-text-muted'
                  }`}
                  style={
                    mode === 'password' ? {backgroundColor: 'var(--accent-primary)'} : undefined
                  }
                >
                  Master Password
                </button>
              </div>
            )}

            {vaultMeta?.pinEnabled && pinLockedOut && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-400">
                Quick PIN was locked after 3 failed attempts. Enter your Master Password once to unlock and re-enable Quick PIN.
              </div>
            )}

            {error && (
              <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">
                {error}
              </div>
            )}

            <form onSubmit={handleUnlock} className="space-y-4">
              <div>
                <label className="block text-xs font-medium app-text-secondary mb-1.5">
                  {mode === 'pin' ? 'Quick PIN (4-6 digits)' : t(settings.language, 'masterPassword')}
                </label>
                <div className="relative">
                  {mode === 'pin' ? (
                    <input
                      key="quick-pin-input"
                      type={showSecret ? 'text' : 'password'}
                      name="vault_quick_pin"
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={6}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter 4-6 digit PIN..."
                      className="w-full rounded-lg border app-input px-3.5 py-2.5 pr-11 text-sm font-mono-tabular tracking-widest min-h-[44px]"
                      autoFocus
                      required
                    />
                  ) : (
                    <input
                      key="master-password-input"
                      type={showSecret ? 'text' : 'password'}
                      name="vault_master_password"
                      autoComplete="current-password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="Enter Master Password..."
                      className="w-full rounded-lg border app-input px-3.5 py-2.5 pr-11 text-sm min-h-[44px]"
                      autoFocus
                      required
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 app-text-muted"
                    aria-label="Toggle visibility"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60 min-h-[44px]"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Deriving Key & Decrypting...' : t(settings.language, 'unlockButton')}</span>
              </button>
            </form>

            <div className="mt-5 pt-4 border-t app-border flex items-center justify-between text-xs app-text-muted">
              <span className="font-mono-tabular">
                PBKDF2 · {(vaultMeta?.iterations || 600000).toLocaleString()} iter
              </span>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setShowRecovery(true);
                }}
                className="hover:underline font-medium app-text-secondary"
              >
                Recover from Backup
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleRecoverySubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Recover via Encrypted Backup</h2>
              <button
                type="button"
                onClick={() => {
                  setShowRecovery(false);
                  setError('');
                }}
                className="text-xs app-text-muted hover:underline"
              >
                Back to Unlock
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">
                {error}
              </div>
            )}

            <label className="flex items-center justify-center gap-2 w-full rounded-xl border border-dashed app-border p-4 cursor-pointer text-xs app-text-secondary hover:border-emerald-500">
              <Upload className="w-4 h-4" />
              <span>{backupFileName || 'Select .mfa or .MyPET backup file...'}</span>
              <input
                type="file"
                accept=".mfa,.mypet,.MyPET,.json"
                onChange={handleRecoveryFile}
                className="hidden"
              />
            </label>

            <div>
              <label className="block text-xs font-medium mb-1">Backup Decryption Password</label>
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[44px]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                New Master Password (optional, min 8 chars)
              </label>
              <input
                type="password"
                value={newMasterPassword}
                onChange={(e) => setNewMasterPassword(e.target.value)}
                placeholder="Leave blank to use backup password"
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[44px]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white min-h-[44px]"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              {loading ? 'Restoring Vault...' : 'Decrypt & Restore Vault'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
