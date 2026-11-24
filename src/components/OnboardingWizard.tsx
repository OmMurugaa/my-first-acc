import React, {useEffect, useState} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {benchmarkPBKDF2} from '../crypto/webCrypto';
import {useVault} from '../context/VaultContext';
import type {
  CurrencyCode,
  DateFormat,
  Language,
  NumberFormat,
  ThemeMode,
} from '../types/finance';
import {CURRENCY_META, getTodayISO} from '../utils/formatters';

export const OnboardingWizard: React.FC = () => {
  const {initializeNewVault, restoreFromBackupFile, setTheme} = useVault();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [language, setLanguage] = useState<Language>('en');
  const [currency, setCurrency] = useState<CurrencyCode>('EUR');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD-MM-YYYY');
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('international');

  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingBalanceDate, setOpeningBalanceDate] = useState(getTodayISO());

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);

  const [benchmarking, setBenchmarking] = useState(false);
  const [iterations, setIterations] = useState(600000);
  const [benchmarkMs, setBenchmarkMs] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Backup restore modal state
  const [showRestore, setShowRestore] = useState(false);
  const [backupFileContent, setBackupFileContent] = useState('');
  const [backupFileName, setBackupFileName] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [restoring, setRestoring] = useState(false);

  const runBenchmark = async () => {
    setBenchmarking(true);
    try {
      const result = await benchmarkPBKDF2();
      setIterations(result.recommendedIterations);
      setBenchmarkMs(result.estimated600kMs);
    } finally {
      setBenchmarking(false);
    }
  };

  useEffect(() => {
    if (step === 3 && benchmarkMs === null) {
      void runBenchmark();
    }
  }, [step, benchmarkMs]);

  const handleThemeSelect = (mode: ThemeMode) => {
    setThemeMode(mode);
    void setTheme(mode);
  };

  const getPasswordStrength = (pw: string): {label: string; score: number} => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return {label: 'Weak', score: 1};
    if (score === 2) return {label: 'Fair', score: 2};
    if (score === 3) return {label: 'Strong', score: 3};
    return {label: 'Very Strong', score: 4};
  };

  const strength = getPasswordStrength(password);

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Master Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const parsedBal = parseFloat(openingBalance || '0');
    if (!Number.isFinite(parsedBal) || parsedBal < 0) {
      setError('Opening Balance must be 0 or a valid positive amount.');
      return;
    }

    setSubmitting(true);
    try {
      await initializeNewVault({
        language,
        currency,
        theme: themeMode,
        dateFormat,
        numberFormat,
        openingBalance: parsedBal,
        openingBalanceDate,
        password,
        iterations,
        benchmarkMs: benchmarkMs || 0,
        autoLockMinutes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize encrypted vault.');
      setSubmitting(false);
    }
  };

  const handleBackupFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupFileName(file.name);
    setBackupFileContent(await file.text());
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!backupFileContent) {
      setError('Please select an encrypted .mfa or .MyPET backup file.');
      return;
    }
    if (!backupPassword) {
      setError('Enter the backup decryption password.');
      return;
    }
    setRestoring(true);
    try {
      await restoreFromBackupFile(backupFileContent, backupPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup restore failed.');
      setRestoring(false);
    }
  };

  return (
    <div className="min-h-screen app-canvas flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl rounded-2xl border app-surface p-6 sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b app-border">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              MyFirst Account App
            </h1>
            <p className="mt-1 text-sm app-text-muted">
              Step {step} of 3 · Offline AES-256-GCM Encrypted Personal Finance Vault
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError('');
              setShowRestore((v) => !v);
            }}
            className="inline-flex items-center gap-2 rounded-lg border app-border px-3.5 py-2 text-xs font-medium hover:opacity-80 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{showRestore ? 'Back to Setup' : 'Restore Backup'}</span>
          </button>
        </div>

        {/* Step progress bar */}
        {!showRestore && (
          <div className="grid grid-cols-3 gap-2 my-6">
            {[
              {id: 1, title: '01. Preferences'},
              {id: 2, title: '02. Opening Balance'},
              {id: 3, title: '03. Security & Key'},
            ].map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  step === item.id
                    ? 'border-emerald-500 text-emerald-500'
                    : step > item.id
                      ? 'app-border app-text-secondary'
                      : 'app-border app-text-muted opacity-60'
                }`}
              >
                {item.title}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
            {error}
          </div>
        )}

        {showRestore ? (
          <form onSubmit={handleRestoreSubmit} className="mt-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Restore from Encrypted Backup</h2>
              <p className="mt-1 text-sm app-text-muted">
                Select your <span className="font-mono-tabular">.mfa</span> or MyPET Super{' '}
                <span className="font-mono-tabular">.MyPET</span> encrypted backup file and enter its backup password to decrypt and load your vault locally.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Backup File (.mfa / .MyPET / .json)</label>
              <label className="flex items-center justify-center gap-2 w-full rounded-xl border border-dashed app-border p-5 cursor-pointer hover:border-emerald-500 transition-colors text-sm app-text-secondary">
                <Upload className="w-4 h-4" />
                <span>{backupFileName || 'Choose .mfa or .MyPET encrypted backup file...'}</span>
                <input
                  type="file"
                  accept=".mfa,.mypet,.MyPET,.json"
                  onChange={handleBackupFileSelect}
                  className="hidden"
                />
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Backup Password</label>
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Enter backup decryption password"
                className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                required
              />
            </div>
            <button
              type="submit"
              disabled={restoring}
              className="w-full rounded-lg py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60 min-h-[44px]"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              {restoring ? 'Decrypting & Restoring Vault...' : 'Decrypt & Restore Vault'}
            </button>
          </form>
        ) : step === 1 ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                >
                  <option value="en">English</option>
                  <option value="tanglish">Tanglish (தமிழ் + English)</option>
                  <option value="ta">தமிழ் (Tamil)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                >
                  {Object.entries(CURRENCY_META).map(([code, meta]) => (
                    <option key={code} value={code}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Theme Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleThemeSelect('dark')}
                  className={`flex items-center justify-between rounded-xl border p-4 text-left transition-colors min-h-[52px] ${
                    themeMode === 'dark'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'app-border hover:opacity-85'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold">Dark Mode</div>
                    <div className="text-xs app-text-muted">Deep obsidian contrast</div>
                  </div>
                  {themeMode === 'dark' && <Check className="w-4 h-4 text-emerald-500" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleThemeSelect('gray')}
                  className={`flex items-center justify-between rounded-xl border p-4 text-left transition-colors min-h-[52px] ${
                    themeMode === 'gray'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'app-border hover:opacity-85'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold">Gray Mode</div>
                    <div className="text-xs app-text-muted">Soft neutral slate surface</div>
                  </div>
                  {themeMode === 'gray' && <Check className="w-4 h-4 text-emerald-500" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Date Format</label>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                >
                  <option value="DD-MM-YYYY">DD-MM-YYYY (21-11-2026)</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY (21/11/2026)</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY (11/22/2026)</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD (2026-11-22)</option>
                  <option value="DD MMM YYYY">DD MMM YYYY (22 Nov 2026)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Number Format</label>
                <select
                  value={numberFormat}
                  onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                >
                  <option value="indian">Indian Grouping (1,00,000.00)</option>
                  <option value="international">International (100,000.00)</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white min-h-[44px]"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : step === 2 ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Set Opening Balance</h2>
              <p className="mt-1 text-sm app-text-muted">
                Enter your starting cash or bank balance before logging new entries. You can adjust this later in Preferences.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Opening Balance ({CURRENCY_META[currency].symbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm font-mono-tabular min-h-[44px]"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">As of Date</label>
                <input
                  type="date"
                  value={openingBalanceDate}
                  onChange={(e) => setOpeningBalanceDate(e.target.value)}
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm font-mono-tabular min-h-[44px]"
                />
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 rounded-lg border app-border px-4 py-2.5 text-sm font-medium min-h-[44px]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white min-h-[44px]"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                <span>Continue to Security</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleFinish} className="space-y-5">
            <div className="rounded-xl border app-border app-surface-elevated p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Cpu className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">PBKDF2-SHA-256 Device Benchmark</div>
                  <div className="text-xs app-text-muted mt-0.5 font-mono-tabular">
                    {benchmarking
                      ? 'Calibrating device crypto speed...'
                      : `${iterations.toLocaleString()} iterations · Est. ${benchmarkMs ?? 0} ms unlock`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={runBenchmark}
                disabled={benchmarking}
                className="rounded-lg border app-border px-3 py-1.5 text-xs font-medium hover:opacity-80 min-h-[36px]"
              >
                {benchmarking ? 'Running...' : 'Re-Benchmark'}
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Master Password (Minimum 8 Characters)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create strong master password..."
                  className="w-full rounded-lg border app-input px-3.5 py-2.5 pr-11 text-sm min-h-[44px]"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 app-text-muted"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <div className="flex gap-1.5 flex-1 max-w-[180px]">
                    {[1, 2, 3, 4].map((bar) => (
                      <div
                        key={bar}
                        className={`h-1.5 flex-1 rounded-full ${
                          bar <= strength.score
                            ? strength.score <= 1
                              ? 'bg-rose-500'
                              : strength.score === 2
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            : 'bg-slate-700/40'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="app-text-muted ml-3">Strength: {strength.label}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Confirm Master Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter master password..."
                className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
                minLength={8}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Auto-Lock Inactivity Timer</label>
              <select
                value={autoLockMinutes}
                onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                className="w-full rounded-lg border app-input px-3.5 py-2.5 text-sm min-h-[44px]"
              >
                <option value={1}>After 1 minute</option>
                <option value={5}>After 5 minutes (Recommended)</option>
                <option value={15}>After 15 minutes</option>
                <option value={30}>After 30 minutes</option>
                <option value={0}>Manual Lock Only</option>
              </select>
            </div>

            <div className="rounded-xl border app-border p-3.5 text-xs app-text-muted flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                Your password never leaves this device and is never stored in plain text. Only a salted verifier hash and an AES-256-GCM wrapped random 256-bit DEK are stored locally. Keep an encrypted backup safe, as lost passwords cannot be recovered.
              </span>
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 rounded-lg border app-border px-4 py-2.5 text-sm font-medium min-h-[44px]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="submit"
                disabled={submitting || benchmarking}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 min-h-[44px]"
                style={{backgroundColor: 'var(--accent-primary)'}}
              >
                <Lock className="w-4 h-4" />
                <span>{submitting ? 'Encrypting Vault...' : 'Create Encrypted Vault'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
