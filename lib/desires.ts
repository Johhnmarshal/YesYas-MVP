import {
  MasterKeyUnavailableError,
  classifyDecryptionFailure,
  decryptText,
  encryptText,
  hasMasterKey,
  type EncryptedFieldState,
} from './crypto';
import type { Database, DesireTier } from './database.types';
import { ratingForNewNote } from './desire-note-rules';
import { TIER_ORDER, getAllowedTiers } from './library-filter';
import { supabase } from './supabase';

export type DesireLibraryItem = Database['public']['Tables']['desire_library_items']['Row'];
export type DesireRow = Database['public']['Tables']['desires']['Row'];

/**
 * A rating plus whether its private note could actually be read on this
 * device. When `noteState` is not `ok`, `note` is null rather than an empty
 * string — the old behaviour made a locked note indistinguishable from a note
 * the user had deleted, and let the editor save the blank back over it.
 */
export interface DesireWithNote extends DesireRow {
  noteState: EncryptedFieldState;
}

function readableNote(row: DesireRow, note: string | null): DesireWithNote {
  return { ...row, note, noteState: 'ok' };
}

/**
 * Any write that touches the `note` column needs the device key — including
 * clearing it. Encrypting a value would fail on its own, but writing `null`
 * would not, and that would silently discard a note the user cannot currently
 * read but could still recover.
 */
async function requireUnlockedForNoteWrite(userId: string): Promise<void> {
  if (!(await hasMasterKey(userId))) {
    throw new MasterKeyUnavailableError(
      'This device cannot read your private notes yet, so it will not change them. Unlock with your recovery code first.',
    );
  }
}

// Tier ranking lives in lib/library-filter.ts, which imports no Supabase
// client and so can be exercised by scripts/verify-domain-logic.ts. Re-exported
// here so existing callers keep one import site.
export { TIER_ORDER, getAllowedTiers };

export async function fetchLibraryItems(maxTier?: DesireTier): Promise<DesireLibraryItem[]> {
  let query = supabase
    .from('desire_library_items')
    .select('*')
    .eq('active', true);

  if (maxTier) {
    query = query.in('tier', getAllowedTiers(maxTier));
  }

  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) {
    throw error;
  }

  return (data ?? []).sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.title.localeCompare(b.title);
  });
}

export async function fetchLibraryItemById(id: string): Promise<DesireLibraryItem | null> {
  const { data, error } = await supabase
    .from('desire_library_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data ?? null;
}

export async function fetchUserDesires(
  userId: string,
  pairingId: string | null,
): Promise<DesireWithNote[]> {
  let query = supabase
    .from('desires')
    .select('*')
    .eq('user_id', userId);

  if (pairingId === null) {
    query = query.is('pairing_id', null);
  } else {
    query = query.eq('pairing_id', pairingId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return Promise.all(
    rows.map(async (row) => {
      if (!row.note) {
        return readableNote(row, null);
      }
      try {
        return readableNote(row, await decryptText(row.note, userId));
      } catch (err) {
        // Keep the row, drop the unreadable text, and say why. The ciphertext
        // in the database is untouched, so a recovery-code unlock restores it.
        return { ...row, note: null, noteState: classifyDecryptionFailure(err) };
      }
    }),
  );
}

async function findExistingDesire(
  userId: string,
  pairingId: string | null,
  libraryItemId: string,
): Promise<DesireRow | null> {
  let query = supabase
    .from('desires')
    .select('*')
    .eq('user_id', userId)
    .eq('library_item_id', libraryItemId);

  if (pairingId === null) {
    query = query.is('pairing_id', null);
  } else {
    query = query.eq('pairing_id', pairingId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  return data ?? null;
}

export interface UpsertDesireRatingParams {
  userId: string;
  pairingId: string | null;
  libraryItemId: string;
  rating: number;
  note?: string | null;
}

/**
 * Writes a rating, and the note alongside it when `note` is provided.
 * Encryption requires the device key, so on a locked device this throws
 * MasterKeyUnavailableError before touching the row rather than replacing a
 * readable note with an unreadable one.
 */
export async function upsertDesireRating(
  params: UpsertDesireRatingParams,
): Promise<DesireWithNote> {
  const { userId, pairingId, libraryItemId, rating, note } = params;
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  const existing = await findExistingDesire(userId, pairingId, libraryItemId);
  let encryptedNote: string | null | undefined;
  if (note !== undefined) {
    await requireUnlockedForNoteWrite(userId);
    const trimmed = note?.trim() ?? '';
    encryptedNote = trimmed ? await encryptText(trimmed, userId) : null;
  }

  if (existing) {
    const updatePayload: Database['public']['Tables']['desires']['Update'] = {
      rating,
      ...(encryptedNote !== undefined ? { note: encryptedNote } : {}),
    };
    const { data, error } = await supabase
      .from('desires')
      .update(updatePayload)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return readableNote(data, data.note ? await decryptText(data.note, userId) : null);
  }

  const { data, error } = await supabase
    .from('desires')
    .insert({
      user_id: userId,
      pairing_id: pairingId,
      library_item_id: libraryItemId,
      rating,
      note: encryptedNote ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }
  return readableNote(data, data.note ? await decryptText(data.note, userId) : null);
}

// The note/rating rule lives in lib/desire-note-rules.ts so it can be tested
// without the Supabase client. Re-exported for callers that catch it.
export { RatingRequiredError } from './desire-note-rules';

export interface UpsertDesireNoteParams {
  userId: string;
  pairingId: string | null;
  libraryItemId: string;
  note: string;
  /**
   * The user's own rating, or null if they have not given one. Null is
   * refused rather than defaulted — see {@link RatingRequiredError}.
   */
  rating: number | null;
}

export async function upsertDesireNote(
  params: UpsertDesireNoteParams,
): Promise<DesireWithNote | null> {
  const { userId, pairingId, libraryItemId, note, rating } = params;
  await requireUnlockedForNoteWrite(userId);
  const trimmed = note.trim();
  const encryptedNote = trimmed ? await encryptText(trimmed, userId) : null;

  const existing = await findExistingDesire(userId, pairingId, libraryItemId);

  if (existing) {
    const { data, error } = await supabase
      .from('desires')
      .update({ note: encryptedNote })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return readableNote(data, trimmed || null);
  }

  if (!trimmed) {
    return null;
  }

  // No row yet, so storing this note means creating one — and that needs a
  // rating the user has actually given. Throws rather than guessing.
  const ratingToStore = ratingForNewNote(rating);

  const { data, error } = await supabase
    .from('desires')
    .insert({
      user_id: userId,
      pairing_id: pairingId,
      library_item_id: libraryItemId,
      rating: ratingToStore,
      note: encryptedNote,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }
  return readableNote(data, trimmed);
}
