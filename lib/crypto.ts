// Client-side authenticated encryption (AEAD: CTR-HMAC-SHA256 + Encrypt-then-MAC)
// and pure TypeScript SHA-256 / HMAC-SHA256 primitives for React Native, Web, and Node.

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
    throw new Error('Decryption authentication failed: invalid hex encoding');
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

const memoryKeyStore = new Map<string, string>();

async function readStoredKey(storageKey: string): Promise<string | null> {
  if (memoryKeyStore.has(storageKey)) {
    return memoryKeyStore.get(storageKey) ?? null;
  }
  // Avoid importing React Native AsyncStorage in standalone Node CLI scripts
  const isNodeCli =
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    typeof window === 'undefined';
  if (!isNodeCli) {
    try {
      const mod = await import('@react-native-async-storage/async-storage');
      const AsyncStorage = mod.default;
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        memoryKeyStore.set(storageKey, stored);
        return stored;
      }
    } catch {
      // Fall back to in-memory key store
    }
  }
  return null;
}

async function writeStoredKey(storageKey: string, value: string): Promise<void> {
  memoryKeyStore.set(storageKey, value);
  const isNodeCli =
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    typeof window === 'undefined';
  if (!isNodeCli) {
    try {
      const mod = await import('@react-native-async-storage/async-storage');
      const AsyncStorage = mod.default;
      await AsyncStorage.setItem(storageKey, value);
    } catch {
      // Keep in-memory copy if persistent storage is unavailable
    }
  }
}

async function getUserMasterKey(userId: string): Promise<Uint8Array> {
  if (!userId) {
    throw new Error('userId is required for key derivation');
  }
  const storageKey = `@yesyas/enc_key_v1:${userId}`;
  const existingHex = await readStoredKey(storageKey);
  if (existingHex && existingHex.length === 64) {
    return hexToBytes(existingHex);
  }
  const newKey = randomBytes(32);
  await writeStoredKey(storageKey, bytesToHex(newKey));
  return newKey;
}

function deriveSubkeys(masterKey: Uint8Array, userId: string): { encKey: Uint8Array; macKey: Uint8Array } {
  const encKey = hmacSha256Bytes(masterKey, utf8ToBytes(`yesyas:enc:v1:${userId}`));
  const macKey = hmacSha256Bytes(masterKey, utf8ToBytes(`yesyas:mac:v1:${userId}`));
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

export async function encryptText(plaintext: string, userId: string): Promise<string> {
  const masterKey = await getUserMasterKey(userId);
  const { encKey, macKey } = deriveSubkeys(masterKey, userId);
  const iv = randomBytes(16);
  const plainBytes = utf8ToBytes(plaintext);
  const cipherBytes = xorCtrKeystream(plainBytes, encKey, iv);

  const ivHex = bytesToHex(iv);
  const cipherHex = bytesToHex(cipherBytes);
  const authenticatedData = utf8ToBytes(`enc:v1:${ivHex}:${cipherHex}`);
  const macHex = bytesToHex(hmacSha256Bytes(macKey, authenticatedData));

  return `enc:v1:${ivHex}:${cipherHex}:${macHex}`;
}

export const encryptForUser = encryptText;

export async function decryptText(payload: string, userId: string): Promise<string> {
  if (!payload.startsWith('enc:v1:')) {
    return payload;
  }
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Decryption authentication failed: malformed ciphertext envelope');
  }

  const [, , ivHex, cipherHex, macHex] = parts;
  if (ivHex.length !== 32 || macHex.length !== 64) {
    throw new Error('Decryption authentication failed: invalid IV or MAC length');
  }

  const masterKey = await getUserMasterKey(userId);
  const { encKey, macKey } = deriveSubkeys(masterKey, userId);

  const authenticatedData = utf8ToBytes(`enc:v1:${ivHex}:${cipherHex}`);
  const expectedMac = hmacSha256Bytes(macKey, authenticatedData);
  const actualMac = hexToBytes(macHex);

  if (!constantTimeEqual(expectedMac, actualMac)) {
    throw new Error('Decryption authentication failed: MAC verification failed');
  }

  const iv = hexToBytes(ivHex);
  const cipherBytes = hexToBytes(cipherHex);
  const plainBytes = xorCtrKeystream(cipherBytes, encKey, iv);
  return bytesToUtf8(plainBytes);
}

export const decryptForUser = decryptText;

export function hashUserIdForLogging(userId: string): string {
  return sha256Hex(`ai_logs:${userId.trim().toLowerCase()}`);
}

