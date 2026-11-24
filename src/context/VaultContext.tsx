import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  clearCredentialVerifierHash,
  computeCredentialVerifier,
  createEncryptedBackupFile,
  decryptBackupFile,
  deriveKEK,
  fromBase64,
  generateDEK,
  generateSalt,
  getCredentialVerifierHash,
  saveCredentialVerifierHash,
  toBase64,
  unwrapDEK,
  wrapDEK,
} from '../crypto/webCrypto';
import {
  clearAllEncryptedTransactions,
  clearAllTrash,
  createManualSnapshotInDb,
  CURRENT_DATA_SCHEMA_VERSION,
  decryptAutoBackupRecord,
  deleteEncryptedCategory,
  deleteEncryptedTransaction,
  deleteTrashItem,
  ensureDataSchemaMigrations,
  ensureMonthlyAutoBackup,
  getSchemaMigrations,
  getVaultMeta,
  loadAllCategories,
  loadAllTransactions,
  loadAllTrash,
  loadAutoBackups,
  loadEncryptedSettings,
  replaceVaultDataFromRestore,
  saveBatchEncryptedTransactions,
  saveEncryptedCategory,
  saveEncryptedSettings,
  saveEncryptedTransaction,
  saveTrashItem,
  saveVaultMeta,
  secureWipeDatabase,
} from '../db/indexedDb';
import {APP_VERSION} from '../types/finance';
import type {
  AppSettings,
  AutoBackupRecord,
  Category,
  CurrencyCode,
  DateFormat,
  EncryptedBackupFile,
  Language,
  NumberFormat,
  SchemaMigrationRecord,
  ThemeMode,
  Transaction,
  TransactionType,
  TrashItem,
  VaultBackupPayload,
  VaultMeta,
} from '../types/finance';
import {findDuplicateTransaction, generateTransactionId, getTodayISO} from '../utils/formatters';

export type VaultStatus = 'loading' | 'needs_setup' | 'locked' | 'unlocked';

interface SetupConfig {
  language: Language;
  currency: CurrencyCode;
  theme: ThemeMode;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  openingBalance: number;
  openingBalanceDate: string;
  password: string;
  iterations: number;
  benchmarkMs: number;
  autoLockMinutes: number;
}

interface VaultContextValue {
  status: VaultStatus;
  vaultMeta: VaultMeta | null;
  settings: AppSettings;
  categories: Category[];
  transactions: Transaction[];
  trash: TrashItem[];
  autoBackups: AutoBackupRecord[];
  migrations: SchemaMigrationRecord[];
  lastAutoBackupNotice: string | null;
  dismissAutoBackupNotice: () => void;
  summary: {
    currentMonthIncome: number;
    currentMonthExpenses: number;
    currentMonthNet: number;
    totalIncome: number;
    totalExpenses: number;
    currentBalance: number;
  };
  initializeNewVault: (config: SetupConfig) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  verifyCurrentPassword: (password: string) => Promise<boolean>;
  lockVault: () => void;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  addTransaction: (input: {
    date: string;
    amount: number;
    categoryId: string;
    type: TransactionType;
    notes: string;
  }) => Promise<Transaction>;
  addBatchTransactions: (
    items: Array<{
      date: string;
      amount: number;
      categoryId: string;
      type: TransactionType;
      notes: string;
    }>
  ) => Promise<Transaction[]>;
  updateTransaction: (
    id: string,
    patch: {date: string; amount: number; categoryId: string; type: TransactionType; notes: string}
  ) => Promise<void>;
  deleteTransaction: (id: string) => Promise<TrashItem | null>;
  restoreFromTrash: (trashId: string) => Promise<void>;
  permanentlyDeleteTrash: (trashId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  addCategory: (name: string, type: TransactionType) => Promise<Category>;
  updateCategory: (id: string, name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  changeMasterPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  enableQuickPin: (currentPassword: string, pin: string) => Promise<void>;
  disableQuickPin: () => Promise<void>;
  exportEncryptedBackup: (backupPassword: string) => Promise<EncryptedBackupFile>;
  createMonthlySnapshotNow: () => Promise<AutoBackupRecord>;
  downloadAutoBackupSnapshot: (record: AutoBackupRecord, exportPassword: string) => Promise<EncryptedBackupFile>;
  restoreFromBackupFile: (rawJson: string, backupPassword: string, newMasterPassword?: string) => Promise<void>;
  mergeFromBackupFile: (
    rawJson: string,
    backupPassword: string
  ) => Promise<{addedCount: number; skippedDuplicates: number; addedCategories: number}>;
  deleteAllTransactions: (password: string) => Promise<void>;
  secureResetAllData: (password: string) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  currency: 'EUR',
  theme: 'dark',
  dateFormat: 'DD-MM-YYYY',
  numberFormat: 'international',
  openingBalance: 0,
  openingBalanceDate: getTodayISO(),
  autoLockMinutes: 5,
  confirmOnSensitiveActions: false,
  autoMonthlyBackupEnabled: true,
  schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
};

function createDefaultCategories(): Category[] {
  const now = Date.now();
  const incomeNames = [
    {name: 'Salary', isFixed: false},
    {name: 'Freelance', isFixed: false},
    {name: 'Investments', isFixed: false},
    {name: 'Others', isFixed: true},
  ];
  const expenseNames = [
    {name: 'Food', isFixed: false},
    {name: 'Rent', isFixed: false},
    {name: 'Transport', isFixed: false},
    {name: 'Bills', isFixed: false},
    {name: 'Shopping', isFixed: false},
    {name: 'Medical', isFixed: false},
    {name: 'Others', isFixed: true},
  ];

  const list: Category[] = [];
  incomeNames.forEach((item, idx) => {
    list.push({
      id: `cat_inc_${item.name.toLowerCase()}`,
      name: item.name,
      type: 'income',
      isFixed: item.isFixed,
      createdAt: now + idx,
    });
  });
  expenseNames.forEach((item, idx) => {
    list.push({
      id: `cat_exp_${item.name.toLowerCase()}`,
      name: item.name,
      type: 'expense',
      isFixed: item.isFixed,
      createdAt: now + 100 + idx,
    });
  });
  return list;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export const VaultProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [vaultMeta, setVaultMeta] = useState<VaultMeta | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [autoBackups, setAutoBackups] = useState<AutoBackupRecord[]>([]);
  const [migrations, setMigrations] = useState<SchemaMigrationRecord[]>([]);
  const [lastAutoBackupNotice, setLastAutoBackupNotice] = useState<string | null>(null);

  // Active DEK resides ONLY in memory while vault is unlocked
  const dekRef = useRef<CryptoKey | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const applyThemeClass = useCallback((theme: ThemeMode) => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('theme-dark', 'dark');
      html.classList.remove('theme-gray');
    } else {
      html.classList.add('theme-gray');
      html.classList.remove('theme-dark', 'dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0A0E17' : '#E4E7EC');
    }
    localStorage.setItem('mfa_preferred_theme', theme);
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('mfa_preferred_theme') as ThemeMode | null;
    applyThemeClass(savedTheme === 'gray' ? 'gray' : 'dark');
  }, [applyThemeClass]);

  useEffect(() => {
    applyThemeClass(settings.theme);
  }, [settings.theme, applyThemeClass]);

  // Boot check: determine if vault exists in IndexedDB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await getVaultMeta();
        if (cancelled) return;
        if (!meta) {
          setStatus('needs_setup');
        } else {
          setVaultMeta(meta);
          setStatus('locked');
        }
      } catch (err) {
        console.error('Vault initialization error:', err);
        if (!cancelled) setStatus('needs_setup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lockVault = useCallback(() => {
    dekRef.current = null;
    setTransactions([]);
    setCategories([]);
    setTrash([]);
    setAutoBackups([]);
    setStatus((prev) => (prev === 'needs_setup' ? 'needs_setup' : 'locked'));
  }, []);

  // Configurable Auto-Lock inactivity monitor
  useEffect(() => {
    if (status !== 'unlocked' || settings.autoLockMinutes <= 0) {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      return;
    }

    const timeoutMs = settings.autoLockMinutes * 60 * 1000;
    const resetTimer = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        lockVault();
      }, timeoutMs);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, {passive: true}));
    resetTimer();

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [status, settings.autoLockMinutes, lockVault]);

  const hydrateUnlockedVault = useCallback(async (dek: CryptoKey, meta: VaultMeta) => {
    dekRef.current = dek;
    const [loadedSettings, loadedCats, loadedTx, loadedTrash, loadedAutoBackups, loadedMigrations] =
      await Promise.all([
        loadEncryptedSettings(dek),
        loadAllCategories(dek),
        loadAllTransactions(dek),
        loadAllTrash(dek),
        loadAutoBackups(),
        getSchemaMigrations(),
      ]);

    const baseSettings = loadedSettings || DEFAULT_SETTINGS;
    const migratedSettings = await ensureDataSchemaMigrations(dek, baseSettings);
    const updatedMigrations = loadedMigrations.length > 0 ? loadedMigrations : await getSchemaMigrations();

    setVaultMeta(meta);
    setSettings(migratedSettings);
    setCategories(loadedCats.length > 0 ? loadedCats : createDefaultCategories());
    setTransactions(loadedTx);
    setTrash(loadedTrash);
    setAutoBackups(loadedAutoBackups);
    setMigrations(updatedMigrations);

    // Automatic Monthly Backup creation if enabled
    if (migratedSettings.autoMonthlyBackupEnabled) {
      const payload: VaultBackupPayload = {
        format: 'myfirst-account-encrypted-backup',
        appVersion: APP_VERSION,
        schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
        exportedAt: Date.now(),
        settings: migratedSettings,
        categories: loadedCats,
        transactions: loadedTx,
        trash: loadedTrash,
      };
      const created = await ensureMonthlyAutoBackup(dek, payload);
      if (created) {
        setAutoBackups(await loadAutoBackups());
        setLastAutoBackupNotice(`Monthly encrypted snapshot (${created.monthKey}) saved locally.`);
      }
    }

    setStatus('unlocked');
  }, []);

  const initializeNewVault = useCallback(async (config: SetupConfig) => {
    if (config.password.length < 8) {
      throw new Error('Master Password must be at least 8 characters.');
    }

    const salt = generateSalt();
    const kek = await deriveKEK(config.password, salt, config.iterations);
    const dek = await generateDEK();
    const {wrappedDek, iv} = await wrapDEK(dek, kek);
    const verifierHash = await computeCredentialVerifier(config.password, salt, config.iterations);
    saveCredentialVerifierHash(verifierHash);

    const now = Date.now();
    const meta: VaultMeta = {
      id: 'primary',
      version: 1,
      salt: toBase64(salt),
      iterations: config.iterations,
      benchmarkMs: config.benchmarkMs,
      wrappedDek,
      wrappedDekIv: iv,
      pinEnabled: false,
      pinFailedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    const initialSettings: AppSettings = {
      language: config.language,
      currency: config.currency,
      theme: config.theme,
      dateFormat: config.dateFormat,
      numberFormat: config.numberFormat,
      openingBalance: config.openingBalance,
      openingBalanceDate: config.openingBalanceDate,
      autoLockMinutes: config.autoLockMinutes,
      confirmOnSensitiveActions: false,
      autoMonthlyBackupEnabled: true,
      schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    };

    const defaultCats = createDefaultCategories();

    await saveVaultMeta(meta);
    await saveEncryptedSettings(dek, initialSettings);
    for (const cat of defaultCats) {
      await saveEncryptedCategory(dek, cat);
    }
    await ensureDataSchemaMigrations(dek, initialSettings);

    await hydrateUnlockedVault(dek, meta);
  }, [hydrateUnlockedVault]);

  const unlockWithPassword = useCallback(
    async (password: string) => {
      const meta = await getVaultMeta();
      if (!meta) throw new Error('No vault found on this device.');

      const salt = fromBase64(meta.salt);
      // Verify hashed credential in localStorage if present
      const storedVerifier = getCredentialVerifierHash();
      if (storedVerifier) {
        const computed = await computeCredentialVerifier(password, salt, meta.iterations);
        if (computed !== storedVerifier) {
          throw new Error('Incorrect Master Password.');
        }
      }

      try {
        const kek = await deriveKEK(password, salt, meta.iterations);
        const dek = await unwrapDEK(meta.wrappedDek, meta.wrappedDekIv, kek, true);
        // Reset failed PIN attempts after valid Master Password unlock
        if (meta.pinFailedAttempts && meta.pinFailedAttempts > 0) {
          const updatedMeta = {...meta, pinFailedAttempts: 0, updatedAt: Date.now()};
          await saveVaultMeta(updatedMeta);
          await hydrateUnlockedVault(dek, updatedMeta);
        } else {
          await hydrateUnlockedVault(dek, meta);
        }
      } catch {
        throw new Error('Incorrect Master Password.');
      }
    },
    [hydrateUnlockedVault]
  );

  const unlockWithPin = useCallback(
    async (pin: string) => {
      const cleanPin = pin.trim();
      const meta = await getVaultMeta();
      if (!meta || !meta.pinEnabled || !meta.pinSalt || !meta.pinWrappedDek || !meta.pinWrappedDekIv) {
        throw new Error('Quick PIN is not enabled.');
      }
      if ((meta.pinFailedAttempts || 0) >= 3) {
        throw new Error('Quick PIN locked after 3 failed attempts. Please unlock using Master Password.');
      }

      let dek: CryptoKey;
      try {
        const pinSalt = fromBase64(meta.pinSalt);
        const kek = await deriveKEK(cleanPin, pinSalt, meta.pinIterations || 200000);
        dek = await unwrapDEK(meta.pinWrappedDek, meta.pinWrappedDekIv, kek, true);
      } catch {
        const attempts = (meta.pinFailedAttempts || 0) + 1;
        const updatedMeta = {...meta, pinFailedAttempts: attempts, updatedAt: Date.now()};
        await saveVaultMeta(updatedMeta);
        setVaultMeta(updatedMeta);
        if (attempts >= 3) {
          throw new Error('Quick PIN locked after 3 failed attempts. Use Master Password.');
        }
        throw new Error(`Incorrect PIN (${3 - attempts} attempt${3 - attempts === 1 ? '' : 's'} remaining).`);
      }

      const resetMeta = {...meta, pinFailedAttempts: 0, updatedAt: Date.now()};
      await saveVaultMeta(resetMeta);
      await hydrateUnlockedVault(dek, resetMeta);
    },
    [hydrateUnlockedVault]
  );

  const verifyCurrentPassword = useCallback(async (password: string): Promise<boolean> => {
    const meta = await getVaultMeta();
    if (!meta) return false;
    const salt = fromBase64(meta.salt);
    const storedVerifier = getCredentialVerifierHash();
    if (storedVerifier) {
      const computed = await computeCredentialVerifier(password, salt, meta.iterations);
      if (computed !== storedVerifier) return false;
    }
    try {
      const kek = await deriveKEK(password, salt, meta.iterations);
      await unwrapDEK(meta.wrappedDek, meta.wrappedDekIv, kek, false);
      return true;
    } catch {
      return false;
    }
  }, []);

  const requireDEK = (): CryptoKey => {
    if (!dekRef.current) {
      throw new Error('Vault is locked. Please unlock to modify encrypted records.');
    }
    return dekRef.current;
  };

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const dek = requireDEK();
    setSettings((prev) => {
      const next = {...prev, ...partial};
      void saveEncryptedSettings(dek, next);
      return next;
    });
  }, []);

  const setTheme = useCallback(
    async (theme: ThemeMode) => {
      applyThemeClass(theme);
      if (dekRef.current) {
        await updateSettings({theme});
      } else {
        setSettings((prev) => ({...prev, theme}));
      }
    },
    [applyThemeClass, updateSettings]
  );

  const addTransaction = useCallback(
    async (input: {
      date: string;
      amount: number;
      categoryId: string;
      type: TransactionType;
      notes: string;
    }) => {
      const dek = requireDEK();
      const now = Date.now();
      const tx: Transaction = {
        id: generateTransactionId(input.date),
        date: input.date,
        amount: Math.round(input.amount * 100) / 100,
        categoryId: input.categoryId,
        type: input.type,
        notes: input.notes.trim(),
        createdAt: now,
        updatedAt: now,
      };
      await saveEncryptedTransaction(dek, tx);
      setTransactions((prev) =>
        [tx, ...prev].sort((a, b) =>
          a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
        )
      );
      return tx;
    },
    []
  );

  const addBatchTransactions = useCallback(
    async (
      items: Array<{
        date: string;
        amount: number;
        categoryId: string;
        type: TransactionType;
        notes: string;
      }>
    ) => {
      const dek = requireDEK();
      const now = Date.now();
      const created: Transaction[] = items.map((item, idx) => ({
        id: generateTransactionId(item.date),
        date: item.date,
        amount: Math.round(item.amount * 100) / 100,
        categoryId: item.categoryId,
        type: item.type,
        notes: item.notes.trim(),
        createdAt: now + idx,
        updatedAt: now + idx,
      }));
      await saveBatchEncryptedTransactions(dek, created);
      setTransactions((prev) =>
        [...created, ...prev].sort((a, b) =>
          a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
        )
      );
      return created;
    },
    []
  );

  const updateTransaction = useCallback(
    async (
      id: string,
      patch: {date: string; amount: number; categoryId: string; type: TransactionType; notes: string}
    ) => {
      const dek = requireDEK();
      let updatedTx: Transaction | null = null;
      setTransactions((prev) => {
        const next = prev.map((tx) => {
          if (tx.id !== id) return tx;
          updatedTx = {
            ...tx,
            date: patch.date,
            amount: Math.round(patch.amount * 100) / 100,
            categoryId: patch.categoryId,
            type: patch.type,
            notes: patch.notes.trim(),
            updatedAt: Date.now(),
          };
          return updatedTx;
        });
        return next.sort((a, b) =>
          a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
        );
      });
      if (updatedTx) {
        await saveEncryptedTransaction(dek, updatedTx);
      }
    },
    []
  );

  const deleteTransaction = useCallback(
    async (id: string): Promise<TrashItem | null> => {
      const dek = requireDEK();
      const target = transactions.find((tx) => tx.id === id);
      if (!target) return null;

      const trashItem: TrashItem = {
        id: `trash_${target.id}_${Date.now()}`,
        transaction: target,
        deletedAt: Date.now(),
      };

      await saveTrashItem(dek, trashItem);
      await deleteEncryptedTransaction(id);

      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
      setTrash((prev) => [trashItem, ...prev]);
      return trashItem;
    },
    [transactions]
  );

  const restoreFromTrash = useCallback(
    async (trashId: string) => {
      const dek = requireDEK();
      const item = trash.find((t) => t.id === trashId);
      if (!item) return;

      await saveEncryptedTransaction(dek, item.transaction);
      await deleteTrashItem(trashId);

      setTrash((prev) => prev.filter((t) => t.id !== trashId));
      setTransactions((prev) =>
        [item.transaction, ...prev].sort((a, b) =>
          a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
        )
      );
    },
    [trash]
  );

  const permanentlyDeleteTrash = useCallback(async (trashId: string) => {
    requireDEK();
    await deleteTrashItem(trashId);
    setTrash((prev) => prev.filter((t) => t.id !== trashId));
  }, []);

  const emptyTrash = useCallback(async () => {
    requireDEK();
    await clearAllTrash();
    setTrash([]);
  }, []);

  const addCategory = useCallback(
    async (name: string, type: TransactionType) => {
      const dek = requireDEK();
      const clean = name.trim();
      if (!clean) throw new Error('Category name cannot be empty.');
      const duplicate = categories.find(
        (c) => c.type === type && c.name.toLowerCase() === clean.toLowerCase()
      );
      if (duplicate) throw new Error(`Category "${clean}" already exists.`);

      const category: Category = {
        id: `cat_${type}_${crypto.randomUUID().slice(0, 8)}`,
        name: clean,
        type,
        isFixed: false,
        createdAt: Date.now(),
      };
      await saveEncryptedCategory(dek, category);
      setCategories((prev) =>
        [...prev, category].sort((a, b) => {
          if (a.isFixed !== b.isFixed) return a.isFixed ? 1 : -1;
          return a.createdAt - b.createdAt;
        })
      );
      return category;
    },
    [categories]
  );

  const updateCategory = useCallback(
    async (id: string, name: string) => {
      const dek = requireDEK();
      const target = categories.find((c) => c.id === id);
      if (!target) return;
      if (target.isFixed) throw new Error('"Others" is a mandatory fixed category and cannot be renamed.');

      const clean = name.trim();
      if (!clean) throw new Error('Category name cannot be empty.');
      const duplicate = categories.find(
        (c) => c.id !== id && c.type === target.type && c.name.toLowerCase() === clean.toLowerCase()
      );
      if (duplicate) throw new Error(`Category "${clean}" already exists.`);

      const updated = {...target, name: clean};
      await saveEncryptedCategory(dek, updated);
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    },
    [categories]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const dek = requireDEK();
      const target = categories.find((c) => c.id === id);
      if (!target) return;
      if (target.isFixed) throw new Error('"Others" is a mandatory fixed category and cannot be deleted.');

      const fallbackOthers = categories.find(
        (c) => c.type === target.type && c.isFixed && c.name.toLowerCase() === 'others'
      );
      if (!fallbackOthers) throw new Error('Fallback "Others" category not found.');

      // Reassign any transactions using the deleted category to "Others"
      const affected = transactions.filter((tx) => tx.categoryId === id);
      if (affected.length > 0) {
        const reassigned = affected.map((tx) => ({
          ...tx,
          categoryId: fallbackOthers.id,
          updatedAt: Date.now(),
        }));
        await saveBatchEncryptedTransactions(dek, reassigned);
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.categoryId === id
              ? {...tx, categoryId: fallbackOthers.id, updatedAt: Date.now()}
              : tx
          )
        );
      }

      await deleteEncryptedCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    },
    [categories, transactions]
  );

  const changeMasterPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const dek = requireDEK();
    if (newPassword.length < 8) {
      throw new Error('New Master Password must be at least 8 characters.');
    }
    const meta = await getVaultMeta();
    if (!meta) throw new Error('Vault metadata missing.');

    const oldSalt = fromBase64(meta.salt);
    try {
      const oldKek = await deriveKEK(currentPassword, oldSalt, meta.iterations);
      await unwrapDEK(meta.wrappedDek, meta.wrappedDekIv, oldKek, false);
    } catch {
      throw new Error('Current Master Password is incorrect.');
    }

    const newSalt = generateSalt();
    const newKek = await deriveKEK(newPassword, newSalt, meta.iterations);
    const {wrappedDek, iv} = await wrapDEK(dek, newKek);
    const verifier = await computeCredentialVerifier(newPassword, newSalt, meta.iterations);
    saveCredentialVerifierHash(verifier);

    const updatedMeta: VaultMeta = {
      ...meta,
      salt: toBase64(newSalt),
      wrappedDek,
      wrappedDekIv: iv,
      updatedAt: Date.now(),
    };
    await saveVaultMeta(updatedMeta);
    setVaultMeta(updatedMeta);
  }, []);

  const enableQuickPin = useCallback(async (currentPassword: string, pin: string) => {
    const dek = requireDEK();
    const cleanPin = pin.trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      throw new Error('Quick PIN must be 4 to 6 digits.');
    }
    const valid = await verifyCurrentPassword(currentPassword);
    if (!valid) throw new Error('Master Password verification failed.');

    const meta = await getVaultMeta();
    if (!meta) throw new Error('Vault metadata missing.');

    const pinSalt = generateSalt();
    const pinIterations = 200000;
    const pinKek = await deriveKEK(cleanPin, pinSalt, pinIterations);
    const {wrappedDek, iv} = await wrapDEK(dek, pinKek);

    const updatedMeta: VaultMeta = {
      ...meta,
      pinEnabled: true,
      pinSalt: toBase64(pinSalt),
      pinIterations,
      pinWrappedDek: wrappedDek,
      pinWrappedDekIv: iv,
      pinFailedAttempts: 0,
      updatedAt: Date.now(),
    };
    await saveVaultMeta(updatedMeta);
    setVaultMeta(updatedMeta);
  }, [verifyCurrentPassword]);

  const disableQuickPin = useCallback(async () => {
    requireDEK();
    const meta = await getVaultMeta();
    if (!meta) return;
    const updatedMeta: VaultMeta = {
      ...meta,
      pinEnabled: false,
      pinSalt: undefined,
      pinWrappedDek: undefined,
      pinWrappedDekIv: undefined,
      pinFailedAttempts: 0,
      updatedAt: Date.now(),
    };
    await saveVaultMeta(updatedMeta);
    setVaultMeta(updatedMeta);
  }, []);

  const buildCurrentPayload = useCallback((): VaultBackupPayload => {
    return {
      format: 'myfirst-account-encrypted-backup',
      appVersion: APP_VERSION,
      schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings,
      categories,
      transactions,
      trash,
    };
  }, [settings, categories, transactions, trash]);

  const exportEncryptedBackup = useCallback(
    async (backupPassword: string) => {
      requireDEK();
      if (backupPassword.length < 8) {
        throw new Error('Backup password must be at least 8 characters.');
      }
      const iterations = vaultMeta?.iterations || 600000;
      return createEncryptedBackupFile(buildCurrentPayload(), backupPassword, iterations);
    },
    [buildCurrentPayload, vaultMeta?.iterations]
  );

  const createMonthlySnapshotNow = useCallback(async () => {
    const dek = requireDEK();
    const rec = await createManualSnapshotInDb(dek, buildCurrentPayload());
    setAutoBackups(await loadAutoBackups());
    return rec;
  }, [buildCurrentPayload]);

  const downloadAutoBackupSnapshot = useCallback(
    async (record: AutoBackupRecord, exportPassword: string) => {
      const dek = requireDEK();
      if (exportPassword.length < 8) {
        throw new Error('Backup password must be at least 8 characters.');
      }
      const payload = await decryptAutoBackupRecord(dek, record);
      return createEncryptedBackupFile(payload, exportPassword, vaultMeta?.iterations || 600000);
    },
    [vaultMeta?.iterations]
  );

  const restoreFromBackupFile = useCallback(
    async (rawJson: string, backupPassword: string, newMasterPassword?: string) => {
      const payload = await decryptBackupFile(rawJson, backupPassword);

      // If currently unlocked, restore directly into active vault DEK
      if (dekRef.current && vaultMeta) {
        await replaceVaultDataFromRestore(dekRef.current, payload);
        await hydrateUnlockedVault(dekRef.current, vaultMeta);
        return;
      }

      // Emergency recovery while locked or fresh device: create/reset vault with chosen password
      const targetPassword = newMasterPassword && newMasterPassword.length >= 8 ? newMasterPassword : backupPassword;
      if (targetPassword.length < 8) {
        throw new Error('A Master Password of at least 8 characters is required to restore.');
      }
      const salt = generateSalt();
      const iterations = 600000;
      const kek = await deriveKEK(targetPassword, salt, iterations);
      const dek = await generateDEK();
      const {wrappedDek, iv} = await wrapDEK(dek, kek);
      const verifier = await computeCredentialVerifier(targetPassword, salt, iterations);
      saveCredentialVerifierHash(verifier);

      const now = Date.now();
      const meta: VaultMeta = {
        id: 'primary',
        version: 1,
        salt: toBase64(salt),
        iterations,
        benchmarkMs: 0,
        wrappedDek,
        wrappedDekIv: iv,
        pinEnabled: false,
        pinFailedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      await saveVaultMeta(meta);
      await replaceVaultDataFromRestore(dek, payload);
      await hydrateUnlockedVault(dek, meta);
    },
    [hydrateUnlockedVault, vaultMeta]
  );

  const mergeFromBackupFile = useCallback(
    async (
      rawJson: string,
      backupPassword: string
    ): Promise<{addedCount: number; skippedDuplicates: number; addedCategories: number}> => {
      const dek = requireDEK();
      const payload = await decryptBackupFile(rawJson, backupPassword);

      // Map imported category IDs to existing categories by (type, lowerName), creating any missing ones
      const payloadCatById = new Map(payload.categories.map((c) => [c.id, c]));
      const currentCats = [...categories];
      const catIdMap = new Map<string, string>();
      let addedCategories = 0;

      for (const impCat of payload.categories) {
        const lower = impCat.name.trim().toLowerCase();
        const existingMatch = currentCats.find(
          (c) =>
            c.type === impCat.type &&
            (c.name.trim().toLowerCase() === lower ||
              (impCat.isFixed && c.isFixed))
        );
        if (existingMatch) {
          catIdMap.set(impCat.id, existingMatch.id);
        } else {
          const newCat: Category = {
            id: `cat_${impCat.type}_${crypto.randomUUID().slice(0, 8)}`,
            name: impCat.name.trim().slice(0, 40),
            type: impCat.type,
            isFixed: false,
            createdAt: Date.now() + addedCategories,
          };
          await saveEncryptedCategory(dek, newCat);
          currentCats.push(newCat);
          catIdMap.set(impCat.id, newCat.id);
          addedCategories++;
        }
      }

      const combinedExisting = [...transactions];
      const toInsert: Transaction[] = [];
      let skippedDuplicates = 0;
      const now = Date.now();

      for (let idx = 0; idx < payload.transactions.length; idx++) {
        const tx = payload.transactions[idx];
        const fallbackOthers =
          currentCats.find((c) => c.type === tx.type && c.isFixed && c.name.toLowerCase() === 'others') ||
          currentCats.find((c) => c.type === tx.type);
        let mappedCatId = catIdMap.get(tx.categoryId);
        if (!mappedCatId) {
          const impCat = payloadCatById.get(tx.categoryId);
          if (impCat) {
            const match = currentCats.find(
              (c) => c.type === tx.type && c.name.toLowerCase() === impCat.name.toLowerCase()
            );
            mappedCatId = match?.id;
          }
        }
        const finalCategoryId = mappedCatId || fallbackOthers?.id || '';
        if (!finalCategoryId) continue;

        const isDup = Boolean(
          findDuplicateTransaction(
            {date: tx.date, amount: tx.amount, type: tx.type, notes: tx.notes},
            combinedExisting
          )
        );
        if (isDup) {
          skippedDuplicates++;
          continue;
        }

        const freshTx: Transaction = {
          id: generateTransactionId(tx.date),
          date: tx.date,
          amount: Math.round(tx.amount * 100) / 100,
          categoryId: finalCategoryId,
          type: tx.type,
          notes: (tx.notes || '').trim(),
          createdAt: tx.createdAt || now + idx,
          updatedAt: now + idx,
        };
        toInsert.push(freshTx);
        combinedExisting.push(freshTx);
      }

      if (toInsert.length > 0) {
        await saveBatchEncryptedTransactions(dek, toInsert);
      }

      if (addedCategories > 0) {
        setCategories(
          currentCats.sort((a, b) => {
            if (a.isFixed !== b.isFixed) return a.isFixed ? 1 : -1;
            return a.createdAt - b.createdAt;
          })
        );
      }
      if (toInsert.length > 0) {
        setTransactions((prev) =>
          [...toInsert, ...prev].sort((a, b) =>
            a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
          )
        );
      }

      return {
        addedCount: toInsert.length,
        skippedDuplicates,
        addedCategories,
      };
    },
    [categories, transactions]
  );

  const deleteAllTransactions = useCallback(
    async (password: string) => {
      requireDEK();
      const valid = await verifyCurrentPassword(password);
      if (!valid) throw new Error('Master Password verification failed. Transactions were not deleted.');

      await clearAllEncryptedTransactions();
      await clearAllTrash();
      setTransactions([]);
      setTrash([]);
    },
    [verifyCurrentPassword]
  );

  const secureResetAllData = useCallback(async (password: string) => {
    const valid = await verifyCurrentPassword(password);
    if (!valid) throw new Error('Password verification failed. Data was not erased.');

    dekRef.current = null;
    await secureWipeDatabase();
    clearCredentialVerifierHash();
    setVaultMeta(null);
    setSettings(DEFAULT_SETTINGS);
    setCategories([]);
    setTransactions([]);
    setTrash([]);
    setAutoBackups([]);
    setMigrations([]);
    setStatus('needs_setup');
  }, [verifyCurrentPassword]);

  const summary = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let currentMonthIncome = 0;
    let currentMonthExpenses = 0;
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const tx of transactions) {
      if (tx.type === 'income') {
        totalIncome += tx.amount;
        if (tx.date.startsWith(currentMonthPrefix)) {
          currentMonthIncome += tx.amount;
        }
      } else {
        totalExpenses += tx.amount;
        if (tx.date.startsWith(currentMonthPrefix)) {
          currentMonthExpenses += tx.amount;
        }
      }
    }

    const currentBalance = (settings.openingBalance || 0) + totalIncome - totalExpenses;
    return {
      currentMonthIncome,
      currentMonthExpenses,
      currentMonthNet: currentMonthIncome - currentMonthExpenses,
      totalIncome,
      totalExpenses,
      currentBalance,
    };
  }, [transactions, settings.openingBalance]);

  const value: VaultContextValue = {
    status,
    vaultMeta,
    settings,
    categories,
    transactions,
    trash,
    autoBackups,
    migrations,
    lastAutoBackupNotice,
    dismissAutoBackupNotice: () => setLastAutoBackupNotice(null),
    summary,
    initializeNewVault,
    unlockWithPassword,
    unlockWithPin,
    verifyCurrentPassword,
    lockVault,
    updateSettings,
    setTheme,
    addTransaction,
    addBatchTransactions,
    updateTransaction,
    deleteTransaction,
    restoreFromTrash,
    permanentlyDeleteTrash,
    emptyTrash,
    addCategory,
    updateCategory,
    deleteCategory,
    changeMasterPassword,
    enableQuickPin,
    disableQuickPin,
    exportEncryptedBackup,
    createMonthlySnapshotNow,
    downloadAutoBackupSnapshot,
    restoreFromBackupFile,
    mergeFromBackupFile,
    deleteAllTransactions,
    secureResetAllData,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
};

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
