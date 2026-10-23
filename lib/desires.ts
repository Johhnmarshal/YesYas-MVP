import { decryptText, encryptText } from './crypto';
import type { Database, DesireTier } from './database.types';
import { supabase } from './supabase';

export type DesireLibraryItem = Database['public']['Tables']['desire_library_items']['Row'];
export type DesireRow = Database['public']['Tables']['desires']['Row'];

export const TIER_ORDER: Record<DesireTier, number> = {
  sensory: 1,
  suggestive: 2,
  explicit: 3,
};

export function getAllowedTiers(maxTier: DesireTier): DesireTier[] {
  const maxRank = TIER_ORDER[maxTier];
  return (['sensory', 'suggestive', 'explicit'] as DesireTier[]).filter(
    (t) => TIER_ORDER[t] <= maxRank,
  );
}

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
): Promise<DesireRow[]> {
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
        return row;
      }
      try {
        const decryptedNote = await decryptText(row.note, userId);
        return { ...row, note: decryptedNote };
      } catch {
        return { ...row, note: '' };
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

export async function upsertDesireRating(params: UpsertDesireRatingParams): Promise<DesireRow> {
  const { userId, pairingId, libraryItemId, rating, note } = params;
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  const existing = await findExistingDesire(userId, pairingId, libraryItemId);
  let encryptedNote: string | null | undefined;
  if (note !== undefined) {
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
    const decryptedNote = data.note ? await decryptText(data.note, userId) : null;
    return { ...data, note: decryptedNote };
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
  const decryptedNote = data.note ? await decryptText(data.note, userId) : null;
  return { ...data, note: decryptedNote };
}

export interface UpsertDesireNoteParams {
  userId: string;
  pairingId: string | null;
  libraryItemId: string;
  note: string;
  defaultRating?: number;
}

export async function upsertDesireNote(
  params: UpsertDesireNoteParams,
): Promise<DesireRow | null> {
  const { userId, pairingId, libraryItemId, note, defaultRating = 3 } = params;
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
    return { ...data, note: trimmed || null };
  }

  if (!trimmed) {
    return null;
  }

  const { data, error } = await supabase
    .from('desires')
    .insert({
      user_id: userId,
      pairing_id: pairingId,
      library_item_id: libraryItemId,
      rating: defaultRating,
      note: encryptedNote,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }
  return { ...data, note: trimmed };
}
