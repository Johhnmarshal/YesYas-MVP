// Orchestration for the client-side encryption key: decides whether this
// device can read the user's content, provisions a key for genuinely new
// accounts, and backs the key up under a user-held recovery code.
//
// lib/crypto.ts stays free of any Supabase import so it can run in the plain
// Node CLI used by scripts/verify-domain-logic.ts. All network access lives here.

import {
  MasterKeyUnavailableError,
  adoptMasterKey,
  bytesToHex,
  clearMasterKey,
  exportMasterKey,
  generateRecoveryCode,
  hasMasterKey,
  isValidRecoveryCode,
  provisionMasterKey,
  unwrapMasterKey,
  wrapMasterKey,
  type WrappedMasterKey,
} from './crypto';
import { supabase } from './supabase';

/**
 * `ready`  — this device holds the key; encrypt and decrypt work.
 * `locked` — the account has a backup but this device has no key. The user
 *            must enter their recovery code; we must not mint a new key.
 */
export type KeyState = 'ready' | 'locked';

export interface KeyStatus {
  state: KeyState;
  hasRemoteBackup: boolean;
}

export class RecoveryCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryCodeError';
  }
}

/**
 * Reads the wrapped-key row. Returns null only when the account genuinely has
 * no backup; a failed request throws, because treating "I could not ask" as
 * "there is no backup" is what destroys data.
 */
async function fetchWrappedKey(userId: string): Promise<WrappedMasterKey | null> {
  const { data, error } = await supabase
    .from('user_key_recovery')
    .select('wrapped_key, salt, iterations')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    wrappedKey: data.wrapped_key,
    salt: data.salt,
    iterations: data.iterations,
  };
}

export async function hasRecoveryBackup(userId: string): Promise<boolean> {
  if (!userId) return false;
  return (await fetchWrappedKey(userId)) !== null;
}

/**
 * Called once per signed-in session before any encrypted read or write.
 *
 * Three cases, and the middle one is the whole point of this module:
 *   - key on device                  -> ready
 *   - no key, backup on the server   -> locked, ask for the recovery code
 *   - no key, no backup              -> brand new account, provision a key
 */
export async function ensureKeyReady(userId: string): Promise<KeyStatus> {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (await hasMasterKey(userId)) {
    return { state: 'ready', hasRemoteBackup: await hasRecoveryBackup(userId) };
  }

  // Throws on a network or RLS failure, which keeps us from provisioning a
  // second key for a user whose backup we simply could not reach.
  const wrapped = await fetchWrappedKey(userId);
  if (wrapped) {
    return { state: 'locked', hasRemoteBackup: true };
  }

  await provisionMasterKey(userId);
  return { state: 'ready', hasRemoteBackup: false };
}

/**
 * Generates a recovery code, wraps this device's key under it, and stores the
 * wrapped blob. Returns the code in display form — it is the only time it
 * exists anywhere, so the caller must show it before discarding it.
 */
export async function createRecoveryCode(userId: string): Promise<string> {
  const masterKey = await exportMasterKey(userId);
  const code = generateRecoveryCode();
  const wrapped = await wrapMasterKey(masterKey, code);

  const { error } = await supabase.from('user_key_recovery').upsert(
    {
      user_id: userId,
      wrapped_key: wrapped.wrappedKey,
      salt: wrapped.salt,
      iterations: wrapped.iterations,
      kdf: 'pbkdf2-hmac-sha256',
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    throw error;
  }

  return code;
}

/**
 * Unwraps the backed-up key with a recovery code and installs it on this
 * device, after which previously written notes and journal entries decrypt
 * normally.
 */
export async function unlockWithRecoveryCode(userId: string, code: string): Promise<void> {
  if (!isValidRecoveryCode(code)) {
    throw new RecoveryCodeError(
      'That does not look like a complete recovery code. Check for missing characters and try again.',
    );
  }

  const wrapped = await fetchWrappedKey(userId);
  if (!wrapped) {
    throw new RecoveryCodeError('This account has no recovery code on file.');
  }

  let masterKey: Uint8Array;
  try {
    masterKey = await unwrapMasterKey(wrapped, code);
  } catch {
    throw new RecoveryCodeError(
      'That recovery code did not unlock this account. Codes are case-insensitive but every character matters.',
    );
  }

  await adoptMasterKey(userId, masterKey);
}

/**
 * Verifies that a recovery code really does unwrap to the key on this device —
 * used right after showing a new code, so a mis-transcribed code is caught
 * while the real key is still present rather than on a future reinstall.
 */
export async function verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
  if (!isValidRecoveryCode(code)) return false;

  const wrapped = await fetchWrappedKey(userId);
  if (!wrapped) return false;

  try {
    const unwrapped = await unwrapMasterKey(wrapped, code);
    const current = await exportMasterKey(userId);
    return bytesToHex(unwrapped) === bytesToHex(current);
  } catch {
    return false;
  }
}

/**
 * Last resort for a user who has lost both their device key and their recovery
 * code: discard the old key and start again with a new one.
 *
 * Everything written under the old key stays in the database and becomes
 * permanently unreadable, so only call this behind an explicit, clearly worded
 * confirmation.
 */
export async function resetEncryptionKey(userId: string): Promise<void> {
  await removeRecoveryBackup(userId);
  await clearMasterKey(userId);
  await provisionMasterKey(userId);
}

/** Drops the server-side backup. The device key is left alone. */
export async function removeRecoveryBackup(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_key_recovery')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export { MasterKeyUnavailableError };
