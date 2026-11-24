import React, {useEffect, useMemo, useState} from 'react';
import {AlertTriangle, CheckCircle2, Plus} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {ActiveTab, Transaction, TransactionType} from '../types/finance';
import {
  CURRENCY_META,
  findDuplicateTransaction,
  formatDateDisplay,
  formatMoney,
  getDefaultCategoryId,
  getTodayISO,
  validateTransactionInput,
} from '../utils/formatters';

interface AddTransactionViewProps {
  defaultType?: TransactionType;
  onNavigate: (tab: ActiveTab) => void;
}

export const AddTransactionView: React.FC<AddTransactionViewProps> = ({
  defaultType = 'expense',
  onNavigate,
}) => {
  const {settings, categories, transactions, addTransaction} = useVault();

  const [type, setType] = useState<TransactionType>(defaultType);
  const [date, setDate] = useState(getTodayISO());
  const [amount, setAmount] = useState('');
  const [incomeCategoryId, setIncomeCategoryId] = useState(() =>
    getDefaultCategoryId(categories, 'income')
  );
  const [expenseCategoryId, setExpenseCategoryId] = useState(() =>
    getDefaultCategoryId(categories, 'expense')
  );
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<string[]>([]);
  const [duplicateMatch, setDuplicateMatch] = useState<Transaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  const categoryId = type === 'income' ? incomeCategoryId : expenseCategoryId;
  const setActiveCategoryId = (nextId: string) => {
    if (type === 'income') setIncomeCategoryId(nextId);
    else setExpenseCategoryId(nextId);
  };

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  );

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const latestAdded = useMemo(
    () => [...transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [transactions]
  );

  useEffect(() => {
    setType(defaultType);
    setErrors([]);
    setDuplicateMatch(null);
  }, [defaultType]);

  // Only fill default if categoryId is missing or deleted, never overwrite a valid user selection
  useEffect(() => {
    const incValid = categories.some((c) => c.type === 'income' && c.id === incomeCategoryId);
    if (!incValid) {
      setIncomeCategoryId(getDefaultCategoryId(categories, 'income'));
    }
    const expValid = categories.some((c) => c.type === 'expense' && c.id === expenseCategoryId);
    if (!expValid) {
      setExpenseCategoryId(getDefaultCategoryId(categories, 'expense'));
    }
  }, [categories, incomeCategoryId, expenseCategoryId]);

  const performSave = async () => {
    setSaving(true);
    setSavedNotice('');
    try {
      const numericAmount = parseFloat(amount);
      await addTransaction({
        date,
        amount: numericAmount,
        categoryId,
        type,
        notes,
      });
      const catName = catMap.get(categoryId) || 'Others';
      setSavedNotice(
        `Saved ${type === 'income' ? 'Income' : 'Expense'}: ${catName} (${formatMoney(numericAmount, settings.currency, settings.numberFormat)})`
      );
      setAmount('');
      setNotes('');
      setDuplicateMatch(null);
      setIncomeCategoryId(getDefaultCategoryId(categories, 'income'));
      setExpenseCategoryId(getDefaultCategoryId(categories, 'expense'));
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Unable to save transaction.']);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setSavedNotice('');

    const validation = validateTransactionInput({date, amount, categoryId, type});
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const numericAmount = parseFloat(amount);
    if (!duplicateMatch) {
      const dup = findDuplicateTransaction(
        {date, amount: numericAmount, type, notes},
        transactions
      );
      if (dup) {
        setDuplicateMatch(dup);
        return;
      }
    }

    await performSave();
  };

  return (
    <div className="space-y-6">
      <div className="app-sticky-header -mt-6 pt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 flex flex-wrap items-center justify-between gap-4 pb-4 border-b app-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {t(settings.language, 'addTransaction')}
          </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            Log a new encrypted income or expense transaction into your vault.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('transactions')}
          className="rounded-lg border app-border px-3.5 py-2 text-xs font-medium app-text-secondary hover:opacity-80 min-h-[40px]"
        >
          View Transactions
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 rounded-xl border app-surface p-5 sm:p-6 space-y-4"
        >
          {savedNotice && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}

          {/* Classification Segmented Control */}
          <div>
            <label className="block text-xs font-medium app-text-secondary mb-1.5">
              {t(settings.language, 'classification')}
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg border app-border app-surface-elevated">
              <button
                type="button"
                onClick={() => {
                  setType('income');
                  setDuplicateMatch(null);
                }}
                className={`py-2.5 text-sm font-semibold rounded-md transition-colors min-h-[42px] ${
                  type === 'income' ? 'bg-emerald-600 text-white' : 'app-text-muted'
                }`}
              >
                {t(settings.language, 'income')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setType('expense');
                  setDuplicateMatch(null);
                }}
                className={`py-2.5 text-sm font-semibold rounded-md transition-colors min-h-[42px] ${
                  type === 'expense' ? 'bg-rose-600 text-white' : 'app-text-muted'
                }`}
              >
                {t(settings.language, 'expenses')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium app-text-secondary mb-1.5">
                {t(settings.language, 'date')}
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDuplicateMatch(null);
                }}
                className="w-full rounded-lg border app-input px-3 py-2.5 text-sm font-mono-tabular min-h-[44px]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium app-text-secondary mb-1.5">
                {t(settings.language, 'amount')} ({CURRENCY_META[settings.currency].symbol})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setDuplicateMatch(null);
                }}
                placeholder="0.00"
                className="w-full rounded-lg border app-input px-3 py-2.5 text-sm font-mono-tabular min-h-[44px]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium app-text-secondary mb-1.5">
              {t(settings.language, 'category')}
            </label>
            <select
              value={categoryId}
              onChange={(e) => setActiveCategoryId(e.target.value)}
              className="w-full rounded-lg border app-input px-3 py-2.5 text-sm min-h-[44px]"
              required
            >
              {filteredCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium app-text-secondary mb-1.5">
              {t(settings.language, 'notes')}
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDuplicateMatch(null);
              }}
              placeholder="Merchant, description, or reference..."
              className="w-full rounded-lg border app-input px-3 py-2.5 text-sm resize-none"
            />
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400 space-y-1">
              {errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          )}

          {duplicateMatch && (
            <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Potential Duplicate Detected</span>
              </div>
              <p className="app-text-secondary">
                Similar entry exists on {formatDateDisplay(duplicateMatch.date, settings.dateFormat)} ·{' '}
                <span className="font-mono-tabular">
                  {formatMoney(duplicateMatch.amount, settings.currency, settings.numberFormat)}
                </span>{' '}
                {duplicateMatch.notes ? `· "${duplicateMatch.notes}"` : ''}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void performSave()}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white min-h-[36px]"
                >
                  Save Anyway
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateMatch(null)}
                  className="rounded-lg border app-border px-3 py-1.5 text-xs font-medium min-h-[36px]"
                >
                  Edit Entry
                </button>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="rounded-lg border app-border px-4 py-2.5 text-sm font-medium min-h-[44px]"
            >
              {t(settings.language, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white min-h-[44px] disabled:opacity-60"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Encrypting...' : t(settings.language, 'save')}</span>
            </button>
          </div>
        </form>

        {/* Last 5 Newly Added Records */}
        <div className="lg:col-span-5 rounded-xl border app-surface overflow-hidden">
          <div className="px-5 py-4 border-b app-border">
            <h2 className="text-sm font-semibold">Latest Added Entries</h2>
            <p className="text-xs app-text-muted mt-0.5">Last 5 recorded transactions</p>
          </div>
          {latestAdded.length === 0 ? (
            <div className="p-6 text-center text-xs app-text-muted">
              {t(settings.language, 'noTransactions')}
            </div>
          ) : (
            <div className="divide-y app-border">
              {latestAdded.map((tx) => (
                <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">
                      {tx.notes || catMap.get(tx.categoryId) || 'Others'}
                    </div>
                    <div className="text-[11px] app-text-muted font-mono-tabular mt-0.5">
                      {formatDateDisplay(tx.date, settings.dateFormat)} ·{' '}
                      {catMap.get(tx.categoryId) || 'Others'}
                    </div>
                  </div>
                  <span
                    className="text-xs font-semibold font-mono-tabular shrink-0"
                    style={{
                      color: tx.type === 'income' ? 'var(--income-text)' : 'var(--expense-text)',
                    }}
                  >
                    {formatMoney(tx.amount, settings.currency, settings.numberFormat, {
                      type: tx.type,
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
