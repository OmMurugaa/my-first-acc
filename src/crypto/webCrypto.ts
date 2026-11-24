import {APP_VERSION} from '../types/finance';
import type {EncryptedBackupFile, VaultBackupPayload} from '../types/finance';

const TARGET_PBKDF2_ITERATIONS = 600000;
const MIN_PBKDF2_ITERATIONS = 300000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BITS = 128;

export const CREDENTIAL_VERIFIER_STORAGE_KEY = 'mfa_credential_verifier_v1';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

export function generateIV(): Uint8Array {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  return iv;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Benchmarks PBKDF2-HMAC-SHA-256 on the current device.
 * Measures 50,000 iterations and extrapolates 600,000-iteration cost,
 * always keeping at least 600,000 iterations unless extremely slow (>3.5s),
 * in which case it clamps cleanly above 300,000.
 */
export async function benchmarkPBKDF2(): Promise<{
  recommendedIterations: number;
  estimated600kMs: number;
  sampleMs: number;
}> {
  const sampleIterations = 50000;
  const testPassword = textEncoder.encode('benchmark-probe-material');
  const testSalt = generateSalt();

  const start = performance.now();
  const baseKey = await crypto.subtle.importKey('raw', testPassword, 'PBKDF2', false, ['deriveBits']);
  await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(testSalt),
      iterations: sampleIterations,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  const sampleMs = Math.max(1, performance.now() - start);
  const estimated600kMs = Math.round((sampleMs / sampleIterations) * TARGET_PBKDF2_ITERATIONS);

  let recommendedIterations = TARGET_PBKDF2_ITERATIONS;
  if (estimated600kMs > 4000) {
    // Device is very constrained (e.g., low-power mobile): scale safely above 300k
    recommendedIterations = Math.max(
      MIN_PBKDF2_ITERATIONS,
      Math.round((TARGET_PBKDF2_ITERATIONS * 2500) / estimated600kMs / 10000) * 10000
    );
  }

  return {
    recommendedIterations,
    estimated600kMs,
    sampleMs: Math.round(sampleMs),
  };
}

/**
 * Derives a 256-bit AES-GCM Key Encryption Key (KEK) from user password/PIN
 * using PBKDF2-HMAC-SHA-256.
 */
export async function deriveKEK(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Computes a salted SHA-256 credential verifier hash for localStorage so
 * passwords/keys are NEVER stored in plain text.
 */
export async function computeCredentialVerifier(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(`verifier::${secret}`),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: Math.min(iterations, 100000),
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  const digest = await crypto.subtle.digest('SHA-256', bits);
  return toBase64(new Uint8Array(digest));
}

export function saveCredentialVerifierHash(hash: string): void {
  localStorage.setItem(CREDENTIAL_VERIFIER_STORAGE_KEY, hash);
}

export function getCredentialVerifierHash(): string | null {
  return localStorage.getItem(CREDENTIAL_VERIFIER_STORAGE_KEY);
}

export function clearCredentialVerifierHash(): void {
  localStorage.removeItem(CREDENTIAL_VERIFIER_STORAGE_KEY);
}

/**
 * Generates a random 256-bit Data Encryption Key (DEK) for AES-256-GCM.
 */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {name: 'AES-GCM', length: 256},
    true, // extractable only for secure AES-GCM wrapping with KEK
    ['encrypt', 'decrypt']
  );
}

export async function wrapDEK(
  dek: CryptoKey,
  kek: CryptoKey
): Promise<{wrappedDek: string; iv: string}> {
  const iv = generateIV();
  const wrappedBuffer = await crypto.subtle.wrapKey('raw', dek, kek, {
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    tagLength: AUTH_TAG_BITS,
  });
  return {
    wrappedDek: toBase64(new Uint8Array(wrappedBuffer)),
    iv: toBase64(iv),
  };
}

export async function unwrapDEK(
  wrappedDekBase64: string,
  ivBase64: string,
  kek: CryptoKey,
  extractable = true
): Promise<CryptoKey> {
  const wrappedBytes = fromBase64(wrappedDekBase64);
  const iv = fromBase64(ivBase64);
  return crypto.subtle.unwrapKey(
    'raw',
    toArrayBuffer(wrappedBytes),
    kek,
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      tagLength: AUTH_TAG_BITS,
    },
    {name: 'AES-GCM', length: 256},
    extractable,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload<T>(
  dek: CryptoKey,
  payload: T
): Promise<{iv: string; ciphertext: string}> {
  const iv = generateIV();
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      tagLength: AUTH_TAG_BITS,
    },
    dek,
    plaintext
  );
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptPayload<T>(
  dek: CryptoKey,
  ivBase64: string,
  ciphertextBase64: string
): Promise<T> {
  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(ciphertextBase64);
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      tagLength: AUTH_TAG_BITS,
    },
    dek,
    toArrayBuffer(ciphertext)
  );
  const json = textDecoder.decode(decryptedBuffer);
  return JSON.parse(json) as T;
}

export async function createEncryptedBackupFile(
  payload: VaultBackupPayload,
  backupPassword: string,
  iterations = TARGET_PBKDF2_ITERATIONS
): Promise<EncryptedBackupFile> {
  const salt = generateSalt();
  const kek = await deriveKEK(backupPassword, salt, iterations);
  const {iv, ciphertext} = await encryptPayload(kek, payload);

  return {
    magic: 'MFA_ENC_V1',
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA-256',
    iterations,
    salt: toBase64(salt),
    iv,
    ciphertext,
    exportedAt: Date.now(),
  };
}

interface MyPetBackupEnvelope {
  app: string;
  type: string;
  format: number;
  kdf: {
    name: string;
    hash: string;
    iterations: number;
    salt: string;
  };
  cipher: {
    name: string;
    iv: string;
  };
  data: string;
}

interface MyPetInnerPayload {
  app: string;
  version: number;
  created?: string;
  opening: number;
  categories: Array<{type: 'income' | 'expense'; name: string; def?: boolean}>;
  transactions: Array<{
    type: 'income' | 'expense';
    date: string;
    cents: number;
    category: string;
    description: string;
    method?: string;
    notes?: string;
    created?: number;
  }>;
  settings?: {lang?: string; theme?: string};
}

const MYPET_APPS = new Set(['MyPET(Super)v1.2', 'MyPET(Super)v1.1', 'MyPET']);

function generateTxIdForMigration(dateStr: string): string {
  const cleanDate = dateStr.replace(/-/g, '');
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `TXN-${cleanDate}-${hex}`;
}

async function decryptMyPetBackupFile(
  parsed: MyPetBackupEnvelope,
  backupPassword: string
): Promise<VaultBackupPayload> {
  if (
    !MYPET_APPS.has(parsed.app) ||
    parsed.type !== 'backup' ||
    parsed.format !== 1 ||
    !parsed.kdf ||
    parsed.kdf.name !== 'PBKDF2' ||
    parsed.kdf.hash !== 'SHA-256' ||
    !Number.isInteger(parsed.kdf.iterations) ||
    parsed.kdf.iterations < 100000 ||
    parsed.kdf.iterations > 5000000 ||
    !parsed.cipher ||
    parsed.cipher.name !== 'AES-GCM' ||
    typeof parsed.data !== 'string'
  ) {
    throw new Error('Invalid or unsupported MyPET backup envelope.');
  }

  const salt = fromBase64(parsed.kdf.salt);
  const iv = fromBase64(parsed.cipher.iv);
  const ciphertext = fromBase64(parsed.data);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) {
    throw new Error('Malformed MyPET backup cryptographic parameters.');
  }

  // MyPET normalizes backup passwords with NFKC before deriving PBKDF2 key
  const kek = await deriveKEK(backupPassword.normalize('NFKC'), salt, parsed.kdf.iterations);

  let inner: MyPetInnerPayload;
  try {
    inner = await decryptPayload<MyPetInnerPayload>(kek, parsed.cipher.iv, parsed.data);
  } catch {
    throw new Error('Decryption failed. MyPET backup password is incorrect or file is damaged.');
  }

  if (
    !inner ||
    !MYPET_APPS.has(inner.app) ||
    inner.version !== 1 ||
    !Array.isArray(inner.categories) ||
    !Array.isArray(inner.transactions) ||
    !Number.isSafeInteger(inner.opening)
  ) {
    throw new Error('Decrypted MyPET backup contains invalid data structure.');
  }

  const now = Date.now();
  const categoriesOut: VaultBackupPayload['categories'] = [
    {
      id: 'cat_inc_others',
      name: 'Others',
      type: 'income',
      isFixed: true,
      createdAt: now,
    },
    {
      id: 'cat_exp_others',
      name: 'Others',
      type: 'expense',
      isFixed: true,
      createdAt: now + 1,
    },
  ];
  const catIdByKey = new Map<string, string>();
  catIdByKey.set('income|others', 'cat_inc_others');
  catIdByKey.set('income|other income', 'cat_inc_others');
  catIdByKey.set('expense|others', 'cat_exp_others');
  catIdByKey.set('expense|other expenses', 'cat_exp_others');

  const ensureCategory = (type: 'income' | 'expense', rawName: string, idx: number): string => {
    const name = rawName.trim().slice(0, 40);
    const key = `${type}|${name.toLowerCase()}`;
    const existingId = catIdByKey.get(key);
    if (existingId) return existingId;

    const id = `cat_${type === 'income' ? 'inc' : 'exp'}_mypet_${idx}_${crypto.randomUUID().slice(0, 6)}`;
    catIdByKey.set(key, id);
    categoriesOut.push({
      id,
      name,
      type,
      isFixed: false,
      createdAt: now + 10 + idx,
    });
    return id;
  };

  inner.categories.forEach((c, idx) => {
    if ((c.type === 'income' || c.type === 'expense') && typeof c.name === 'string' && c.name.trim()) {
      ensureCategory(c.type, c.name, idx);
    }
  });

  const transactionsOut: VaultBackupPayload['transactions'] = [];
  inner.transactions.forEach((tx, idx) => {
    if (
      (tx.type !== 'income' && tx.type !== 'expense') ||
      typeof tx.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(tx.date) ||
      !Number.isSafeInteger(tx.cents) ||
      tx.cents <= 0
    ) {
      throw new Error(`Invalid transaction entry #${idx + 1} inside MyPET backup.`);
    }

    const catId = ensureCategory(tx.type, tx.category || 'Others', 1000 + idx);
    const desc = (tx.description || '').trim();
    const extraNotes = (tx.notes || '').trim();
    const combinedNotes =
      desc && extraNotes && extraNotes !== desc
        ? `${desc} — ${extraNotes}`.slice(0, 300)
        : (desc || extraNotes).slice(0, 300);

    const ts =
      typeof tx.created === 'number' && Number.isSafeInteger(tx.created) && tx.created > 0
        ? tx.created
        : now + idx;

    transactionsOut.push({
      id: generateTxIdForMigration(tx.date),
      date: tx.date,
      amount: tx.cents / 100,
      categoryId: catId,
      type: tx.type,
      notes: combinedNotes || 'Imported from MyPET Super',
      createdAt: ts,
      updatedAt: ts,
    });
  });

  const sortedDates = transactionsOut.map((t) => t.date).sort();
  const mappedTheme = inner.settings?.theme === 'gray' ? 'gray' : 'dark';

  return {
    format: 'myfirst-account-encrypted-backup',
    appVersion: APP_VERSION,
    schemaVersion: 1,
    exportedAt: now,
    settings: {
      language: 'en',
      currency: 'EUR',
      theme: mappedTheme,
      dateFormat: 'DD-MM-YYYY',
      numberFormat: 'international',
      openingBalance: inner.opening / 100,
      openingBalanceDate: sortedDates[0] || new Date().toISOString().slice(0, 10),
      autoLockMinutes: 5,
      confirmOnSensitiveActions: false,
      autoMonthlyBackupEnabled: true,
      schemaVersion: 1,
    },
    categories: categoriesOut,
    transactions: transactionsOut.sort((a, b) =>
      a.date !== b.date ? b.date.localeCompare(a.date) : b.createdAt - a.createdAt
    ),
    trash: [],
  };
}

export async function decryptBackupFile(
  rawJson: string,
  backupPassword: string
): Promise<VaultBackupPayload> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid backup file format (corrupted JSON).');
  }

  // Support MyPET Super (.MyPET) AES-256-GCM encrypted backup files natively
  if (
    typeof parsed.app === 'string' &&
    MYPET_APPS.has(parsed.app) &&
    parsed.type === 'backup'
  ) {
    return decryptMyPetBackupFile(parsed as unknown as MyPetBackupEnvelope, backupPassword);
  }

  const mfa = parsed as unknown as EncryptedBackupFile;
  if (
    mfa.magic !== 'MFA_ENC_V1' ||
    mfa.algorithm !== 'AES-256-GCM' ||
    !mfa.salt ||
    !mfa.iv ||
    !mfa.ciphertext ||
    !mfa.iterations
  ) {
    throw new Error('Unsupported or malformed encrypted backup envelope (.mfa or .MyPET required).');
  }

  const salt = fromBase64(mfa.salt);
  const kek = await deriveKEK(backupPassword, salt, mfa.iterations);
  try {
    const payload = await decryptPayload<VaultBackupPayload>(kek, mfa.iv, mfa.ciphertext);
    if (payload.format !== 'myfirst-account-encrypted-backup') {
      throw new Error('Invalid backup payload signature.');
    }
    return payload;
  } catch {
    throw new Error('Decryption failed. Backup password is incorrect or the file was modified.');
  }
}
