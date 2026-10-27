import type { Database, DesireTier, ToneLabel } from './database.types';

type LibraryItemRow = Database['public']['Tables']['desire_library_items']['Row'];

/** The fields visibility actually depends on. */
export type FilterableLibraryItem = Pick<
  LibraryItemRow,
  'tier' | 'tone_tags' | 'title' | 'description'
>;

/**
 * Tier ranking and library visibility rules.
 *
 * This lives apart from `lib/desires.ts` on purpose: that module imports the
 * Supabase client, which cannot be constructed under plain
 * `node --experimental-strip-types`, so anything it touches is unreachable from
 * `scripts/verify-domain-logic.ts`. The content tier ceiling is a consent
 * boundary in this product, so it belongs in a module a test can actually
 * import.
 */
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

/**
 * Whether an item's tier is at or below the user's ceiling.
 *
 * The ceiling is enforced in two places — the library list and the item detail
 * screen, which fetches by id and so can be reached directly — and both were
 * wrong at different times for the same reason: the check was written inline
 * and then not written again. One function, one test.
 */
export function isTierWithinCeiling(
  tier: DesireTier,
  ceiling: DesireTier,
): boolean {
  return TIER_ORDER[tier] <= TIER_ORDER[ceiling];
}

export type TierFilterValue = 'up_to_ceiling' | DesireTier;
export type ToneFilterValue = 'all' | ToneLabel;
export type StatusFilterValue = 'all' | 'unrated' | 'rated';

export interface LibraryFilterState {
  /** The user's `content_tier_preference`. Never exceeded, whatever else is set. */
  tierCeiling: DesireTier;
  tierFilter: TierFilterValue;
  toneFilter: ToneFilterValue;
  statusFilter?: StatusFilterValue;
  /** Raw search box text; trimmed and lowercased here. */
  searchQuery: string;
}

/**
 * Whether one item should be listed under the given filter state.
 *
 * The ceiling is checked first and unconditionally. An earlier version applied
 * it only when `tierFilter` was `'up_to_ceiling'`, trusting the tap handler to
 * never select a locked tier. That held until the ceiling could move
 * underneath a selection: pick the Explicit filter, lower the content tier to
 * Sensory in Settings, and come back. The Library screen stays mounted across
 * tab switches and refreshes the ceiling on focus without touching
 * `tierFilter`, so all 60 explicit items kept rendering — beneath a filter pill
 * that had just grown a padlock. A consent boundary should not depend on the
 * order the user happens to tap things in.
 */
export function isLibraryItemVisible(
  item: FilterableLibraryItem,
  state: LibraryFilterState,
  rating?: number | null,
): boolean {
  if (!isTierWithinCeiling(item.tier, state.tierCeiling)) {
    return false;
  }

  if (state.tierFilter !== 'up_to_ceiling' && item.tier !== state.tierFilter) {
    return false;
  }

  if (state.toneFilter !== 'all' && !item.tone_tags.includes(state.toneFilter)) {
    return false;
  }

  if (state.statusFilter && state.statusFilter !== 'all') {
    const isRated = rating !== null && rating !== undefined;
    if (state.statusFilter === 'unrated' && isRated) {
      return false;
    }
    if (state.statusFilter === 'rated' && !isRated) {
      return false;
    }
  }

  const search = state.searchQuery.trim().toLowerCase();
  if (search) {
    const inTitle = item.title.toLowerCase().includes(search);
    const inDesc = (item.description ?? '').toLowerCase().includes(search);
    if (!inTitle && !inDesc) {
      return false;
    }
  }

  return true;
}

export function filterLibraryItems<T extends FilterableLibraryItem>(
  items: T[],
  state: LibraryFilterState,
  getRatingForItem?: (item: T) => number | null | undefined,
): T[] {
  return items.filter((item) =>
    isLibraryItemVisible(item, state, getRatingForItem ? getRatingForItem(item) : undefined),
  );
}

/**
 * The tier filter to use once the ceiling is known, dropping a selection the
 * ceiling no longer permits. Call this wherever the ceiling is (re)loaded.
 */
export function reconcileTierFilter(
  current: TierFilterValue,
  tierCeiling: DesireTier,
): TierFilterValue {
  if (current === 'up_to_ceiling') return current;
  return TIER_ORDER[current] > TIER_ORDER[tierCeiling] ? 'up_to_ceiling' : current;
}
