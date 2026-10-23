// Client-side authenticated encryption (AEAD: CTR-HMAC-SHA256 + Encrypt-then-MAC)
// and pure TypeScript SHA-256 / HMAC-SHA256 primitives for React Native, Web, and Node.
//
// Key management, in one place so the rules are hard to miss:
//
//   * The 32-byte per-user master key lives in the device keychain
//     (expo-secure-store) — not AsyncStorage, which is a plain file on native
//     and localStorage on web.
//   * Nothing in this module ever mints a master key implicitly. A missing key
//     throws MasterKeyUnavailableError so the caller can decide between "new
//     user, provision one" and "existing user, ask for the recovery code".
//     Silently generating a fresh key is what made reinstalls destroy journals.
//   * wrapMasterKey/unwrapMasterKey back the key up under a recovery code the
//     user holds. The wrapped blob is stored server-side by lib/key-recovery.ts;
//     the code itself never leaves the device.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * A ciphertext did not authenticate: wrong key, wrong recovery code, tampered
 * payload, or a malformed envelope. The message keeps the
 * "Decryption authentication failed" prefix that callers and tests match on.
 */
export class DecryptionError extends Error {
  constructor(detail: string) {
    super(`Decryption authentication failed: ${detail}`);
    this.name = 'DecryptionError';
  }
}

/**
 * No master key is available on this device for this user. Either the user is
 * new (provision one) or their key lives on another device (unwrap it with the
 * recovery code). Never answer this by generating a new key: existing
 * ciphertext would become unreadable forever.
 */
export class MasterKeyUnavailableError extends Error {
  constructor(message = 'No encryption key on this device for this account.') {
    super(message);
    this.name = 'MasterKeyUnavailableError';
  }
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new DecryptionError('invalid hex encoding');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLenHi = Math.floor((data.length * 8) / 0x100000000);
  const bitLenLo = (data.length * 8) >>> 0;

  const padLen = (data.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLenHi, false);
  view.setUint32(padLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(input)));
}

export function hmacSha256Bytes(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const keyBlock = new Uint8Array(blockSize);
  if (key.length > blockSize) {
    keyBlock.set(sha256Bytes(key));
  } else {
    keyBlock.set(key);
  }

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    oKeyPad[i] = keyBlock[i] ^ 0x5c;
    iKeyPad[i] = keyBlock[i] ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + message.length);
  inner.set(iKeyPad, 0);
  inner.set(message, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKeyPad, 0);
  outer.set(innerHash, blockSize);
  return sha256Bytes(outer);
}

function randomBytes(length: number): Uint8Array {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const out = new Uint8Array(length);
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  throw new Error('Cryptographically secure PRNG unavailable: globalThis.crypto.getRandomValues is required.');
}

// ---------------------------------------------------------------------------
// Device key storage
// ---------------------------------------------------------------------------

export const MASTER_KEY_BYTES = 32;

const memoryKeyStore = new Map<string, string>();

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
function secureStoreKeyFor(userId: string): string {
  return `yesyas_enc_key_v1_${userId.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** Pre-SecureStore location. Read once, migrated, then deleted. */
function legacyAsyncStorageKeyFor(userId: string): string {
  return `@yesyas/enc_key_v1:${userId}`;
}

// Standalone Node CLI (scripts/verify-domain-logic.ts) has neither module.
const isNodeCli =
  typeof process !== 'undefined' &&
  Boolean(process.versions?.node) &&
  typeof window === 'undefined';

type SecureStoreModule = {
  isAvailableAsync: () => Promise<boolean>;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: Record<string, unknown>) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: unknown;
};

type AsyncStorageModule = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

async function loadSecureStore(): Promise<SecureStoreModule | null> {
  if (isNodeCli) return null;
  try {
    const mod = (await import('expo-secure-store')) as unknown as SecureStoreModule;
    if (typeof mod.isAvailableAsync !== 'function') return null;
    // Returns false on web, where there is no keychain to talk to.
    if (!(await mod.isAvailableAsync())) return null;
    return mod;
  } catch {
    return null;
  }
}

async function loadAsyncStorage(): Promise<AsyncStorageModule | null> {
  if (isNodeCli) return null;
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    return mod.default as unknown as AsyncStorageModule;
  } catch {
    return null;
  }
}

/**
 * `absent` means the stores answered and hold nothing. `unavailable` means a
 * store failed to answer, which is emphatically not the same thing: treating a
 * keychain hiccup as "no key" would let provisionMasterKey write over a key
 * that is really there, which is the exact data loss this module exists to
 * prevent.
 */
type StoredKeyResult =
  | { status: 'found'; keyHex: string }
  | { status: 'absent' }
  | { status: 'unavailable' };

/**
 * Reads the stored key hex for a user, newest location first, and migrates a
 * legacy AsyncStorage key into SecureStore when it finds one.
 */
async function readStoredKeyHex(userId: string): Promise<StoredKeyResult> {
  const cached = memoryKeyStore.get(userId);
  if (cached) return { status: 'found', keyHex: cached };

  let readFailed = false;

  const secureStore = await loadSecureStore();
  if (secureStore) {
    try {
      const stored = await secureStore.getItemAsync(secureStoreKeyFor(userId));
      if (stored && stored.length === MASTER_KEY_BYTES * 2) {
        memoryKeyStore.set(userId, stored);
        return { status: 'found', keyHex: stored };
      }
    } catch {
      // Keychain refused to answer (locked device, simulator quirk).
      readFailed = true;
    }
  }

  // One-time migration out of the pre-SecureStore location.
  const asyncStorage = await loadAsyncStorage();
  if (asyncStorage) {
    try {
      const legacyKey = legacyAsyncStorageKeyFor(userId);
      const legacy = await asyncStorage.getItem(legacyKey);
      if (legacy && legacy.length === MASTER_KEY_BYTES * 2) {
        memoryKeyStore.set(userId, legacy);
        if (secureStore) {
          try {
            await secureStore.setItemAsync(secureStoreKeyFor(userId), legacy, {
              keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
            // Only drop the old copy once the keychain write succeeded.
            await asyncStorage.removeItem(legacyKey);
          } catch {
            // Leave the legacy copy in place rather than risk losing the key.
          }
        }
        return { status: 'found', keyHex: legacy };
      }
    } catch {
      readFailed = true;
    }
  }

  return readFailed ? { status: 'unavailable' } : { status: 'absent' };
}

async function writeStoredKeyHex(userId: string, keyHex: string): Promise<void> {
  memoryKeyStore.set(userId, keyHex);

  const secureStore = await loadSecureStore();
  if (secureStore) {
    try {
      await secureStore.setItemAsync(secureStoreKeyFor(userId), keyHex, {
        keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return;
    } catch {
      // Fall through to AsyncStorage so the session at least keeps working.
    }
  }

  // Web and keychain-less devices. Weaker at rest, which is exactly why the
  // recovery-code backup exists.
  const asyncStorage = await loadAsyncStorage();
  if (asyncStorage) {
    try {
      await asyncStorage.setItem(legacyAsyncStorageKeyFor(userId), keyHex);
    } catch {
      // In-memory only for this session.
    }
  }
}

/** True when this device can decrypt this user's content right now. */
export async function hasMasterKey(userId: string): Promise<boolean> {
  if (!userId) return false;
  return (await readStoredKeyHex(userId)).status === 'found';
}

async function requireMasterKey(userId: string): Promise<Uint8Array> {
  if (!userId) {
    throw new Error('userId is required for key derivation');
  }
  const result = await readStoredKeyHex(userId);
  if (result.status !== 'found') {
    throw new MasterKeyUnavailableError();
  }
  return hexToBytes(result.keyHex);
}

/**
 * Creates and stores a master key for a user who does not have one yet.
 * Refuses to overwrite an existing key — that would orphan existing ciphertext.
 * Only call this for an account with no recovery backup on the server.
 */
export async function provisionMasterKey(userId: string): Promise<void> {
  if (!userId) {
    throw new Error('userId is required to provision a key');
  }
  const existing = await readStoredKeyHex(userId);
  if (existing.status === 'found') return;
  if (existing.status === 'unavailable') {
    // A store failed to answer. Generating now could overwrite a key that is
    // actually present, so make the caller retry instead.
    throw new MasterKeyUnavailableError(
      'Secure storage is unavailable on this device right now. Please try again.',
    );
  }
  await writeStoredKeyHex(userId, bytesToHex(randomBytes(MASTER_KEY_BYTES)));
}

/** Installs a master key recovered from a backup onto this device. */
export async function adoptMasterKey(userId: string, masterKey: Uint8Array): Promise<void> {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`Master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  await writeStoredKeyHex(userId, bytesToHex(masterKey));
}

/** Returns the raw master key so it can be wrapped for backup. */
export async function exportMasterKey(userId: string): Promise<Uint8Array> {
  return requireMasterKey(userId);
}

/**
 * Removes the device copy of the key. Everything encrypted under it stays
 * encrypted, so only do this where the user has a recovery code or is
 * deliberately discarding their data.
 */
export async function clearMasterKey(userId: string): Promise<void> {
  memoryKeyStore.delete(userId);
  const secureStore = await loadSecureStore();
  if (secureStore) {
    try {
      await secureStore.deleteItemAsync(secureStoreKeyFor(userId));
    } catch {
      // Best effort.
    }
  }
  const asyncStorage = await loadAsyncStorage();
  if (asyncStorage) {
    try {
      await asyncStorage.removeItem(legacyAsyncStorageKeyFor(userId));
    } catch {
      // Best effort.
    }
  }
}

// ---------------------------------------------------------------------------
// AEAD core — wire format `enc:v1:<ivHex>:<cipherHex>:<macHex>`
// ---------------------------------------------------------------------------

interface Subkeys {
  encKey: Uint8Array;
  macKey: Uint8Array;
}

function deriveSubkeys(masterKey: Uint8Array, userId: string): Subkeys {
  const encKey = hmacSha256Bytes(masterKey, utf8ToBytes(`yesyas:enc:v1:${userId}`));
  const macKey = hmacSha256Bytes(masterKey, utf8ToBytes(`yesyas:mac:v1:${userId}`));
  return { encKey, macKey };
}

/** Separate domain so a wrapped key can never be confused with a note body. */
function deriveRecoverySubkeys(kek: Uint8Array): Subkeys {
  const encKey = hmacSha256Bytes(kek, utf8ToBytes('yesyas:recovery:enc:v1'));
  const macKey = hmacSha256Bytes(kek, utf8ToBytes('yesyas:recovery:mac:v1'));
  return { encKey, macKey };
}

function xorCtrKeystream(input: Uint8Array, encKey: Uint8Array, iv: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length);
  const counterBlock = new Uint8Array(iv.length + 4);
  counterBlock.set(iv, 0);
  const counterView = new DataView(counterBlock.buffer);

  let blockIndex = 0;
  for (let offset = 0; offset < input.length; offset += 32) {
    counterView.setUint32(iv.length, blockIndex, false);
    const keystream = hmacSha256Bytes(encKey, counterBlock);
    const chunkLen = Math.min(32, input.length - offset);
    for (let i = 0; i < chunkLen; i += 1) {
      output[offset + i] = input[offset + i] ^ keystream[i];
    }
    blockIndex += 1;
  }
  return output;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function aeadSeal(plainBytes: Uint8Array, { encKey, macKey }: Subkeys): string {
  const iv = randomBytes(16);
  const cipherBytes = xorCtrKeystream(plainBytes, encKey, iv);

  const ivHex = bytesToHex(iv);
  const cipherHex = bytesToHex(cipherBytes);
  const authenticatedData = utf8ToBytes(`enc:v1:${ivHex}:${cipherHex}`);
  const macHex = bytesToHex(hmacSha256Bytes(macKey, authenticatedData));

  return `enc:v1:${ivHex}:${cipherHex}:${macHex}`;
}

function aeadOpen(payload: string, { encKey, macKey }: Subkeys): Uint8Array {
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new DecryptionError('malformed ciphertext envelope');
  }

  const [, , ivHex, cipherHex, macHex] = parts;
  if (ivHex.length !== 32 || macHex.length !== 64) {
    throw new DecryptionError('invalid IV or MAC length');
  }

  const authenticatedData = utf8ToBytes(`enc:v1:${ivHex}:${cipherHex}`);
  const expectedMac = hmacSha256Bytes(macKey, authenticatedData);
  const actualMac = hexToBytes(macHex);

  if (!constantTimeEqual(expectedMac, actualMac)) {
    throw new DecryptionError('MAC verification failed');
  }

  return xorCtrKeystream(hexToBytes(cipherHex), encKey, hexToBytes(ivHex));
}

/** True for anything this module produced, so callers can skip legacy plaintext. */
export function isEncryptedPayload(value: string): boolean {
  return value.startsWith('enc:v1:');
}

/**
 * Encrypts text under the user's device key.
 * @throws MasterKeyUnavailableError when the device holds no key.
 */
export async function encryptText(plaintext: string, userId: string): Promise<string> {
  const masterKey = await requireMasterKey(userId);
  return aeadSeal(utf8ToBytes(plaintext), deriveSubkeys(masterKey, userId));
}

export const encryptForUser = encryptText;

/**
 * Decrypts text written by {@link encryptText}. Rows stored before
 * column encryption shipped are returned unchanged and need no key.
 * @throws MasterKeyUnavailableError when the device holds no key.
 * @throws DecryptionError when the payload does not authenticate.
 */
export async function decryptText(payload: string, userId: string): Promise<string> {
  if (!isEncryptedPayload(payload)) {
    return payload;
  }
  const masterKey = await requireMasterKey(userId);
  return bytesToUtf8(aeadOpen(payload, deriveSubkeys(masterKey, userId)));
}

export const decryptForUser = decryptText;

export function hashUserIdForLogging(userId: string): string {
  return sha256Hex(`ai_logs:${userId.trim().toLowerCase()}`);
}

/**
 * Readability of one encrypted column for the current device.
 *
 * `locked` is recoverable — the content is intact and a recovery code will
 * open it. `unreadable` is not: the payload failed authentication. Callers
 * must distinguish the two in the UI and must never write over either.
 */
export type EncryptedFieldState = 'ok' | 'locked' | 'unreadable';

/**
 * Maps a decryption failure onto a field state, re-throwing anything that is
 * not a crypto error so genuine bugs stay loud.
 */
export function classifyDecryptionFailure(err: unknown): Exclude<EncryptedFieldState, 'ok'> {
  if (err instanceof MasterKeyUnavailableError) {
    return 'locked';
  }
  if (err instanceof DecryptionError) {
    return 'unreadable';
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/** Crockford base32: no I, L, O or U, so handwritten codes survive transcription. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_DATA_CHARS = 20; // 100 bits of entropy
const RECOVERY_CHECKSUM_CHARS = 4;
const RECOVERY_TOTAL_CHARS = RECOVERY_DATA_CHARS + RECOVERY_CHECKSUM_CHARS;
const RECOVERY_GROUP_SIZE = 4;

/**
 * PBKDF2 iteration count for new backups. Deliberately high because the
 * recovery code is the only thing standing between a stolen blob and a user's
 * journal; it runs once per unlock, not per entry. Stored alongside each blob
 * so this can be raised without breaking old codes.
 */
export const RECOVERY_KDF_ITERATIONS = 150_000;

export const RECOVERY_SALT_BYTES = 16;

/**
 * Iterations between event-loop yields. SHA-256 here is pure JavaScript, so a
 * full 150k-round derivation takes roughly half a second on a desktop and
 * several times that on a mid-range phone. Running it in one synchronous block
 * freezes the UI thread and risks Android's ANR dialog, so the loop hands
 * control back periodically to keep the spinner moving.
 */
const PBKDF2_YIELD_INTERVAL = 4096;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** PBKDF2-HMAC-SHA256. */
async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  if (iterations < 1) {
    throw new Error('PBKDF2 iterations must be positive');
  }
  const hLen = 32;
  const blocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(blocks * hLen);

  for (let block = 1; block <= blocks; block += 1) {
    const saltWithIndex = new Uint8Array(salt.length + 4);
    saltWithIndex.set(salt, 0);
    new DataView(saltWithIndex.buffer).setUint32(salt.length, block, false);

    let u = hmacSha256Bytes(password, saltWithIndex);
    const accumulated = new Uint8Array(u);
    for (let i = 1; i < iterations; i += 1) {
      u = hmacSha256Bytes(password, u);
      for (let j = 0; j < hLen; j += 1) {
        accumulated[j] ^= u[j];
      }
      if (i % PBKDF2_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }
    out.set(accumulated, (block - 1) * hLen);
  }

  return out.slice(0, dkLen);
}

function toBase32Chars(bytes: Uint8Array, charCount: number): string {
  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = 0;
  let out = '';

  while (out.length < charCount) {
    if (bitCount < 5) {
      if (byteIndex >= bytes.length) {
        throw new Error('Insufficient entropy for recovery code');
      }
      bitBuffer = (bitBuffer << 8) | bytes[byteIndex];
      byteIndex += 1;
      bitCount += 8;
    }
    bitCount -= 5;
    out += RECOVERY_ALPHABET[(bitBuffer >>> bitCount) & 0x1f];
  }

  return out;
}

function recoveryChecksum(dataChars: string): string {
  return toBase32Chars(sha256Bytes(utf8ToBytes(`yesyas:recovery-checksum:v1:${dataChars}`)), RECOVERY_CHECKSUM_CHARS);
}

/** `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` for display. */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += RECOVERY_GROUP_SIZE) {
    groups.push(code.slice(i, i + RECOVERY_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Canonicalises user input: uppercases, folds the characters people most often
 * substitute (O/0, I/1, L/1), and drops separators and spaces.
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .split('')
    .filter((ch) => RECOVERY_ALPHABET.includes(ch))
    .join('');
}

/** Cheap local check so a typo fails instantly instead of after a 150k-round KDF. */
export function isValidRecoveryCode(input: string): boolean {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== RECOVERY_TOTAL_CHARS) return false;
  const dataChars = normalized.slice(0, RECOVERY_DATA_CHARS);
  const checksum = normalized.slice(RECOVERY_DATA_CHARS);
  return checksum === recoveryChecksum(dataChars);
}

/** Generates a fresh, checksummed recovery code in display form. */
export function generateRecoveryCode(): string {
  const dataChars = toBase32Chars(randomBytes(RECOVERY_DATA_CHARS), RECOVERY_DATA_CHARS);
  return formatRecoveryCode(`${dataChars}${recoveryChecksum(dataChars)}`);
}

export interface WrappedMasterKey {
  wrappedKey: string;
  salt: string;
  iterations: number;
}

function recoveryKek(
  normalizedCode: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  return pbkdf2Sha256(utf8ToBytes(normalizedCode), salt, iterations, 32);
}

/**
 * Wraps a master key under a recovery code. The result is safe to store
 * server-side: without the code it is a 32-byte secret behind 150k PBKDF2
 * rounds, and the server never sees the code.
 */
export async function wrapMasterKey(
  masterKey: Uint8Array,
  recoveryCode: string,
  iterations: number = RECOVERY_KDF_ITERATIONS,
): Promise<WrappedMasterKey> {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`Master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length !== RECOVERY_TOTAL_CHARS) {
    throw new Error('Recovery code is the wrong length');
  }

  const salt = randomBytes(RECOVERY_SALT_BYTES);
  const kek = await recoveryKek(normalized, salt, iterations);
  return {
    wrappedKey: aeadSeal(masterKey, deriveRecoverySubkeys(kek)),
    salt: bytesToHex(salt),
    iterations,
  };
}

/**
 * Unwraps a master key with a recovery code.
 * @throws DecryptionError when the code is wrong or the blob was tampered with.
 */
export async function unwrapMasterKey(
  wrapped: WrappedMasterKey,
  recoveryCode: string,
): Promise<Uint8Array> {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length !== RECOVERY_TOTAL_CHARS) {
    throw new DecryptionError('recovery code is the wrong length');
  }

  const kek = await recoveryKek(normalized, hexToBytes(wrapped.salt), wrapped.iterations);
  const masterKey = aeadOpen(wrapped.wrappedKey, deriveRecoverySubkeys(kek));
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new DecryptionError('recovered key has the wrong length');
  }
  return masterKey;
}
