export const APP_NAME = 'MyFirst Account';
export const APP_VERSION = '1.00';

export type Language = 'en' | 'ta' | 'tanglish';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'SGD' | 'AED' | 'MYR';

export type ThemeMode = 'dark' | 'gray';

export type DateFormat = 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';

export type NumberFormat = 'indian' | 'international';

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string; // Unique Transaction ID e.g. TXN-20261122-A4F91C
  date: string; // ISO date YYYY-MM-DD
  amount: number;
  categoryId: string;
  type: TransactionType;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrashItem {
  id: string;
  transaction: Transaction;
  deletedAt: number;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  isFixed: boolean; // true for mandatory "Others" category
  createdAt: number;
}

export interface AppSettings {
  language: Language;
  currency: CurrencyCode;
  theme: ThemeMode;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  openingBalance: number;
  openingBalanceDate: string;
  autoLockMinutes: number; // 0 = disabled, otherwise 1 | 5 | 15 | 30
  confirmOnSensitiveActions: boolean;
  autoMonthlyBackupEnabled: boolean;
  schemaVersion: number;
}

export interface EncryptedEnvelope {
  id: string;
  iv: string; // base64 12-byte IV
  ciphertext: string; // base64 AES-256-GCM ciphertext + 128-bit auth tag
  updatedAt: number;
}

export interface VaultMeta {
  id: 'primary';
  version: number;
  salt: string; // base64 16-byte salt
  iterations: number; // PBKDF2 iterations (default 600,000)
  benchmarkMs: number;
  wrappedDek: string; // base64 AES-256-GCM wrapped 256-bit DEK
  wrappedDekIv: string; // base64 12-byte IV
  pinEnabled: boolean;
  pinSalt?: string;
  pinIterations?: number;
  pinWrappedDek?: string;
  pinWrappedDekIv?: string;
  pinFailedAttempts?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AutoBackupRecord {
  id: string; // YYYY-MM e.g. "2026-11"
  monthKey: string;
  createdAt: number;
  transactionCount: number;
  iv: string;
  ciphertext: string;
}

export interface SchemaMigrationRecord {
  version: number;
  name: string;
  appliedAt: number;
}

export interface VaultBackupPayload {
  format: 'myfirst-account-encrypted-backup';
  appVersion: string;
  schemaVersion: number;
  exportedAt: number;
  settings: AppSettings;
  categories: Category[];
  transactions: Transaction[];
  trash: TrashItem[];
}

export interface EncryptedBackupFile {
  magic: 'MFA_ENC_V1';
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-HMAC-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  exportedAt: number;
}

export interface StatementBalanceSummary {
  accountSection: string;
  openingLabel: string;
  openingAmount: number | null;
  closingLabel: string;
  closingAmount: number | null;
  incomeTotal?: number;
  expenseTotal?: number;
  reconciled?: boolean | null;
  reconciliationDiff?: number | null;
}

export interface ImportRowPreview {
  rowIndex: number;
  rawLine: string;
  date: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  notes: string;
  accountSection?: string;
  isValid: boolean;
  validationErrors: string[];
  isDuplicate: boolean;
  duplicateReason?: string;
  selected: boolean;
}

export type ActiveTab =
  | 'dashboard'
  | 'add'
  | 'transactions'
  | 'monthly'
  | 'annual'
  | 'pdf-import'
  | 'backup'
  | 'security'
  | 'preferences';
