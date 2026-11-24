import {downloadRowsAsXlsx} from './xlsxExport';
import type {
  Category,
  CurrencyCode,
  DateFormat,
  NumberFormat,
  Transaction,
  TransactionType,
} from '../types/finance';

export const CURRENCY_META: Record<CurrencyCode, {symbol: string; label: string}> = {
  INR: {symbol: '₹', label: 'Indian Rupee (INR ₹)'},
  USD: {symbol: '$', label: 'US Dollar (USD $)'},
  EUR: {symbol: '€', label: 'Euro (1,000.00 €)'},
  GBP: {symbol: '£', label: 'British Pound (GBP £)'},
  SGD: {symbol: 'S$', label: 'Singapore Dollar (SGD S$)'},
  AED: {symbol: 'AED ', label: 'UAE Dirham (AED)'},
  MYR: {symbol: 'RM', label: 'Malaysian Ringgit (MYR RM)'},
};

export function formatMoney(
  amount: number,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
  options?: {showSign?: boolean; type?: TransactionType}
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safeAmount);
  const locale = numberFormat === 'indian' ? 'en-IN' : 'en-US';
  const formattedNumber = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);

  const symbol = CURRENCY_META[currency]?.symbol ?? '₹';
  let prefix = '';
  if (options?.type === 'income') {
    prefix = '+';
  } else if (options?.type === 'expense') {
    prefix = '-';
  } else if (safeAmount < 0) {
    prefix = '-';
  } else if (options?.showSign && safeAmount > 0) {
    prefix = '+';
  }

  if (currency === 'EUR') {
    return `${prefix}${formattedNumber} €`;
  }

  return `${prefix}${symbol}${formattedNumber}`;
}

export function formatDateDisplay(isoDate: string, format: DateFormat): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[Math.max(0, Math.min(11, parseInt(m, 10) - 1))];

  switch (format) {
    case 'DD-MM-YYYY':
      return `${d}-${m}-${y}`;
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`;
    case 'DD MMM YYYY':
      return `${d} ${monthName} ${y}`;
    default:
      return `${d}-${m}-${y}`;
  }
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generateTransactionId(dateStr?: string): string {
  const cleanDate = (dateStr || getTodayISO()).replace(/-/g, '');
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `TXN-${cleanDate}-${hex}`;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateTransactionInput(input: {
  date: string;
  amount: string | number;
  categoryId: string;
  type: TransactionType;
}): ValidationResult {
  const errors: string[] = [];

  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    errors.push('Valid date (YYYY-MM-DD) is required.');
  } else {
    const parsed = new Date(`${input.date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      errors.push('Date is invalid.');
    }
  }

  const numAmount = typeof input.amount === 'number' ? input.amount : parseFloat(input.amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    errors.push('Amount must be greater than 0.');
  } else if (numAmount > 999999999999) {
    errors.push('Amount exceeds supported ledger limit.');
  }

  if (!input.categoryId) {
    errors.push('Category is required.');
  }

  if (input.type !== 'income' && input.type !== 'expense') {
    errors.push('Classification must be Income or Expense.');
  }

  return {isValid: errors.length === 0, errors};
}

export function findDuplicateTransaction(
  candidate: {date: string; amount: number; type: TransactionType; notes?: string},
  existing: Transaction[],
  ignoreId?: string
): Transaction | undefined {
  const normalizedNotes = (candidate.notes || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return existing.find((tx) => {
    if (ignoreId && tx.id === ignoreId) return false;
    const sameDate = tx.date === candidate.date;
    const sameType = tx.type === candidate.type;
    const sameAmount = Math.abs(tx.amount - candidate.amount) < 0.005;
    if (!sameDate || !sameType || !sameAmount) return false;

    // If notes also match or one is empty, treat as potential duplicate
    const txNotes = tx.notes.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedNotes || !txNotes) return true;
    return txNotes === normalizedNotes || txNotes.includes(normalizedNotes) || normalizedNotes.includes(txNotes);
  });
}

export function exportTransactionsToExcel(
  transactions: Transaction[],
  categories: Category[],
  currency: CurrencyCode,
  dateFormat: DateFormat,
  filenamePrefix = 'MyFirstAccount_Ledger'
): void {
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const headers = [
    'Transaction ID',
    'Date',
    'ISO Date',
    'Classification',
    'Category',
    'Amount',
    'Currency',
    'Notes',
  ];
  const rows = transactions.map((tx) => [
    tx.id,
    formatDateDisplay(tx.date, dateFormat),
    tx.date,
    tx.type === 'income' ? 'Income' : 'Expense',
    catMap.get(tx.categoryId) || 'Others',
    tx.amount,
    currency,
    tx.notes || '',
  ]);

  const today = getTodayISO();
  downloadRowsAsXlsx(headers, rows, `${filenamePrefix}_${today}.xlsx`);
}

export function getDefaultCategoryId(categories: Category[], type: TransactionType): string {
  const typeCats = categories.filter((c) => c.type === type);
  if (typeCats.length === 0) return '';
  const preferredName = type === 'income' ? 'salary' : 'food';
  const preferred = typeCats.find((c) => c.name.trim().toLowerCase() === preferredName);
  return preferred?.id || typeCats[0].id;
}
