import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import {decryptPayload, encryptPayload} from '../crypto/webCrypto';
import type {
  AppSettings,
  AutoBackupRecord,
  Category,
  EncryptedEnvelope,
  SchemaMigrationRecord,
  Transaction,
  TrashItem,
  VaultBackupPayload,
  VaultMeta,
} from '../types/finance';

export const DB_NAME = 'myfirst_account_vault_db';
export const CURRENT_DB_VERSION = 1;
export const CURRENT_DATA_SCHEMA_VERSION = 1;

interface FinanceVaultDB extends DBSchema {
  vault_meta: {
    key: string;
    value: VaultMeta;
  };
  transactions: {
    key: string;
    value: EncryptedEnvelope;
  };
  categories: {
    key: string;
    value: EncryptedEnvelope;
  };
  settings: {
    key: string;
    value: EncryptedEnvelope;
  };
  trash: {
    key: string;
    value: EncryptedEnvelope;
  };
  auto_backups: {
    key: string;
    value: AutoBackupRecord;
  };
  schema_migrations: {
    key: number;
    value: SchemaMigrationRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<FinanceVaultDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FinanceVaultDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FinanceVaultDB>(DB_NAME, CURRENT_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('vault_meta')) {
            db.createObjectStore('vault_meta', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('transactions')) {
            db.createObjectStore('transactions', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('categories')) {
            db.createObjectStore('categories', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('trash')) {
            db.createObjectStore('trash', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('auto_backups')) {
            db.createObjectStore('auto_backups', {keyPath: 'id'});
          }
          if (!db.objectStoreNames.contains('schema_migrations')) {
            db.createObjectStore('schema_migrations', {keyPath: 'version'});
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function ensureDataSchemaMigrations(
  dek: CryptoKey,
  settings: AppSettings
): Promise<AppSettings> {
  const db = await getDB();
  const existingMigrations = await db.getAll('schema_migrations');
  const appliedSet = new Set(existingMigrations.map((m) => m.version));

  let migratedSettings = {...settings};

  if (!appliedSet.has(1)) {
    await db.put('schema_migrations', {
      version: 1,
      name: 'v1.0 Initial Encrypted Ledger, Categories, Trash & Auto-Backups',
      appliedAt: Date.now(),
    });
    migratedSettings.schemaVersion = 1;
    await saveEncryptedSettings(dek, migratedSettings);
  }

  return migratedSettings;
}

export async function getSchemaMigrations(): Promise<SchemaMigrationRecord[]> {
  const db = await getDB();
  const rows = await db.getAll('schema_migrations');
  return rows.sort((a, b) => a.version - b.version);
}

export async function getVaultMeta(): Promise<VaultMeta | undefined> {
  const db = await getDB();
  return db.get('vault_meta', 'primary');
}

export async function saveVaultMeta(meta: VaultMeta): Promise<void> {
  const db = await getDB();
  await db.put('vault_meta', meta);
}

export async function saveEncryptedSettings(dek: CryptoKey, settings: AppSettings): Promise<void> {
  const db = await getDB();
  const {iv, ciphertext} = await encryptPayload(dek, settings);
  await db.put('settings', {
    id: 'app_settings',
    iv,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function loadEncryptedSettings(dek: CryptoKey): Promise<AppSettings | null> {
  const db = await getDB();
  const env = await db.get('settings', 'app_settings');
  if (!env) return null;
  return decryptPayload<AppSettings>(dek, env.iv, env.ciphertext);
}

export async function saveEncryptedCategory(dek: CryptoKey, category: Category): Promise<void> {
  const db = await getDB();
  const {iv, ciphertext} = await encryptPayload(dek, category);
  await db.put('categories', {
    id: category.id,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function deleteEncryptedCategory(categoryId: string): Promise<void> {
  const db = await getDB();
  await db.delete('categories', categoryId);
}

export async function loadAllCategories(dek: CryptoKey): Promise<Category[]> {
  const db = await getDB();
  const envelopes = await db.getAll('categories');
  const results = await Promise.all(
    envelopes.map((env) => decryptPayload<Category>(dek, env.iv, env.ciphertext))
  );
  return results.sort((a, b) => {
    if (a.isFixed !== b.isFixed) return a.isFixed ? 1 : -1;
    return a.createdAt - b.createdAt;
  });
}

export async function saveEncryptedTransaction(dek: CryptoKey, tx: Transaction): Promise<void> {
  const db = await getDB();
  const {iv, ciphertext} = await encryptPayload(dek, tx);
  await db.put('transactions', {
    id: tx.id,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function saveBatchEncryptedTransactions(
  dek: CryptoKey,
  txList: Transaction[]
): Promise<void> {
  const encryptedEnvelopes: EncryptedEnvelope[] = await Promise.all(
    txList.map(async (tx) => {
      const {iv, ciphertext} = await encryptPayload(dek, tx);
      return {
        id: tx.id,
        iv,
        ciphertext,
        updatedAt: Date.now(),
      };
    })
  );
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  for (const env of encryptedEnvelopes) {
    await tx.store.put(env);
  }
  await tx.done;
}

export async function deleteEncryptedTransaction(txId: string): Promise<void> {
  const db = await getDB();
  await db.delete('transactions', txId);
}

export async function clearAllEncryptedTransactions(): Promise<void> {
  const db = await getDB();
  await db.clear('transactions');
}

export async function loadAllTransactions(dek: CryptoKey): Promise<Transaction[]> {
  const db = await getDB();
  const envelopes = await db.getAll('transactions');
  const results = await Promise.all(
    envelopes.map((env) => decryptPayload<Transaction>(dek, env.iv, env.ciphertext))
  );
  return results.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt - a.createdAt;
  });
}

export async function saveTrashItem(dek: CryptoKey, item: TrashItem): Promise<void> {
  const db = await getDB();
  const {iv, ciphertext} = await encryptPayload(dek, item);
  await db.put('trash', {
    id: item.id,
    iv,
    ciphertext,
    updatedAt: Date.now(),
  });
}

export async function deleteTrashItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('trash', id);
}

export async function clearAllTrash(): Promise<void> {
  const db = await getDB();
  await db.clear('trash');
}

export async function loadAllTrash(dek: CryptoKey): Promise<TrashItem[]> {
  const db = await getDB();
  const envelopes = await db.getAll('trash');
  const items = await Promise.all(
    envelopes.map((env) => decryptPayload<TrashItem>(dek, env.iv, env.ciphertext))
  );
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function ensureMonthlyAutoBackup(
  dek: CryptoKey,
  payload: VaultBackupPayload
): Promise<AutoBackupRecord | null> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const db = await getDB();
  const existing = await db.get('auto_backups', monthKey);
  if (existing) return null;

  const {iv, ciphertext} = await encryptPayload(dek, payload);
  const record: AutoBackupRecord = {
    id: monthKey,
    monthKey,
    createdAt: Date.now(),
    transactionCount: payload.transactions.length,
    iv,
    ciphertext,
  };
  await db.put('auto_backups', record);
  return record;
}

export async function createManualSnapshotInDb(
  dek: CryptoKey,
  payload: VaultBackupPayload
): Promise<AutoBackupRecord> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const db = await getDB();
  const {iv, ciphertext} = await encryptPayload(dek, payload);
  const record: AutoBackupRecord = {
    id: monthKey,
    monthKey,
    createdAt: Date.now(),
    transactionCount: payload.transactions.length,
    iv,
    ciphertext,
  };
  await db.put('auto_backups', record);
  return record;
}

export async function loadAutoBackups(): Promise<AutoBackupRecord[]> {
  const db = await getDB();
  const all = await db.getAll('auto_backups');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function decryptAutoBackupRecord(
  dek: CryptoKey,
  record: AutoBackupRecord
): Promise<VaultBackupPayload> {
  return decryptPayload<VaultBackupPayload>(dek, record.iv, record.ciphertext);
}

export async function replaceVaultDataFromRestore(
  dek: CryptoKey,
  payload: VaultBackupPayload
): Promise<void> {
  const db = await getDB();

  const encryptedCategories = await Promise.all(
    payload.categories.map(async (c) => {
      const {iv, ciphertext} = await encryptPayload(dek, c);
      return {id: c.id, iv, ciphertext, updatedAt: Date.now()};
    })
  );

  const encryptedTransactions = await Promise.all(
    payload.transactions.map(async (txItem) => {
      const {iv, ciphertext} = await encryptPayload(dek, txItem);
      return {id: txItem.id, iv, ciphertext, updatedAt: Date.now()};
    })
  );

  const encryptedTrash = await Promise.all(
    (payload.trash || []).map(async (trashItem) => {
      const {iv, ciphertext} = await encryptPayload(dek, trashItem);
      return {id: trashItem.id, iv, ciphertext, updatedAt: Date.now()};
    })
  );

  const {iv: settingsIv, ciphertext: settingsCiphertext} = await encryptPayload(
    dek,
    payload.settings
  );

  const tx = db.transaction(['categories', 'transactions', 'trash', 'settings'], 'readwrite');
  await tx.objectStore('categories').clear();
  await tx.objectStore('transactions').clear();
  await tx.objectStore('trash').clear();

  for (const c of encryptedCategories) {
    await tx.objectStore('categories').put(c);
  }
  for (const t of encryptedTransactions) {
    await tx.objectStore('transactions').put(t);
  }
  for (const tr of encryptedTrash) {
    await tx.objectStore('trash').put(tr);
  }
  await tx.objectStore('settings').put({
    id: 'app_settings',
    iv: settingsIv,
    ciphertext: settingsCiphertext,
    updatedAt: Date.now(),
  });
  await tx.done;
}

export async function secureWipeDatabase(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'vault_meta',
      'transactions',
      'categories',
      'settings',
      'trash',
      'auto_backups',
      'schema_migrations',
    ],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('vault_meta').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('categories').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('trash').clear(),
    tx.objectStore('auto_backups').clear(),
    tx.objectStore('schema_migrations').clear(),
  ]);
  await tx.done;
}
