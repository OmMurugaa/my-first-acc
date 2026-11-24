import React, {useState} from 'react';
import {Download, Upload} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import {getTodayISO} from '../utils/formatters';

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const BackupView: React.FC = () => {
  const {
    settings,
    autoBackups,
    updateSettings,
    exportEncryptedBackup,
    createMonthlySnapshotNow,
    downloadAutoBackupSnapshot,
    restoreFromBackupFile,
    mergeFromBackupFile,
  } = useVault();

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Manual Backup state
  const [backupPasswordMode, setBackupPasswordMode] = useState<'separate' | 'master'>('separate');
  const [backupPassword, setBackupPassword] = useState('');
  const [exporting, setExporting] = useState(false);

  // Restore / Import Backup state
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [restoreFileText, setRestoreFileText] = useState('');
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoring, setRestoring] = useState(false);

  const clearFeedback = () => {
    setNotice('');
    setError('');
  };

  const handleManualExport = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (backupPassword.length < 8) {
      setError('Password must be at least 8 characters to encrypt backup.');
      return;
    }
    setExporting(true);
    try {
      const encrypted = await exportEncryptedBackup(backupPassword);
      downloadJsonFile(encrypted, `MyFirstAccount_Backup_${getTodayISO()}.mfa`);
      setNotice('AES-256-GCM encrypted backup file downloaded.');
      setBackupPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleRestoreSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFileName(file.name);
    setRestoreFileText(await file.text());
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!restoreFileText) {
      setError('Please select a .mfa or .MyPET backup file.');
      return;
    }
    setRestoring(true);
    try {
      if (restoreMode === 'merge') {
        const res = await mergeFromBackupFile(restoreFileText, restorePassword);
        setNotice(
          `Imported ${res.addedCount} transaction(s) and ${res.addedCategories} new category(ies)` +
            (res.skippedDuplicates > 0 ? ` (${res.skippedDuplicates} duplicate(s) skipped).` : '.')
        );
      } else {
        await restoreFromBackupFile(restoreFileText, restorePassword);
        setNotice('Encrypted backup decrypted and restored into your vault.');
      }
      setRestoreFileName('');
      setRestoreFileText('');
      setRestorePassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 pb-4 border-b app-border">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          {t(settings.language, 'navBackup')}
        </h1>
        <p className="mt-1 text-xs sm:text-sm app-text-muted">
          Create AES-256-GCM encrypted backups, import <span className="font-mono-tabular">.mfa</span> or MyPET Super{' '}
          <span className="font-mono-tabular">.MyPET</span> archives, and manage monthly local snapshots.
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

      {/* Backup & Restore Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual Encrypted Backup */}
        <form onSubmit={handleManualExport} className="rounded-xl border app-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold">Manual Encrypted Backup</h2>
          </div>
          <p className="text-xs app-text-muted">
            Creates an AES-256-GCM encrypted <span className="font-mono-tabular">.mfa</span> archive. You can protect backups with a separate password.
          </p>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg border app-border app-surface-elevated">
            <button
              type="button"
              onClick={() => setBackupPasswordMode('separate')}
              className={`py-2 text-xs font-medium rounded-md ${
                backupPasswordMode === 'separate' ? 'bg-emerald-600 text-white' : 'app-text-muted'
              }`}
            >
              Separate Backup Password
            </button>
            <button
              type="button"
              onClick={() => setBackupPasswordMode('master')}
              className={`py-2 text-xs font-medium rounded-md ${
                backupPasswordMode === 'master' ? 'bg-emerald-600 text-white' : 'app-text-muted'
              }`}
            >
              Use Master Password
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              {backupPasswordMode === 'separate'
                ? 'Dedicated Backup Password (min 8 chars)'
                : 'Enter Master Password to encrypt'}
            </label>
            <input
              type="password"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
              placeholder="Minimum 8 characters..."
              autoComplete="new-password"
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            disabled={exporting}
            className="w-full rounded-lg py-2.5 text-xs font-semibold text-white min-h-[42px]"
            style={{backgroundColor: 'var(--accent-primary)'}}
          >
            {exporting ? 'Encrypting Backup...' : 'Download Encrypted Backup (.mfa)'}
          </button>
        </form>

        {/* Restore / Import from Backup */}
        <form onSubmit={handleRestoreSubmit} className="rounded-xl border app-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold">Import / Restore Encrypted Backup</h2>
          </div>
          <p className="text-xs app-text-muted">
            Supports MyFirst Account <span className="font-mono-tabular">.mfa</span> and MyPET Super{' '}
            <span className="font-mono-tabular">.MyPET</span> AES-256-GCM encrypted backup files.
          </p>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg border app-border app-surface-elevated">
            <button
              type="button"
              onClick={() => setRestoreMode('merge')}
              className={`py-2 text-xs font-medium rounded-md ${
                restoreMode === 'merge' ? 'bg-emerald-600 text-white' : 'app-text-muted'
              }`}
            >
              Merge &amp; Import (Keep Existing)
            </button>
            <button
              type="button"
              onClick={() => setRestoreMode('replace')}
              className={`py-2 text-xs font-medium rounded-md ${
                restoreMode === 'replace' ? 'bg-rose-600 text-white' : 'app-text-muted'
              }`}
            >
              Full Restore (Replace All)
            </button>
          </div>

          <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed app-border p-4 cursor-pointer text-xs app-text-secondary hover:border-emerald-500">
            <Upload className="w-4 h-4" />
            <span>{restoreFileName || 'Choose .mfa or .MyPET backup file...'}</span>
            <input
              type="file"
              accept=".mfa,.mypet,.MyPET,.json"
              onChange={handleRestoreSelect}
              className="hidden"
            />
          </label>

          <div>
            <label className="block text-xs font-medium mb-1.5">Backup Decryption Password</label>
            <input
              type="password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
              placeholder="Password used when creating the backup..."
              autoComplete="off"
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={restoring}
            className="w-full rounded-lg border app-border py-2.5 text-xs font-semibold hover:opacity-85 min-h-[42px]"
          >
            {restoring
              ? 'Decrypting & Processing...'
              : restoreMode === 'merge'
                ? 'Decrypt & Merge Backup (Skip Duplicates)'
                : 'Decrypt & Replace Entire Vault'}
          </button>
        </form>
      </div>

      {/* Automatic Monthly Backup Snapshots */}
      <div className="rounded-xl border app-surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Automatic Monthly Backups</h2>
            <p className="text-xs app-text-muted mt-0.5">
              Encrypted monthly snapshots are stored locally in IndexedDB on the first unlock of each month.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoMonthlyBackupEnabled}
                onChange={(e) =>
                  void updateSettings({autoMonthlyBackupEnabled: e.target.checked})
                }
                className="w-4 h-4 accent-emerald-600"
              />
              <span>Auto Monthly Snapshot</span>
            </label>
            <button
              type="button"
              onClick={async () => {
                clearFeedback();
                const snap = await createMonthlySnapshotNow();
                setNotice(`Monthly snapshot (${snap.monthKey}) updated in IndexedDB.`);
              }}
              className="rounded-lg border app-border px-3 py-1.5 text-xs font-medium min-h-[36px]"
            >
              Snapshot Now
            </button>
          </div>
        </div>

        {autoBackups.length === 0 ? (
          <div className="text-xs app-text-muted py-4">No monthly snapshots stored yet.</div>
        ) : (
          <div className="divide-y app-border border-t app-border">
            {autoBackups.map((snap) => (
              <div
                key={snap.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-semibold font-mono-tabular">Snapshot {snap.monthKey}</div>
                  <div className="app-text-muted font-mono-tabular mt-0.5">
                    {snap.transactionCount} transactions · Saved{' '}
                    {new Date(snap.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const pw = window.prompt(
                      'Enter a password (min 8 chars) to encrypt this downloaded backup file:'
                    );
                    if (!pw || pw.length < 8) {
                      setError('Download cancelled: password must be at least 8 characters.');
                      return;
                    }
                    const fileObj = await downloadAutoBackupSnapshot(snap, pw);
                    downloadJsonFile(fileObj, `MyFirstAccount_AutoBackup_${snap.monthKey}.mfa`);
                    setNotice(`Downloaded encrypted snapshot for ${snap.monthKey}.`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-1.5 text-xs font-medium min-h-[36px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .mfa</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
