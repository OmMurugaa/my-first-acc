import React, {useEffect, useState} from 'react';
import {Check, CheckCircle2, Save} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import {APP_NAME, APP_VERSION} from '../types/finance';
import type {
  CurrencyCode,
  DateFormat,
  Language,
  NumberFormat,
  ThemeMode,
} from '../types/finance';
import {CURRENCY_META} from '../utils/formatters';
import {CategoriesView} from './CategoriesView';
import {PWAInstallButton} from './PWAComponents';

export const PreferencesView: React.FC = () => {
  const {settings, updateSettings, setTheme} = useVault();

  const [language, setLanguage] = useState<Language>(settings.language);
  const [currency, setCurrency] = useState<CurrencyCode>(settings.currency);
  const [dateFormat, setDateFormat] = useState<DateFormat>(settings.dateFormat);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(settings.numberFormat);
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.theme);
  const [openingBalance, setOpeningBalance] = useState(String(settings.openingBalance));
  const [openingBalanceDate, setOpeningBalanceDate] = useState(settings.openingBalanceDate);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setLanguage(settings.language);
    setCurrency(settings.currency);
    setDateFormat(settings.dateFormat);
    setNumberFormat(settings.numberFormat);
    setThemeMode(settings.theme);
    setOpeningBalance(String(settings.openingBalance));
    setOpeningBalanceDate(settings.openingBalanceDate);
  }, [settings]);

  const parsedBalance = parseFloat(openingBalance || '0');
  const hasUnsavedChanges =
    language !== settings.language ||
    currency !== settings.currency ||
    dateFormat !== settings.dateFormat ||
    numberFormat !== settings.numberFormat ||
    themeMode !== settings.theme ||
    parsedBalance !== settings.openingBalance ||
    openingBalanceDate !== settings.openingBalanceDate;

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSavedMsg('');

    const val = parseFloat(openingBalance || '0');
    if (!Number.isFinite(val) || val < 0) {
      setErrorMsg('Opening Balance must be 0 or a valid positive amount.');
      return;
    }

    setSaving(true);
    try {
      if (themeMode !== settings.theme) {
        await setTheme(themeMode);
      }
      await updateSettings({
        language,
        currency,
        dateFormat,
        numberFormat,
        theme: themeMode,
        openingBalance: val,
        openingBalanceDate,
      });
      setSavedMsg('Preferences saved successfully.');
      window.setTimeout(() => setSavedMsg(''), 3500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {t(settings.language, 'navPreferences')}
          </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            Customize language, currency, theme, date &amp; number formatting, opening balance, and categories.
          </p>
        </div>
        <PWAInstallButton />
      </div>

      <form onSubmit={handleSavePreferences} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border app-surface p-5 space-y-4">
            <h2 className="text-base font-semibold">Display &amp; Regional Formatting</h2>

            <div>
              <label className="block text-xs font-medium mb-1.5">Language</label>
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value as Language);
                  setSavedMsg('');
                }}
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              >
                <option value="en">English</option>
                <option value="tanglish">Tanglish (தமிழ் + English)</option>
                <option value="ta">தமிழ் (Tamil)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Currency</label>
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value as CurrencyCode);
                  setSavedMsg('');
                }}
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              >
                {Object.entries(CURRENCY_META).map(([code, meta]) => (
                  <option key={code} value={code}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Date Format</label>
              <select
                value={dateFormat}
                onChange={(e) => {
                  setDateFormat(e.target.value as DateFormat);
                  setSavedMsg('');
                }}
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              >
                <option value="DD-MM-YYYY">DD-MM-YYYY (21-11-2026)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (21/11/2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (11/22/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2026-11-22)</option>
                <option value="DD MMM YYYY">DD MMM YYYY (22 Nov 2026)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Number Format</label>
              <select
                value={numberFormat}
                onChange={(e) => {
                  setNumberFormat(e.target.value as NumberFormat);
                  setSavedMsg('');
                }}
                className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
              >
                <option value="indian">Indian Grouping (1,00,000.00)</option>
                <option value="international">International (100,000.00)</option>
              </select>
            </div>
          </div>

          <div className="space-y-6">
            {/* Theme Picker */}
            <div className="rounded-xl border app-surface p-5 space-y-4">
              <h2 className="text-base font-semibold">Theme Mode</h2>
              <div className="grid grid-cols-2 gap-3">
                {(['dark', 'gray'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setThemeMode(mode);
                      setSavedMsg('');
                    }}
                    className={`flex items-center justify-between rounded-xl border p-4 text-left min-h-[52px] ${
                      themeMode === mode
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'app-border'
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {mode === 'dark' ? 'Dark Mode' : 'Gray Mode'}
                      </div>
                      <div className="text-xs app-text-muted">
                        {mode === 'dark' ? 'Deep Obsidian' : 'Soft Ash Gray'}
                      </div>
                    </div>
                    {themeMode === mode && <Check className="w-4 h-4 text-emerald-500" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Opening Balance Editor */}
            <div className="rounded-xl border app-surface p-5 space-y-4">
              <h2 className="text-base font-semibold">{t(settings.language, 'openingBalance')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Amount ({CURRENCY_META[currency].symbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={openingBalance}
                    onChange={(e) => {
                      setOpeningBalance(e.target.value);
                      setSavedMsg('');
                    }}
                    className="w-full rounded-lg border app-input px-3 py-2 text-sm font-mono-tabular min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">As of Date</label>
                  <input
                    type="date"
                    value={openingBalanceDate}
                    onChange={(e) => {
                      setOpeningBalanceDate(e.target.value);
                      setSavedMsg('');
                    }}
                    className="w-full rounded-lg border app-input px-3 py-2 text-sm font-mono-tabular min-h-[42px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Preferences Save Bar & Confirmation */}
        <div className="rounded-xl border app-surface px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            {errorMsg ? (
              <span className="text-rose-400 font-medium">{errorMsg}</span>
            ) : savedMsg ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{savedMsg}</span>
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-amber-400 font-medium">
                You have unsaved changes. Click Save to apply.
              </span>
            ) : (
              <span className="app-text-muted">All preference settings are saved.</span>
            )}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-semibold text-white min-h-[40px] disabled:opacity-60"
            style={{backgroundColor: 'var(--accent-primary)'}}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : t(settings.language, 'save')}</span>
          </button>
        </div>
      </form>

      {/* Application Information */}
      <div className="rounded-xl border app-surface p-5 space-y-2">
        <h2 className="text-base font-semibold">Application Information</h2>
        <div className="text-xs sm:text-sm app-text-muted space-y-1 leading-relaxed">
          <div className="font-semibold app-text-secondary">
            {APP_NAME} v{APP_VERSION}
          </div>
          <div>
            Currency: {settings.currency === 'EUR' ? 'Euro (€)' : CURRENCY_META[settings.currency]?.label}
          </div>
          <div>Date format: {settings.dateFormat}</div>
          <p className="pt-1">
            Data is stored encrypted in this browser&apos;s IndexedDB. Clearing browser data will
            erase it, so create backups regularly.
          </p>
        </div>
      </div>

      <CategoriesView embedded />
    </div>
  );
};
