/**
 * "3 for tonight": a small daily set instead of a 200-item list.
 *
 * Testers said rating felt like homework. A pack is three unrated ideas,
 * picked the same way for both partners on the same day: the order is seeded
 * by the pairing and the date, so two people at the same heat limit walk the
 * same shuffled list and, until their progress differs, see the same three.
 * It never uses the partner's ratings (the client cannot see them anyway).
 *
 * Pure, with no React or Supabase import, so scripts/verify-domain-logic.ts
 * can check it.
 */

/** FNV-1a, 32 bit. Enough to turn a seed string into a stable number. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic. Not for anything secret. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local calendar day, so "tonight" changes at the person's midnight. */
export function packDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface PackItem {
  id: string;
}

/**
 * Picks up to `n` items not yet rated, in an order fixed by `seedKey` (the
 * pairing id, or the user id when solo) and the day. Items are first sorted
 * by id so the result does not depend on the order the server returned them.
 */
export function choosePack<T extends PackItem>(
  items: readonly T[],
  ratedIds: ReadonlySet<string>,
  seedKey: string,
  dateKey: string,
  n = 3,
): T[] {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rand = seededRandom(hashSeed(`${seedKey}|${dateKey}`));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return sorted.filter((it) => !ratedIds.has(it.id)).slice(0, n);
}

/** Whole percent for the shared meter; 0 when there is nothing to explore. */
export function progressPercent(together: number, total: number): number {
  if (!Number.isFinite(together) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((together / total) * 100)));
}

/** How long until another nudge may be sent (the server allows one per 6h). */
export const NUDGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function nudgeAvailableAt(lastSentIso: string | null): number {
  if (!lastSentIso) return 0;
  const t = Date.parse(lastSentIso);
  return Number.isFinite(t) ? t + NUDGE_COOLDOWN_MS : 0;
}
