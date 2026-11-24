import React, {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {Transaction} from '../types/finance';
import {
  exportTransactionsToExcel,
  formatDateDisplay,
  formatMoney,
} from '../utils/formatters';
import {PasswordConfirmModal} from './PasswordConfirmModal';

interface TransactionsViewProps {
  onEditTransaction: (tx: Transaction) => void;
}

type SortField = 'date' | 'amount' | 'category' | 'type';

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  onEditTransaction,
}) => {
  const {
    settings,
    categories,
    transactions,
    trash,
    deleteTransaction,
    restoreFromTrash,
    permanentlyDeleteTrash,
    emptyTrash,
  } = useVault();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showTrash, setShowTrash] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false);
  const [undoToast, setUndoToast] = useState<{trashId: string; label: string} | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const duplicateExtras = useMemo(() => {
    const seen = new Map<string, Transaction>();
    const extras: Transaction[] = [];
    const sortedAsc = [...transactions].sort((a, b) => a.createdAt - b.createdAt);
    for (const tx of sortedAsc) {
      const normalizedNotes = (tx.notes || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const key = `${tx.date}|${tx.type}|${Math.round(tx.amount * 100)}|${normalizedNotes}`;
      if (seen.has(key)) {
        extras.push(tx);
      } else {
        seen.set(key, tx);
      }
    }
    return extras.sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && tx.categoryId !== categoryFilter) return false;
      if (fromDate && tx.date < fromDate) return false;
      if (toDate && tx.date > toDate) return false;
      if (q) {
        const catName = (catMap.get(tx.categoryId) || 'Others').toLowerCase();
        const hit =
          tx.id.toLowerCase().includes(q) ||
          tx.notes.toLowerCase().includes(q) ||
          catName.includes(q) ||
          String(tx.amount).includes(q) ||
          tx.date.includes(q);
        if (!hit) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') {
        cmp = a.date.localeCompare(b.date);
        if (cmp === 0) cmp = a.createdAt - b.createdAt;
      } else if (sortField === 'amount') {
        cmp = a.amount - b.amount;
      } else if (sortField === 'category') {
        const ca = catMap.get(a.categoryId) || 'Others';
        const cb = catMap.get(b.categoryId) || 'Others';
        cmp = ca.localeCompare(cb);
      } else {
        cmp = a.type.localeCompare(b.type);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [transactions, search, typeFilter, categoryFilter, fromDate, toDate, sortField, sortDir, catMap]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, safePage, pageSize]);

  const filteredTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const tx of filteredAndSorted) {
      if (tx.type === 'income') inc += tx.amount;
      else exp += tx.amount;
    }
    return {inc, exp, net: inc - exp};
  }, [filteredAndSorted]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'date' || field === 'amount' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const executeSingleDelete = async (tx: Transaction) => {
    const trashed = await deleteTransaction(tx.id);
    if (trashed) {
      setUndoToast({
        trashId: trashed.id,
        label: `${catMap.get(tx.categoryId) || 'Others'} (${formatMoney(tx.amount, settings.currency, settings.numberFormat)})`,
      });
    }
  };

  const handleDelete = (tx: Transaction) => {
    if (settings.confirmOnSensitiveActions) {
      setPendingDeleteAction({
        title: 'Confirm Transaction Delete',
        description: `Enter your Master Password to delete ${catMap.get(tx.categoryId) || 'Others'} (${formatMoney(tx.amount, settings.currency, settings.numberFormat)}).`,
        confirmLabel: 'Verify & Move to Trash',
        run: () => executeSingleDelete(tx),
      });
      return;
    }
    void executeSingleDelete(tx);
  };

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setCategoryFilter('all');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const executeCleanAllDuplicates = async () => {
    setCleaningDuplicates(true);
    try {
      for (const dup of duplicateExtras) {
        await deleteTransaction(dup.id);
      }
      setShowDuplicatesModal(false);
    } finally {
      setCleaningDuplicates(false);
    }
  };

  const handleCleanAllDuplicates = () => {
    if (duplicateExtras.length === 0) return;
    if (settings.confirmOnSensitiveActions) {
      setPendingDeleteAction({
        title: 'Confirm Duplicate Cleanup',
        description: `Enter your Master Password to move ${duplicateExtras.length} duplicate copy(ies) to Trash.`,
        confirmLabel: 'Verify & Remove Duplicates',
        run: executeCleanAllDuplicates,
      });
      return;
    }
    void executeCleanAllDuplicates();
  };

  return (
    <div className="space-y-5">
      {/* Sticky Header + Filters Toolbar */}
      <div className="app-sticky-panel -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 md:pb-4 md:border-b app-border space-y-4">
        {/* Header */}
        <div className="sticky top-13 z-20 app-canvas -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 md:static md:mt-0 md:pt-0 md:mx-0 md:px-0 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {t(settings.language, 'navTransactions')}
            </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted font-mono-tabular">
            {filteredAndSorted.length} matching entries · Income{' '}
            {formatMoney(filteredTotals.inc, settings.currency, settings.numberFormat)} · Expenses{' '}
            {formatMoney(filteredTotals.exp, settings.currency, settings.numberFormat)}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          {duplicateExtras.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDuplicatesModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 min-h-[40px] whitespace-nowrap shrink-0"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Duplicates ({duplicateExtras.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowTrash(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            <span>
              {t(settings.language, 'trashBin')} ({trash.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'printLedger')}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportTransactionsToExcel(
                filteredAndSorted,
                categories,
                settings.currency,
                settings.dateFormat,
                'MyFirstAccount_Filtered_Ledger'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px] whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{t(settings.language, 'exportExcel')}</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="no-print rounded-xl border app-surface p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 app-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t(settings.language, 'searchPlaceholder')}
              className="w-full rounded-lg border app-input pl-9 pr-3 py-2 text-sm min-h-[42px]"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as 'all' | 'income' | 'expense');
                setPage(1);
              }}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
            >
              <option value="all">{t(settings.language, 'allTypes')}</option>
              <option value="income">{t(settings.language, 'income')}</option>
              <option value="expense">{t(settings.language, 'expenses')}</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
            >
              <option value="all">{t(settings.language, 'allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} ({cat.type === 'income' ? 'Income' : 'Expense'})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] app-text-muted mb-1">
                {t(settings.language, 'fromDate')}
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border app-input px-3 py-1.5 text-xs font-mono-tabular min-h-[38px]"
              />
            </div>
            <div>
              <label className="block text-[11px] app-text-muted mb-1">
                {t(settings.language, 'toDate')}
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border app-input px-3 py-1.5 text-xs font-mono-tabular min-h-[38px]"
              />
            </div>
            {(search || typeFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate) && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium app-text-muted hover:underline pb-2"
              >
                Reset Filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs app-text-muted">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border app-input px-2.5 py-1.5 text-xs font-mono-tabular min-h-[36px]"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>
      </div>

      {/* Ledger Table */}
      <div className="rounded-xl border app-surface overflow-hidden">
        {paginatedRows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm app-text-muted">
              {transactions.length === 0
                ? t(settings.language, 'noTransactions')
                : 'No transactions match your current filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b app-border app-surface-elevated text-xs app-text-muted">
                  <th className="py-3 px-4 font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="inline-flex items-center gap-1 hover:opacity-80"
                    >
                      <span>{t(settings.language, 'date')}</span>
                      <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('category')}
                      className="inline-flex items-center gap-1 hover:opacity-80"
                    >
                      <span>{t(settings.language, 'category')}</span>
                      <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('type')}
                      className="inline-flex items-center gap-1 hover:opacity-80"
                    >
                      <span>{t(settings.language, 'classification')}</span>
                      <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-medium">{t(settings.language, 'notes')}</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort('amount')}
                      className="inline-flex items-center gap-1 hover:opacity-80 ml-auto"
                    >
                      <span>{t(settings.language, 'amount')}</span>
                      <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  {settings.confirmOnSensitiveActions && (
                    <th className="no-print py-3 px-4 font-medium text-right whitespace-nowrap">
                      {t(settings.language, 'actions')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y app-border">
                {paginatedRows.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-black/5 dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-4 font-mono-tabular text-xs whitespace-nowrap">
                      {formatDateDisplay(tx.date, settings.dateFormat)}
                    </td>
                    <td className="py-3 px-4 font-medium whitespace-nowrap">
                      {catMap.get(tx.categoryId) || 'Others'}
                    </td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      <span
                        style={{
                          color:
                            tx.type === 'income' ? 'var(--income-text)' : 'var(--expense-text)',
                        }}
                      >
                        {tx.type === 'income' ? 'Income' : 'Expense'}
                      </span>
                    </td>
                    <td className="py-3 px-4 app-text-secondary max-w-xs truncate">
                      {tx.notes || '—'}
                    </td>
                    <td
                      className="py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap"
                      style={{
                        color:
                          tx.type === 'income' ? 'var(--income-text)' : 'var(--expense-text)',
                      }}
                    >
                      {formatMoney(tx.amount, settings.currency, settings.numberFormat, {
                        type: tx.type,
                      })}
                    </td>
                    {settings.confirmOnSensitiveActions && (
                      <td className="no-print py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditTransaction(tx)}
                            className="p-2 rounded-lg app-text-muted hover:opacity-80 min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
                            aria-label="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(tx)}
                            className="p-2 rounded-lg app-text-muted hover:text-rose-500 min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
                            aria-label="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filteredAndSorted.length > 0 && (
          <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t app-border text-xs app-text-muted">
            <span className="font-mono-tabular">
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredAndSorted.length)} of{' '}
              {filteredAndSorted.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border app-border px-3 py-1.5 disabled:opacity-40 min-h-[36px]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <span className="font-mono-tabular px-2">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border app-border px-3 py-1.5 disabled:opacity-40 min-h-[36px]"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trash / Undo Delete Modal */}
      {showTrash &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-2xl rounded-2xl border app-surface p-6 shadow-xl max-h-[85vh] flex flex-col animate-mfa-modal">
            <div className="flex items-center justify-between pb-4 border-b app-border">
              <div>
                <h2 className="text-lg font-semibold">{t(settings.language, 'trashBin')}</h2>
                <p className="text-xs app-text-muted mt-0.5">
                  Deleted transactions remain encrypted in Trash until restored or permanently cleared.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTrash(false)}
                className="p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y app-border my-4">
              {trash.length === 0 ? (
                <div className="py-10 text-center text-sm app-text-muted">Trash is empty.</div>
              ) : (
                trash.map((item) => (
                  <div
                    key={item.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {catMap.get(item.transaction.categoryId) || 'Others'} ·{' '}
                        <span className="font-mono-tabular">
                          {formatMoney(
                            item.transaction.amount,
                            settings.currency,
                            settings.numberFormat,
                            {type: item.transaction.type}
                          )}
                        </span>
                      </div>
                      <div className="text-xs app-text-muted font-mono-tabular mt-0.5">
                        {formatDateDisplay(item.transaction.date, settings.dateFormat)}
                        {item.transaction.notes ? ` · ${item.transaction.notes}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void restoreFromTrash(item.id)}
                        className="rounded-lg border app-border px-3 py-1.5 text-xs font-medium hover:opacity-80 min-h-[36px]"
                      >
                        {t(settings.language, 'restore')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void permanentlyDeleteTrash(item.id)}
                        className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 min-h-[36px]"
                      >
                        Delete Forever
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t app-border flex items-center justify-between">
              {trash.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void emptyTrash()}
                  className="text-xs font-medium text-rose-400 hover:underline"
                >
                  Empty Trash Permanently
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setShowTrash(false)}
                className="rounded-lg border app-border px-4 py-2 text-xs font-medium min-h-[38px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}

      {/* Duplicate Cleanup Modal */}
      {showDuplicatesModal &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-2xl rounded-2xl border app-surface p-6 shadow-xl max-h-[85vh] flex flex-col animate-mfa-modal">
            <div className="flex items-center justify-between pb-4 border-b app-border">
              <div>
                <h2 className="text-lg font-semibold">Duplicate Entries Detected</h2>
                <p className="text-xs app-text-muted mt-0.5">
                  The extra copies below share the exact same date, type, amount, and notes. Removing moves only the duplicate copy safely to Trash.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="p-2 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y app-border my-4">
              {duplicateExtras.length === 0 ? (
                <div className="py-10 text-center text-sm app-text-muted">No duplicates found.</div>
              ) : (
                duplicateExtras.map((dup) => (
                  <div
                    key={dup.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <span>{catMap.get(dup.categoryId) || 'Others'}</span>
                        <span
                          className="font-mono-tabular font-semibold"
                          style={{
                            color:
                              dup.type === 'income'
                                ? 'var(--income-text)'
                                : 'var(--expense-text)',
                          }}
                        >
                          {formatMoney(dup.amount, settings.currency, settings.numberFormat, {
                            type: dup.type,
                          })}
                        </span>
                      </div>
                      <div className="text-xs app-text-muted font-mono-tabular mt-0.5 truncate">
                        {formatDateDisplay(dup.date, settings.dateFormat)}
                        {dup.notes ? ` · ${dup.notes}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(dup)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 min-h-[36px] shrink-0"
                    >
                      Remove Copy
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t app-border flex items-center justify-between gap-3">
              {duplicateExtras.length > 0 ? (
                <button
                  type="button"
                  disabled={cleaningDuplicates}
                  onClick={() => void handleCleanAllDuplicates()}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white min-h-[38px] disabled:opacity-50"
                  style={{backgroundColor: 'var(--accent-primary)'}}
                >
                  {cleaningDuplicates
                    ? 'Removing...'
                    : `Remove All ${duplicateExtras.length} Duplicate Copies`}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setShowDuplicatesModal(false)}
                className="rounded-lg border app-border px-4 py-2 text-xs font-medium min-h-[38px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}

      {/* Password Confirmation Modal for Protected Deletes */}
      <PasswordConfirmModal
        isOpen={Boolean(pendingDeleteAction)}
        title={pendingDeleteAction?.title || 'Confirm Delete'}
        description={pendingDeleteAction?.description || ''}
        confirmLabel={pendingDeleteAction?.confirmLabel || 'Verify & Delete'}
        onCancel={() => setPendingDeleteAction(null)}
        onVerified={async () => {
          if (pendingDeleteAction) {
            await pendingDeleteAction.run();
          }
        }}
      />

      {/* Undo Delete Toast */}
      {undoToast && (
        <div className="no-print fixed bottom-20 lg:bottom-6 right-4 z-40 flex items-center gap-3 rounded-xl border app-border app-surface-elevated px-4 py-3 text-xs shadow-lg">
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
          <button type="button" onClick={() => setUndoToast(null)} className="app-text-muted">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
