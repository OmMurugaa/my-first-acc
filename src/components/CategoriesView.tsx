import React, {useMemo, useState} from 'react';
import {Check, Lock, Pencil, Plus, Trash2, X} from 'lucide-react';
import {useVault} from '../context/VaultContext';
import {t} from '../i18n/translations';
import type {Category, TransactionType} from '../types/finance';

interface CategoriesViewProps {
  embedded?: boolean;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({embedded = false}) => {
  const {settings, categories, transactions, addCategory, updateCategory, deleteCategory} =
    useVault();

  const [newIncomeName, setNewIncomeName] = useState('');
  const [newExpenseName, setNewExpenseName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState('');

  const incomeCategories = useMemo(
    () => categories.filter((c) => c.type === 'income'),
    [categories]
  );
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  );

  const usageCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      counts.set(tx.categoryId, (counts.get(tx.categoryId) || 0) + 1);
    }
    return counts;
  }, [transactions]);

  const handleAdd = async (type: TransactionType, e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const name = type === 'income' ? newIncomeName : newExpenseName;
    try {
      await addCategory(name, type);
      if (type === 'income') setNewIncomeName('');
      else setNewExpenseName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add category.');
    }
  };

  const handleStartEdit = (cat: Category) => {
    setError('');
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const handleSaveEdit = async (id: string) => {
    setError('');
    try {
      await updateCategory(id, editingName);
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename category.');
    }
  };

  const handleDelete = async (cat: Category) => {
    setError('');
    try {
      await deleteCategory(cat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete category.');
    }
  };

  const renderSection = (
    title: string,
    type: TransactionType,
    list: Category[],
    inputVal: string,
    setInputVal: (v: string) => void
  ) => (
    <div className="rounded-xl border app-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs app-text-muted mt-0.5">
          Add, rename, or delete custom categories. &ldquo;Others&rdquo; is a mandatory fixed fallback category.
        </p>
      </div>

      <form onSubmit={(e) => void handleAdd(type, e)} className="flex gap-2">
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={`New ${type} category...`}
          className="flex-1 rounded-lg border app-input px-3 py-2 text-sm min-h-[42px]"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white min-h-[42px] whitespace-nowrap shrink-0"
          style={{backgroundColor: 'var(--accent-primary)'}}
        >
          <Plus className="w-4 h-4" />
          <span>Add</span>
        </button>
      </form>

      <div className="divide-y app-border border-t app-border">
        {list.map((cat) => {
          const isEditing = editingId === cat.id;
          const count = usageCountMap.get(cat.id) || 0;
          return (
            <div key={cat.id} className="py-3 flex items-center justify-between gap-3">
              {isEditing ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 rounded-lg border app-input px-3 py-1.5 text-sm min-h-[38px]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveEdit(cat.id)}
                    className="p-2 rounded-lg text-emerald-500 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    aria-label="Save category"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-2 rounded-lg app-text-muted min-w-[36px] min-h-[36px] flex items-center justify-center"
                    aria-label="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      <span>{cat.name}</span>
                      {cat.isFixed && <Lock className="w-3.5 h-3.5 app-text-muted" />}
                    </div>
                    <div className="text-xs app-text-muted font-mono-tabular mt-0.5">
                      {count} transaction{count === 1 ? '' : 's'}
                      {cat.isFixed ? ' · Mandatory Fixed Category' : ''}
                    </div>
                  </div>

                  {!cat.isFixed && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cat)}
                        className="p-2 rounded-lg app-text-muted hover:opacity-80 min-w-[36px] min-h-[36px] flex items-center justify-center"
                        aria-label="Edit category"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(cat)}
                        className="p-2 rounded-lg app-text-muted hover:text-rose-500 min-w-[36px] min-h-[36px] flex items-center justify-center"
                        aria-label="Delete category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-6 pt-6 border-t app-border' : 'space-y-6'}>
      {embedded ? (
        <div>
          <h2 className="text-lg font-bold tracking-tight">
            {t(settings.language, 'navCategories')}
          </h2>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            Deleting a custom category automatically reassigns its historical transactions to &ldquo;Others&rdquo;.
          </p>
        </div>
      ) : (
        <div className="pb-4 border-b app-border">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {t(settings.language, 'navCategories')}
          </h1>
          <p className="mt-1 text-xs sm:text-sm app-text-muted">
            Deleting a custom category automatically reassigns its historical transactions to &ldquo;Others&rdquo;.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {renderSection(
          'Income Categories',
          'income',
          incomeCategories,
          newIncomeName,
          setNewIncomeName
        )}
        {renderSection(
          'Expense Categories',
          'expense',
          expenseCategories,
          newExpenseName,
          setNewExpenseName
        )}
      </div>
    </div>
  );
};
