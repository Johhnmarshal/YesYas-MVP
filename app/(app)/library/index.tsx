import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LibraryItemCard } from '@/components/LibraryItemCard';
import type { DesireTier } from '@/lib/database.types';
import {
  type DesireLibraryItem,
  type DesireWithNote,
  TIER_ORDER,
  fetchLibraryItems,
  fetchUserDesires,
} from '@/lib/desires';
import {
  type TierFilterValue,
  type ToneFilterValue,
  filterLibraryItems,
  reconcileTierFilter,
} from '@/lib/library-filter';
import { getActiveOrPendingPairing } from '@/lib/pairing';
import { supabase } from '@/lib/supabase';
import {
  SPACING,
  TIER_OPTIONS,
  TONE_OPTIONS,
  TYPOGRAPHY,
  useThemeColors,
} from '@/lib/theme';


const TIER_FILTER_SEGMENTS: { value: TierFilterValue; label: string }[] = [
  { value: 'up_to_ceiling', label: 'All up to my tier' },
  { value: 'sensory', label: 'Sensory' },
  { value: 'suggestive', label: 'Suggestive' },
  { value: 'explicit', label: 'Explicit' },
];

const TONE_FILTER_PILLS: { value: ToneFilterValue; label: string }[] = [
  { value: 'all', label: 'All tones' },
  ...TONE_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
];

/**
 * Desire Library screen (`/(app)/library`).
 * Displays the 180 curated intimacy items filtered by content tier, tone tags,
 * and search query, with inline star ratings and encrypted private notes.
 */
export default function DesireLibraryScreen() {
  const colors = useThemeColors();

  const [userId, setUserId] = useState<string>('');
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [tierCeiling, setTierCeiling] = useState<DesireTier>('suggestive');

  const [tierFilter, setTierFilter] =
    useState<TierFilterValue>('up_to_ceiling');
  const [toneFilter, setToneFilter] = useState<ToneFilterValue>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [allItems, setAllItems] = useState<DesireLibraryItem[]>([]);
  const [desiresByItemId, setDesiresByItemId] = useState<
    Record<string, DesireWithNote>
  >({});

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingUnlockTier, setPendingUnlockTier] =
    useState<DesireTier | null>(null);
  const [unlockingTier, setUnlockingTier] = useState<boolean>(false);

  const loadLibraryData = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const currentUser = authData.user;
      if (!currentUser) {
        throw new Error('Please sign in to view the Desire Library.');
      }

      setUserId(currentUser.id);

      const [profileRes, pairingRes, itemsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('content_tier_preference, tone_preference')
          .eq('id', currentUser.id)
          .maybeSingle(),
        getActiveOrPendingPairing(currentUser.id),
        fetchLibraryItems(),
      ]);

      if (profileRes.error) {
        throw profileRes.error;
      }

      const userTierCeiling: DesireTier =
        profileRes.data?.content_tier_preference ?? 'suggestive';
      setTierCeiling(userTierCeiling);

      // A tier filter chosen while the ceiling was higher must not outlive the
      // ceiling being lowered in Settings. This screen stays mounted across tab
      // switches and this function re-runs on every focus, so without this
      // tierFilter would still name a tier the user has just opted out of.
      setTierFilter((prev) => reconcileTierFilter(prev, userTierCeiling));

      const activePairingId =
        pairingRes &&
        (pairingRes.status === 'active' || pairingRes.status === 'paused')
          ? pairingRes.id
          : null;

      setPairingId(activePairingId);
      setPartnerName(
        activePairingId ? pairingRes?.partner_display_name ?? 'Partner' : null,
      );

      // Load solo desires and (if paired) active pairing desires
      const [soloDesires, pairedDesires] = await Promise.all([
        fetchUserDesires(currentUser.id, null),
        activePairingId
          ? fetchUserDesires(currentUser.id, activePairingId)
          : Promise.resolve([]),
      ]);

      const mergedMap: Record<string, DesireWithNote> = {};
      for (const row of soloDesires) {
        mergedMap[row.library_item_id] = row;
      }
      for (const row of pairedDesires) {
        mergedMap[row.library_item_id] = row;
      }

      setAllItems(itemsRes);
      setDesiresByItemId(mergedMap);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to load the Desire Library.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadLibraryData(allItems.length === 0);
    }, [allItems.length, loadLibraryData]),
  );

  const handleDesireUpdated = useCallback((updated: DesireWithNote) => {
    setDesiresByItemId((prev) => ({
      ...prev,
      [updated.library_item_id]: updated,
    }));
  }, []);

  const handleSelectTierFilter = useCallback(
    (selected: TierFilterValue) => {
      if (
        selected !== 'up_to_ceiling' &&
        TIER_ORDER[selected] > TIER_ORDER[tierCeiling]
      ) {
        setPendingUnlockTier(selected);
        return;
      }
      setTierFilter(selected);
    },
    [tierCeiling],
  );

  const handleConfirmUnlockTier = useCallback(async () => {
    if (!pendingUnlockTier || !userId) return;
    setUnlockingTier(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ content_tier_preference: pendingUnlockTier })
        .eq('id', userId);

      if (error) throw error;

      setTierCeiling(pendingUnlockTier);
      setTierFilter(pendingUnlockTier);
      setPendingUnlockTier(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to update content tier preference.',
      );
    } finally {
      setUnlockingTier(false);
    }
  }, [pendingUnlockTier, userId]);

  const ceilingAllowedItems = useMemo(() => {
    const maxRank = TIER_ORDER[tierCeiling];
    return allItems.filter((item) => TIER_ORDER[item.tier] <= maxRank);
  }, [allItems, tierCeiling]);

  const ratedCountInCeiling = useMemo(() => {
    return ceilingAllowedItems.filter(
      (item) => desiresByItemId[item.id]?.rating !== undefined,
    ).length;
  }, [ceilingAllowedItems, desiresByItemId]);

  const filteredItems = useMemo(
    () =>
      filterLibraryItems(allItems, {
        tierCeiling,
        tierFilter,
        toneFilter,
        searchQuery,
      }),
    [allItems, searchQuery, tierCeiling, tierFilter, toneFilter],
  );

  const handleResetFilters = useCallback(() => {
    setTierFilter('up_to_ceiling');
    setToneFilter('all');
    setSearchQuery('');
  }, []);

  const nextUnlockableTier: DesireTier | null =
    tierCeiling === 'sensory'
      ? 'suggestive'
      : tierCeiling === 'suggestive'
        ? 'explicit'
        : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <FlatList
        data={loading || errorMessage ? [] : filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            <Text style={[styles.screenTitle, { color: colors.primary }]}>
              Desire Library
            </Text>

            <View style={styles.metaRow}>
              <Text style={[styles.counterText, { color: colors.secondary }]}>
                Rated {ratedCountInCeiling} of {ceilingAllowedItems.length}{' '}
                items in your tier
              </Text>
              <View
                style={[
                  styles.modeBadge,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.modeBadgeText, { color: colors.accentCool }]}
                >
                  {pairingId
                    ? `💑 Paired (${partnerName ?? 'Partner'})`
                    : '🔒 Solo mode'}
                </Text>
              </View>
            </View>

            {/* Search bar */}
            <View
              style={[
                styles.searchContainer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search desires by title or description…"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Search desire library items"
                style={[styles.searchInput, { color: colors.primary }]}
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search query"
                  onPress={() => setSearchQuery('')}
                  style={styles.clearSearchButton}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              ) : null}
            </View>

            {/* Segmented Tier Filter */}
            <View style={styles.filterSection}>
              <View style={styles.filterHeaderRow}>
                <Text style={[styles.filterLabel, { color: colors.secondary }]}>
                  Content tier (up to {tierCeiling})
                </Text>
                {nextUnlockableTier ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unlock ${nextUnlockableTier} tier`}
                    onPress={() => setPendingUnlockTier(nextUnlockableTier)}
                    style={styles.unlockLinkButton}
                  >
                    <Text
                      style={[
                        styles.unlockLinkText,
                        { color: colors.accentWarm },
                      ]}
                    >
                      Unlock {nextUnlockableTier} →
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillsScrollContent}
              >
                {TIER_FILTER_SEGMENTS.map((segment) => {
                  const isSelected = tierFilter === segment.value;
                  const isLocked =
                    segment.value !== 'up_to_ceiling' &&
                    TIER_ORDER[segment.value] > TIER_ORDER[tierCeiling];

                  return (
                    <Pressable
                      key={segment.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Filter by ${segment.label}${
                        isLocked ? ' (locked, tap to unlock)' : ''
                      }`}
                      onPress={() => handleSelectTierFilter(segment.value)}
                      style={({ pressed }) => [
                        styles.filterPill,
                        {
                          backgroundColor: isSelected
                            ? colors.primary
                            : colors.surface,
                          borderColor: isSelected
                            ? colors.primary
                            : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterPillText,
                          {
                            color: isSelected
                              ? '#FFFFFF'
                              : isLocked
                                ? colors.muted
                                : colors.primary,
                          },
                        ]}
                      >
                        {isLocked ? `🔒 ${segment.label}` : segment.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Tone Filter Pills */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterLabel, { color: colors.secondary }]}>
                Tone
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillsScrollContent}
              >
                {TONE_FILTER_PILLS.map((pill) => {
                  const isSelected = toneFilter === pill.value;
                  return (
                    <Pressable
                      key={pill.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Filter by ${pill.label}`}
                      onPress={() => setToneFilter(pill.value)}
                      style={({ pressed }) => [
                        styles.filterPill,
                        {
                          backgroundColor: isSelected
                            ? colors.accentWarm
                            : colors.surface,
                          borderColor: isSelected
                            ? colors.accentWarm
                            : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterPillText,
                          { color: isSelected ? '#FFFFFF' : colors.primary },
                        ]}
                      >
                        {pill.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Loading Skeleton Cards */}
            {loading ? (
              <View
                style={styles.skeletonList}
                accessibilityLabel="Loading desire library items"
              >
                {[1, 2, 3].map((idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.skeletonCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.skeletonBadge,
                        { backgroundColor: colors.border },
                      ]}
                    />
                    <View
                      style={[
                        styles.skeletonTitle,
                        { backgroundColor: colors.border },
                      ]}
                    />
                    <View
                      style={[
                        styles.skeletonStars,
                        { backgroundColor: colors.border },
                      ]}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {/* Error State Card */}
            {!loading && errorMessage ? (
              <View
                style={[
                  styles.stateCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.error,
                  },
                ]}
              >
                <Text style={[styles.errorTitle, { color: colors.error }]}>
                  Could not load Desire Library
                </Text>
                <Text
                  style={[styles.stateDescription, { color: colors.secondary }]}
                >
                  {errorMessage}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading Desire Library"
                  onPress={() => void loadLibraryData(true)}
                  style={({ pressed }) => [
                    styles.retryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={styles.retryButtonText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Empty State Card */}
            {!loading && !errorMessage && filteredItems.length === 0 ? (
              <View
                style={[
                  styles.stateCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.emptyTitle, { color: colors.primary }]}>
                  No desires match your filters
                </Text>
                <Text
                  style={[styles.stateDescription, { color: colors.secondary }]}
                >
                  Try clearing your search or switching to another tone or tier.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset library filters"
                  onPress={handleResetFilters}
                  style={({ pressed }) => [
                    styles.retryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={styles.retryButtonText}>Reset filters</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <LibraryItemCard
            item={item}
            userId={userId}
            pairingId={pairingId}
            desire={desiresByItemId[item.id]}
            onDesireUpdated={handleDesireUpdated}
          />
        )}
      />

      {/* Unlock Higher Tier Confirmation Modal */}
      <Modal
        visible={pendingUnlockTier !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingUnlockTier(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.primary }]}>
              Unlock {pendingUnlockTier} content?
            </Text>
            <Text style={[styles.modalBody, { color: colors.secondary }]}>
              {TIER_OPTIONS.find((t) => t.value === pendingUnlockTier)
                ?.description ??
                'You can adjust your preferred content tier at any time in Settings.'}
            </Text>
            <Text style={[styles.modalHint, { color: colors.muted }]}>
              🔒 Changing your tier only affects what you see in your own
              library. Your partner is never notified.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Confirm unlocking ${pendingUnlockTier} tier`}
              disabled={unlockingTier}
              onPress={() => void handleConfirmUnlockTier()}
              style={({ pressed }) => [
                styles.modalPrimaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed || unlockingTier ? 0.75 : 1,
                },
              ]}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {unlockingTier
                  ? 'Updating…'
                  : `Unlock ${pendingUnlockTier ?? ''} tier`}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel unlocking tier"
              disabled={unlockingTier}
              onPress={() => setPendingUnlockTier(null)}
              style={styles.modalSecondaryButton}
            >
              <Text
                style={[
                  styles.modalSecondaryButtonText,
                  { color: colors.secondary },
                ]}
              >
                Keep current tier ({tierCeiling})
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  headerContainer: {
    marginBottom: SPACING.sm,
  },
  screenTitle: {
    ...TYPOGRAPHY.h1,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  counterText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    minHeight: 48,
    marginBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  searchInput: {
    flex: 1,
    ...TYPOGRAPHY.body,
    paddingVertical: 8,
  },
  clearSearchButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSection: {
    marginBottom: SPACING.sm,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  filterLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    marginBottom: 4,
  },
  unlockLinkButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unlockLinkText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  pillsScrollContent: {
    gap: SPACING.xs,
    paddingVertical: 2,
  },
  filterPill: {
    minHeight: 44,
    paddingHorizontal: SPACING.sm,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  skeletonList: {
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  skeletonCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  skeletonBadge: {
    width: 80,
    height: 18,
    borderRadius: 4,
  },
  skeletonTitle: {
    width: '75%',
    height: 22,
    borderRadius: 6,
  },
  skeletonStars: {
    width: 180,
    height: 28,
    borderRadius: 6,
  },
  stateCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  errorTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  stateDescription: {
    ...TYPOGRAPHY.body,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 140,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: SPACING.md,
  },
  modalTitle: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.xs,
    textTransform: 'capitalize',
  },
  modalBody: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  modalHint: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.md,
  },
  modalPrimaryButton: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  modalPrimaryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  modalSecondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryButtonText: {
    ...TYPOGRAPHY.button,
  },
});
