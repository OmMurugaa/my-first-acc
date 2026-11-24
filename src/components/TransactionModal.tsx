import React, {useEffect, useMemo, useState} from 'react';
import {AlertTriangle, X} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {Transaction, TransactionType} from '../types/finance';
import {
  CURRENCY_META,
  findDuplicateTransaction,
  formatDateDisplay,
  formatMoney,
  getDefaultCategoryId,
  getTodayISO,
  validateTransactionInput,
} from '../utils/formatters';

interface TransactionModalProps {
  isOpen: boolean;
  editingTx: Transaction | null;
  defaultType?: TransactionType;
  onClose: () => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  editingTx,
  defaultType = 'expense',
  onClose,
}) => {
  const {
    settings,
    categories,
    transactions,
    addTransaction,
    updateTransaction,
    verifyCurrentPassword,
  } = useVault();

  const [type, setType] = useState<TransactionType>('expense');
  const [date, setDate] = useState(getTodayISO());
  const [amount, setAmount] = useState('');
  const [incomeCategoryId, setIncomeCategoryId] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<string[]>([]);
  const [duplicateMatch, setDuplicateMatch] = useState<Transaction | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const categoryId = type === 'income' ? incomeCategoryId : expenseCategoryId;
  const setActiveCategoryId = (nextId: string) => {
    if (type === 'income') setIncomeCategoryId(nextId);
    else setExpenseCategoryId(nextId);
  };

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrors([]);
    setDuplicateMatch(null);
    setConfirmPassword('');

    const defaultInc = getDefaultCategoryId(categories, 'income');
    const defaultExp = getDefaultCategoryId(categories, 'expense');

    if (editingTx) {
      setType(editingTx.type);
      setDate(editingTx.date);
      setAmount(String(editingTx.amount));
      setIncomeCategoryId(editingTx.type === 'income' ? editingTx.categoryId : defaultInc);
      setExpenseCategoryId(editingTx.type === 'expense' ? editingTx.categoryId : defaultExp);
      setNotes(editingTx.notes);
    } else {
      setType(defaultType);
      setDate(getTodayISO());
      setAmount('');
      setIncomeCategoryId(defaultInc);
      setExpenseCategoryId(defaultExp);
      setNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingTx, defaultType]);

  // Only fill fallback if current categoryId is missing from valid list
  useEffect(() => {
    if (!isOpen) return;
    const valid = filteredCategories.some((c) => c.id === categoryId);
    if (!valid && filteredCategories.length > 0) {
      setActiveCategoryId(getDefaultCategoryId(categories, type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, filteredCategories, categoryId, isOpen]);

  if (!isOpen) return null;

  const performSave = async () => {
    setSaving(true);
    try {
      if (editingTx && settings.confirmOnSensitiveActions) {
        const ok = await verifyCurrentPassword(confirmPassword);
        if (!ok) {
          setErrors(['Master Password confirmation failed.']);
          setSaving(false);
          return;
        }
      }

      const numericAmount = parseFloat(amount);
      if (editingTx) {
        await updateTransaction(editingTx.id, {
          date,
          amount: numericAmount,
          categoryId,
          type,
          notes,
        });
      } else {
        await addTransaction({
          date,
          amount: numericAmount,
          categoryId,
          type,
          notes,
        });
      }
      onClose();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Unable to save transaction.']);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);

    const validation = validateTransactionInput({date, amount, categoryId, type});
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const numericAmount = parseFloat(amount);
    if (!duplicateMatch) {
      const dup = findDuplicateTransaction(
        {date, amount: numericAmount, type, notes},
        transactions,
        editingTx?.id
      );
      if (dup) {
        setDuplicateMatch(dup);
        return;
      }
    }

    await performSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border app-surface p-6 shadow-xl max-h-[92vh] overflow-y-auto animate-mfa-modal">
        <div className="flex items-center justify-between pb-4 border-b app-border">
          <div>
            <h2 className="text-lg font-semibold">
              {editingTx
                ? t(settings.language, 'editTransaction')
                : t(settings.language, 'addTransaction')}
            </h2>
            {editingTx && (
              <p className="text-xs app-text-muted font-mono-tabular mt-0.5">{editingTx.id}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:opacity-75 min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
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
              rows={2}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDuplicateMatch(null);
              }}
              placeholder="Merchant, description, or reference..."
              className="w-full rounded-lg border app-input px-3 py-2.5 text-sm resize-none"
            />
          </div>

          {Boolean(editingTx) && settings.confirmOnSensitiveActions && (
            <div>
              <label className="block text-xs font-medium app-text-secondary mb-1.5">
                Master Password (Required for Modifications)
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Enter Master Password to authorize..."
                className="w-full rounded-lg border app-input px-3 py-2.5 text-sm min-h-[44px]"
                required
              />
            </div>
          )}

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
              onClick={onClose}
              className="rounded-lg border app-border px-4 py-2.5 text-sm font-medium min-h-[44px]"
            >
              {t(settings.language, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white min-h-[44px] disabled:opacity-60"
              style={{backgroundColor: 'var(--accent-primary)'}}
            >
              {saving ? 'Encrypting...' : t(settings.language, 'save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
