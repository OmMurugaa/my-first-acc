import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ListOrdered,
  Lock,
  Moon,
  Pencil,
  Plus,
  Printer,
  Sun,
  Trash2,
  Wallet,
} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {ActiveTab, Transaction, TransactionType} from '../types/finance';
import {
  exportTransactionsToExcel,
  formatDateDisplay,
  formatMoney,
  getTodayISO,
} from '../utils/formatters';
import {PasswordConfirmModal} from './PasswordConfirmModal';

interface DashboardViewProps {
  onAddTransaction: (type?: TransactionType) => void;
  onEditTransaction: (tx: Transaction) => void;
  onNavigate: (tab: ActiveTab) => void;
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onAddTransaction,
  onEditTransaction,
  onNavigate,
}) => {
  const {
    settings,
    categories,
    transactions,
    summary,
    setTheme,
    lockVault,
    deleteTransaction,
    restoreFromTrash,
    lastAutoBackupNotice,
    dismissAutoBackupNotice,
  } = useVault();

  const [now, setNow] = useState(() => new Date());
  const [recentMode, setRecentMode] = useState<'last7days' | 'latest7'>('last7days');
  const [undoToast, setUndoToast] = useState<{trashId: string; label: string} | null>(null);
  const [pendingDeleteTx, setPendingDeleteTx] = useState<Transaction | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Compute chronological S.No (1..N) and running cumulative balance after every transaction
  const {chronologicalAsc, runningMetaMap} = useMemo(() => {
    const asc = [...transactions].sort(
      (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt
    );
    let runCents = Math.round((settings.openingBalance || 0) * 100);
    const map = new Map<string, {serialNo: number; balance: number}>();
    asc.forEach((tx, idx) => {
      const amtCents = Math.round(tx.amount * 100);
      runCents += tx.type === 'income' ? amtCents : -amtCents;
      map.set(tx.id, {serialNo: idx + 1, balance: runCents / 100});
    });
    return {chronologicalAsc: asc, runningMetaMap: map};
  }, [transactions, settings.openingBalance]);

  const {recentTransactions, rangeStart, rangeEnd} = useMemo(() => {
    if (chronologicalAsc.length === 0) {
      return {recentTransactions: [] as Transaction[], rangeStart: '', rangeEnd: ''};
    }
    if (recentMode === 'latest7') {
      const rows = chronologicalAsc.slice(-7).reverse();
      return {
        recentTransactions: rows,
        rangeStart: rows[rows.length - 1]?.date || '',
        rangeEnd: rows[0]?.date || '',
      };
    }
    // Last 7 days anchored to the newest recorded transaction date
    const to = chronologicalAsc[chronologicalAsc.length - 1].date;
    const from = addDaysISO(to, -6);
    const rows = chronologicalAsc.filter((tx) => tx.date >= from).reverse();
    return {recentTransactions: rows, rangeStart: from, rangeEnd: to};
  }, [chronologicalAsc, recentMode]);

  const formattedDateTime = useMemo(() => {
    const todayIso = getTodayISO();
    const formattedDate = formatDateDisplay(todayIso, settings.dateFormat);
    const timeStr = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${formattedDate} · ${timeStr}`;
  }, [now, settings.dateFormat]);

  const currentMonthLabel = useMemo(() => {
    return now.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
  }, [now]);

  const performDelete = async (tx: Transaction) => {
    const trashed = await deleteTransaction(tx.id);
    if (trashed) {
      setUndoToast({
        trashId: trashed.id,
        label: `${catMap.get(tx.categoryId) || 'Others'} (${formatMoney(tx.amount, settings.currency, settings.numberFormat)})`,
      });
    }
  };

  const handleDeleteClick = (tx: Transaction) => {
    if (settings.confirmOnSensitiveActions) {
      setPendingDeleteTx(tx);
      return;
    }
    void performDelete(tx);
  };

  return (
    <div className="space-y-6">
      {/* Sticky Dashboard Header + 3 Core Summary Boxes */}
      <div className="app-sticky-panel -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 md:pb-5 md:border-b app-border space-y-5">
        {/* Workspace Action & Live Clock Bar */}
        <div className="sticky top-13 z-20 app-canvas -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 md:static md:mt-0 md:pt-0 md:mx-0 md:px-0 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {t(settings.language, 'navDashboard')}
            </h1>
            <p className="mt-1 text-xs sm:text-sm app-text-muted font-mono-tabular">
              {formattedDateTime} · {currentMonthLabel}
            </p>
          </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
            title={t(settings.language, 'printLedger')}
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'printLedger')}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportTransactionsToExcel(
                transactions,
                categories,
                settings.currency,
                settings.dateFormat
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
            title={t(settings.language, 'exportExcel')}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'exportExcel')}</span>
          </button>

          <button
            type="button"
            onClick={() => void setTheme(settings.theme === 'dark' ? 'gray' : 'dark')}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
            title={settings.theme === 'dark' ? 'Switch to Gray Mode' : 'Switch to Dark Mode'}
          >
            {settings.theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
            <span className="hidden md:inline">
              {settings.theme === 'dark'
                ? t(settings.language, 'grayMode')
                : t(settings.language, 'darkMode')}
            </span>
          </button>

          <button
            type="button"
            onClick={lockVault}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
            title={t(settings.language, 'lockVault')}
          >
            <Lock className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'lockVault')}</span>
          </button>
        </div>
      </div>

      {/* 3 Core Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Income */}
        <div
          className="rounded-xl border app-surface p-5 transition-colors duration-150 hover:border-[var(--border-strong)]"
          title="Total Income recorded in the current month and overall all-time total"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium app-text-muted">
              {t(settings.language, 'currentMonthIncome')}
            </span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <div
            className="mt-3 text-2xl sm:text-3xl font-bold font-mono-tabular tracking-tight"
            style={{color: 'var(--income-text)'}}
          >
            {formatMoney(summary.currentMonthIncome, settings.currency, settings.numberFormat)}
          </div>
          <div className="mt-2 text-xs app-text-muted font-mono-tabular">
            All-time: {formatMoney(summary.totalIncome, settings.currency, settings.numberFormat)}
          </div>
        </div>

        {/* 2. Expenses */}
        <div
          className="rounded-xl border app-surface p-5 transition-colors duration-150 hover:border-[var(--border-strong)]"
          title="Total Expenses recorded in the current month and overall all-time total"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium app-text-muted">
              {t(settings.language, 'currentMonthExpenses')}
            </span>
            <ArrowDownRight className="w-4 h-4 text-rose-500" />
          </div>
          <div
            className="mt-3 text-2xl sm:text-3xl font-bold font-mono-tabular tracking-tight"
            style={{color: 'var(--expense-text)'}}
          >
            {formatMoney(summary.currentMonthExpenses, settings.currency, settings.numberFormat)}
          </div>
          <div className="mt-2 text-xs app-text-muted font-mono-tabular">
            All-time: {formatMoney(summary.totalExpenses, settings.currency, settings.numberFormat)}
          </div>
        </div>

        {/* 3. Balance */}
        <div
          className="rounded-xl border app-surface p-5 transition-colors duration-150 hover:border-[var(--border-strong)]"
          title="Opening Balance + All-time Income − All-time Expenses"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium app-text-muted">
              {t(settings.language, 'currentBalance')}
            </span>
            <Wallet className="w-4 h-4" style={{color: 'var(--accent-primary)'}} />
          </div>
          <div className="mt-3 text-2xl sm:text-3xl font-bold font-mono-tabular tracking-tight">
            {formatMoney(summary.currentBalance, settings.currency, settings.numberFormat)}
          </div>
          <div className="mt-2 text-xs app-text-muted font-mono-tabular">
            Opening:{' '}
            {formatMoney(settings.openingBalance, settings.currency, settings.numberFormat)} · Month Net:{' '}
            {formatMoney(summary.currentMonthNet, settings.currency, settings.numberFormat, {
              showSign: true,
            })}
          </div>
        </div>
      </div>
      </div>

      {/* Auto-Monthly Backup Notice */}
      {lastAutoBackupNotice && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs">
          <span className="font-medium text-emerald-400">{lastAutoBackupNotice}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('backup')}
              className="font-semibold underline text-emerald-400"
            >
              Download Encrypted Copy
            </button>
            <button
              type="button"
              onClick={dismissAutoBackupNotice}
              className="app-text-muted hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Quick Actions (3 Boxes) */}
      <div className="no-print rounded-xl border app-surface p-5 space-y-3.5">
        <h2 className="text-base font-semibold">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => onAddTransaction('income')}
            title="Open Add Transaction pre-selected to Income (Salary default)"
            className="app-card-interactive group rounded-xl border app-border app-surface-elevated p-4 text-left hover:border-emerald-500/60"
          >
            <Plus className="w-4 h-4 text-emerald-500 mb-2 transition-transform duration-150 group-hover:scale-110" />
            <div className="text-sm font-semibold">Add Income</div>
            <div className="text-xs app-text-muted mt-0.5">Record money received</div>
          </button>

          <button
            type="button"
            onClick={() => onAddTransaction('expense')}
            title="Open Add Transaction pre-selected to Expense (Food default)"
            className="app-card-interactive group rounded-xl border app-border app-surface-elevated p-4 text-left hover:border-rose-500/60"
          >
            <Plus className="w-4 h-4 text-rose-500 mb-2 transition-transform duration-150 group-hover:scale-110" />
            <div className="text-sm font-semibold">Add Expense</div>
            <div className="text-xs app-text-muted mt-0.5">Record money spent</div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('transactions')}
            title="Open full ledger to search, filter, print, or export transactions"
            className="app-card-interactive group rounded-xl border app-border app-surface-elevated p-4 text-left hover:border-emerald-500/60"
          >
            <ListOrdered className="w-4 h-4 app-text-secondary mb-2 transition-transform duration-150 group-hover:scale-110" />
            <div className="text-sm font-semibold">View Transactions</div>
            <div className="text-xs app-text-muted mt-0.5">Search and manage records</div>
          </button>
        </div>
      </div>

      {/* Recent Transactions Table (S.No, Date, Description, Income, Expense, Balance) */}
      <div className="rounded-xl border app-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b app-border">
          <div>
            <h2 className="text-base font-semibold">
              {recentMode === 'last7days'
                ? 'Recent Transactions (last 7 days)'
                : t(settings.language, 'recentTransactions')}
            </h2>
            <p className="text-xs app-text-muted mt-0.5 font-mono-tabular">
              {recentTransactions.length > 0 && rangeStart && rangeEnd
                ? `${formatDateDisplay(rangeStart, settings.dateFormat)} to ${formatDateDisplay(rangeEnd, settings.dateFormat)}`
                : 'No entries recorded yet'}
            </p>
          </div>

          <div className="no-print flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg border app-border app-surface-elevated">
              <button
                type="button"
                onClick={() => setRecentMode('last7days')}
                title="Show transactions from the last 7 active days with running balance"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  recentMode === 'last7days' ? 'text-white' : 'app-text-muted hover:opacity-80'
                }`}
                style={
                  recentMode === 'last7days'
                    ? {backgroundColor: 'var(--accent-primary)'}
                    : undefined
                }
              >
                {t(settings.language, 'last7Days')}
              </button>
              <button
                type="button"
                onClick={() => setRecentMode('latest7')}
                title="Show the 7 most recent transactions regardless of date"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  recentMode === 'latest7' ? 'text-white' : 'app-text-muted hover:opacity-80'
                }`}
                style={
                  recentMode === 'latest7' ? {backgroundColor: 'var(--accent-primary)'} : undefined
                }
              >
                {t(settings.language, 'recent7Entries')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              title="Open full Transactions ledger"
              className="text-xs font-semibold hover:underline whitespace-nowrap shrink-0"
              style={{color: 'var(--accent-primary)'}}
            >
              View All ({transactions.length})
            </button>
          </div>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm app-text-muted">{t(settings.language, 'noTransactions')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="app-surface-elevated border-b app-border text-xs app-text-muted">
                <tr>
                  <th className="py-3 px-4 font-medium whitespace-nowrap w-14">S.No</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">
                    {t(settings.language, 'date')}
                  </th>
                  <th className="py-3 px-4 font-medium">Description</th>
                  <th
                    className="py-3 px-4 font-medium text-right whitespace-nowrap"
                    style={{color: 'var(--income-text)'}}
                  >
                    Income
                  </th>
                  <th
                    className="py-3 px-4 font-medium text-right whitespace-nowrap"
                    style={{color: 'var(--expense-text)'}}
                  >
                    Expense
                  </th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                    {t(settings.language, 'balance')}
                  </th>
                  {settings.confirmOnSensitiveActions && (
                    <th className="no-print py-3 px-3 font-medium text-right whitespace-nowrap">
                      {t(settings.language, 'actions')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y app-border">
                {recentTransactions.map((tx) => {
                  const meta = runningMetaMap.get(tx.id);
                  const catName = catMap.get(tx.categoryId) || 'Others';
                  const isInc = tx.type === 'income';
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono-tabular text-xs app-text-muted whitespace-nowrap">
                        {meta?.serialNo ?? '—'}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-xs whitespace-nowrap">
                        {formatDateDisplay(tx.date, settings.dateFormat)}
                      </td>
                      <td className="py-3 px-4 min-w-[200px]">
                        <div className="font-medium text-xs sm:text-sm leading-snug">
                          {tx.notes || catName}
                        </div>
                        {tx.notes && (
                          <div className="text-[11px] app-text-muted mt-0.5">{catName}</div>
                        )}
                      </td>
                      <td
                        className="py-3 px-4 text-right font-mono-tabular text-xs sm:text-sm font-semibold whitespace-nowrap"
                        style={isInc ? {color: 'var(--income-text)'} : undefined}
                      >
                        {isInc ? (
                          formatMoney(tx.amount, settings.currency, settings.numberFormat)
                        ) : (
                          <span className="app-text-muted font-normal">-</span>
                        )}
                      </td>
                      <td
                        className="py-3 px-4 text-right font-mono-tabular text-xs sm:text-sm font-semibold whitespace-nowrap"
                        style={!isInc ? {color: 'var(--expense-text)'} : undefined}
                      >
                        {!isInc ? (
                          formatMoney(tx.amount, settings.currency, settings.numberFormat)
                        ) : (
                          <span className="app-text-muted font-normal">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-xs sm:text-sm font-bold whitespace-nowrap">
                        {meta
                          ? formatMoney(meta.balance, settings.currency, settings.numberFormat)
                          : '—'}
                      </td>
                      {settings.confirmOnSensitiveActions && (
                        <td className="no-print py-2 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditTransaction(tx)}
                              title="Edit transaction (Master Password protected)"
                              className="p-1.5 rounded-lg app-text-muted hover:opacity-80 transition-opacity min-w-[32px] min-h-[32px] inline-flex items-center justify-center"
                              aria-label="Edit transaction"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(tx)}
                              title="Move transaction to Trash (Master Password protected)"
                              className="p-1.5 rounded-lg app-text-muted hover:text-rose-500 transition-colors min-w-[32px] min-h-[32px] inline-flex items-center justify-center"
                              aria-label="Delete transaction"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Password Confirmation Modal for Protected Deletes */}
      <PasswordConfirmModal
        isOpen={Boolean(pendingDeleteTx)}
        title="Confirm Transaction Delete"
        description={
          pendingDeleteTx
            ? `Enter your Master Password to delete ${catMap.get(pendingDeleteTx.categoryId) || 'Others'} (${formatMoney(pendingDeleteTx.amount, settings.currency, settings.numberFormat)}).`
            : ''
        }
        confirmLabel="Verify & Move to Trash"
        onCancel={() => setPendingDeleteTx(null)}
        onVerified={async () => {
          if (pendingDeleteTx) {
            await performDelete(pendingDeleteTx);
          }
        }}
      />

      {/* Undo Delete Toast */}
      {undoToast && (
        <div className="no-print fixed bottom-20 lg:bottom-6 right-4 z-40 flex items-center gap-3 rounded-xl border app-border app-surface-elevated px-4 py-3 text-xs shadow-lg animate-mfa-sheet">
          <span>Moved {undoToast.label} to Trash.</span>
          <button
            type="button"
            onClick={() => {
              void restoreFromTrash(undoToast.trashId);
              setUndoToast(null);
            }}
            className="font-semibold underline"
            style={{color: 'var(--accent-primary)'}}
          >
            {t(settings.language, 'undo')}
          </button>
          <button
            type="button"
            onClick={() => setUndoToast(null)}
            className="app-text-muted"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
