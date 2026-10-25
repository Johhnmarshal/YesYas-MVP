import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  isReadinessWindowClosed,
  isRevealContentExpired,
} from '@/lib/reveal-state';
import { PairingManageModal } from '@/components/PairingManageModal';
import type { DesireTier } from '@/lib/database.types';
import {
  TIER_ORDER,
  fetchLibraryItems,
  fetchUserDesires,
} from '@/lib/desires';
import {
  type PairingWithPartner,
  getActiveOrPendingPairing,
} from '@/lib/pairing';
import { type RevealRow, fetchCurrentReveal } from '@/lib/reveal';
import { supabase } from '@/lib/supabase';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

function deriveDisplayName(
  profileDisplayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const trimmed = profileDisplayName?.trim();
  if (trimmed) return trimmed;
  if (email && email.includes('@')) {
    return email.split('@')[0];
  }
  return 'there';
}

function formatRelativeRevealTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'No reveals yet';
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return 'Recently';
  const diffHours = Math.max(0, Math.floor((Date.now() - ts) / 3600000));
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const days = Math.floor(diffHours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * Home ("Today") Dashboard screen (`/(app)/home`).
 * Displays:
 * - Welcome greeting + Privacy Shield badge
 * - Active/Paused/Pending Pairing Card (with `<PairingManageModal />`) or Solo Mode Card (`"Create Invite Code"` & `"Enter Partner Code"`)
 * - Progress Summary Card (Desires Rated count + Mutual Matches count)
 * - Quick Action Cards (`"Explore Desire Library"`, `"Double-Blind Reveal"`, `"Private Journal Reflection"`)
 */
export default function HomeScreen() {
  const colors = useThemeColors();

  const [userId, setUserId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('there');
  const [tierCeiling, setTierCeiling] = useState<DesireTier>('suggestive');

  const [pairing, setPairing] = useState<PairingWithPartner | null>(null);
  const [reveal, setReveal] = useState<RevealRow | null>(null);
  const [allowedItemsCount, setAllowedItemsCount] = useState<number>(0);
  const [ratedInTierCount, setRatedInTierCount] = useState<number>(0);
  const [totalRatedCount, setTotalRatedCount] = useState<number>(0);

  // The two reveal windows are time-based, so the summary line has to re-derive
  // without waiting for a refetch. 15s matches the reveal screen's cadence;
  // both deadlines are measured in hours, so the interval only needs to be
  // small relative to a user noticing.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manageModalVisible, setManageModalVisible] = useState<boolean>(false);

  const loadDashboard = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        throw new Error('Please sign in to view your Today dashboard.');
      }

      setUserId(user.id);

      const [profileRes, pairingRes, allLibraryItems] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, content_tier_preference')
          .eq('id', user.id)
          .maybeSingle(),
        getActiveOrPendingPairing(user.id),
        fetchLibraryItems(),
      ]);

      if (profileRes.error) {
        throw profileRes.error;
      }

      const resolvedName = deriveDisplayName(
        profileRes.data?.display_name,
        user.email,
      );
      const userTier: DesireTier =
        profileRes.data?.content_tier_preference ?? 'suggestive';

      setDisplayName(resolvedName);
      setTierCeiling(userTier);
      setPairing(pairingRes);

      const activeOrPausedPairingId =
        pairingRes &&
        (pairingRes.status === 'active' || pairingRes.status === 'paused')
          ? pairingRes.id
          : null;

      const [soloDesires, pairedDesires, currentReveal] = await Promise.all([
        fetchUserDesires(user.id, null),
        activeOrPausedPairingId
          ? fetchUserDesires(user.id, activeOrPausedPairingId)
          : Promise.resolve([]),
        activeOrPausedPairingId
          ? fetchCurrentReveal(activeOrPausedPairingId)
          : Promise.resolve(null),
      ]);

      const ratedItemMap = new Map<string, number>();
      for (const row of soloDesires) {
        ratedItemMap.set(row.library_item_id, row.rating);
      }
      for (const row of pairedDesires) {
        ratedItemMap.set(row.library_item_id, row.rating);
      }

      const maxRank = TIER_ORDER[userTier];
      const allowedItems = allLibraryItems.filter(
        (item) => TIER_ORDER[item.tier] <= maxRank,
      );
      const ratedAllowed = allowedItems.filter((item) =>
        ratedItemMap.has(item.id),
      );

      setAllowedItemsCount(allowedItems.length);
      setRatedInTierCount(ratedAllowed.length);
      setTotalRatedCount(ratedItemMap.size);
      setReveal(currentReveal);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not load your Today dashboard.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard(allowedItemsCount === 0);
    }, [allowedItemsCount, loadDashboard]),
  );

  const unratedInTierCount = Math.max(0, allowedItemsCount - ratedInTierCount);
  const partnerName = pairing?.partner_display_name?.trim() || 'your partner';

  const mutualMatchesCount = useMemo(() => {
    if (!reveal) return 0;
    if (reveal.status === 'computed' && Array.isArray(reveal.matches)) {
      return reveal.matches.length;
    }
    if (typeof reveal.summary?.match_count === 'number') {
      return reveal.summary.match_count;
    }
    return 0;
  }, [reveal]);

  const revealStatusSummary = useMemo(() => {
    if (!pairing || pairing.status === 'pending') {
      return 'Pair with a partner to unlock double-blind reveals';
    }
    if (pairing.status === 'paused') {
      return 'Pairing paused — resume anytime to start a reveal';
    }
    if (!reveal) {
      return 'No active reveal · Ready whenever you both are';
    }

    const lastRevealLine = () =>
      `Last reveal (${formatRelativeRevealTime(
        reveal.revealed_at ?? reveal.triggered_at,
      )}): ${reveal.summary?.match_count ?? 0} matches`;

    // Both windows are decided here as well as on the reveal screen, which is
    // why they live in lib/reveal-state.ts. Without them this line claimed an
    // active reveal for up to 15 minutes after the items had gone, and claimed
    // a partner was still being waited on days after the 72-hour window shut.
    if (isReadinessWindowClosed(reveal, nowMs)) {
      return 'No active reveal · Ready whenever you both are';
    }
    if (isRevealContentExpired(reveal, nowMs)) {
      return lastRevealLine();
    }

    if (reveal.status === 'pending') {
      if (reveal.triggered_by && reveal.triggered_by !== userId) {
        return `✨ ${partnerName} is ready and waiting for you!`;
      }
      return `⏳ Waiting for ${partnerName} to tap ready`;
    }
    if (reveal.status === 'both_ready') {
      return '✨ Both ready — tap to see your mutual matches!';
    }
    if (reveal.status === 'computed') {
      const count = Array.isArray(reveal.matches) ? reveal.matches.length : 0;
      return `✨ Active reveal: ${count} mutual ${
        count === 1 ? 'match' : 'matches'
      }`;
    }
    return lastRevealLine();
  }, [nowMs, pairing, partnerName, reveal, userId]);

  const isPairedActiveOrPaused =
    pairing?.status === 'active' || pairing?.status === 'paused';
  const isPendingInvite = pairing?.status === 'pending';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Greeting + Privacy Shield Badge */}
        <View style={styles.headerSection}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.privacyShieldBadge,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="shield-checkmark"
                size={14}
                color={colors.accentCool}
              />
              <Text
                style={[
                  styles.privacyShieldText,
                  { color: colors.accentCool },
                ]}
              >
                🔒 Private & Encrypted
              </Text>
            </View>

            <View
              style={[
                styles.tierPill,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.tierPillText, { color: colors.secondary }]}>
                Up to {tierCeiling}
              </Text>
            </View>
          </View>

          <Text style={[styles.greetingTitle, { color: colors.primary }]}>
            Welcome back, {displayName}
          </Text>
          <Text style={[styles.greetingSubtitle, { color: colors.secondary }]}>
            Nothing is ever shared without mutual consent.
          </Text>
        </View>

        {/* Loading State */}
        {loading ? (
          <View
            style={[
              styles.card,
              styles.loadingCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.secondary }]}>
              Loading your Today dashboard…
            </Text>
          </View>
        ) : null}

        {/* Error State */}
        {!loading && errorMessage ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
              },
            ]}
          >
            <Text style={[styles.errorTitle, { color: colors.error }]}>
              Unable to load dashboard
            </Text>
            <Text
              style={[styles.errorDescription, { color: colors.secondary }]}
            >
              {errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading Today dashboard"
              onPress={() => void loadDashboard(true)}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !errorMessage ? (
          <>
            {/* 1. Pairing Status Card (Active/Paused, Pending, or Solo Mode) */}
            {isPairedActiveOrPaused && pairing ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor:
                      pairing.status === 'active'
                        ? colors.accentCool
                        : colors.accentWarm,
                  },
                ]}
              >
                <View style={styles.pairingHeaderRow}>
                  <Text
                    style={[styles.pairingTitle, { color: colors.primary }]}
                  >
                    💑 Paired with {partnerName}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        borderColor:
                          pairing.status === 'active'
                            ? colors.success
                            : colors.accentWarm,
                        backgroundColor: colors.bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            pairing.status === 'active'
                              ? colors.success
                              : colors.accentWarm,
                        },
                      ]}
                    >
                      {pairing.status === 'active' ? 'Active' : 'Paused'}
                    </Text>
                  </View>
                </View>

                <Text
                  style={[styles.pairingMetaText, { color: colors.secondary }]}
                >
                  {revealStatusSummary}
                </Text>

                <View style={styles.cardActionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      reveal?.status === 'computed'
                        ? 'View active reveal matches'
                        : 'Start new reveal'
                    }
                    onPress={() => router.push('/(app)/reveal' as Href)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: colors.primary,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {reveal?.status === 'computed'
                        ? 'Open active reveal →'
                        : reveal?.status === 'pending' &&
                            reveal.triggered_by !== userId
                          ? 'Respond to reveal →'
                          : 'Start new reveal →'}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View pairing details and pause or end options"
                    onPress={() => setManageModalVisible(true)}
                    style={({ pressed }) => [
                      styles.managePairingButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.bg,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="options-outline"
                      size={16}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.managePairingText,
                        { color: colors.primary },
                      ]}
                    >
                      View pairing details
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : isPendingInvite && pairing ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.accentWarm,
                  },
                ]}
              >
                <View style={styles.pairingHeaderRow}>
                  <Text
                    style={[styles.pairingTitle, { color: colors.primary }]}
                  >
                    ⏳ Partner Invite Pending
                  </Text>
                  {pairing.invite_code ? (
                    <View
                      style={[
                        styles.codeBadge,
                        {
                          backgroundColor: colors.bg,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.codeBadgeText,
                          { color: colors.primary },
                        ]}
                      >
                        {pairing.invite_code}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text
                  style={[styles.pairingMetaText, { color: colors.secondary }]}
                >
                  Share your 8-character code with your partner, or enter their
                  code if they already sent you one.
                </Text>

                <View style={styles.dualButtonsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View or share invite code"
                    onPress={() => router.push('/(app)/pairing/invite' as Href)}
                    style={({ pressed }) => [
                      styles.dualPrimaryButton,
                      {
                        backgroundColor: colors.primary,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>Share Code →</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Enter Partner Code"
                    onPress={() => router.push('/(app)/pairing/accept' as Href)}
                    style={({ pressed }) => [
                      styles.dualSecondaryButton,
                      {
                        borderColor: colors.primary,
                        backgroundColor: colors.bg,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dualSecondaryText,
                        { color: colors.primary },
                      ]}
                    >
                      Enter Partner Code
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage or cancel pending invite"
                  onPress={() => setManageModalVisible(true)}
                  style={styles.inlineLinkButton}
                >
                  <Text
                    style={[
                      styles.inlineLinkText,
                      { color: colors.secondary },
                    ]}
                  >
                    Manage / Cancel pending invite
                  </Text>
                </Pressable>
              </View>
            ) : (
              /* Solo Mode Card */
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.pairingHeaderRow}>
                  <Text
                    style={[styles.pairingTitle, { color: colors.primary }]}
                  >
                    🔒 Solo Mode
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        borderColor: colors.accentCool,
                        backgroundColor: colors.bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        { color: colors.accentCool },
                      ]}
                    >
                      Exploring Privately
                    </Text>
                  </View>
                </View>

                <Text
                  style={[styles.pairingMetaText, { color: colors.secondary }]}
                >
                  Rate desires and reflect in your encrypted journal at your own
                  pace. When you’re ready to pair, your solo ratings carry over
                  automatically.
                </Text>

                <View style={styles.dualButtonsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create Invite Code"
                    onPress={() => router.push('/(app)/pairing/invite' as Href)}
                    style={({ pressed }) => [
                      styles.dualPrimaryButton,
                      {
                        backgroundColor: colors.primary,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      Create Invite Code
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Enter Partner Code"
                    onPress={() => router.push('/(app)/pairing/accept' as Href)}
                    style={({ pressed }) => [
                      styles.dualSecondaryButton,
                      {
                        borderColor: colors.primary,
                        backgroundColor: colors.bg,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dualSecondaryText,
                        { color: colors.primary },
                      ]}
                    >
                      Enter Partner Code
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* 2. Progress Summary Card */}
            <View
              style={[
                styles.progressSummaryCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.metricColumn}>
                <Text style={[styles.metricValue, { color: colors.primary }]}>
                  {ratedInTierCount}
                  <Text style={[styles.metricTotal, { color: colors.muted }]}>
                    /{allowedItemsCount}
                  </Text>
                </Text>
                <Text
                  style={[styles.metricLabel, { color: colors.secondary }]}
                >
                  Desires Rated
                </Text>
                {totalRatedCount > ratedInTierCount ? (
                  <Text style={[styles.metricSubHint, { color: colors.muted }]}>
                    ({totalRatedCount} total across all tiers)
                  </Text>
                ) : null}
              </View>

              <View
                style={[
                  styles.metricDivider,
                  { backgroundColor: colors.border },
                ]}
              />

              <View style={styles.metricColumn}>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color:
                        mutualMatchesCount > 0
                          ? colors.accentWarm
                          : colors.primary,
                    },
                  ]}
                >
                  {isPairedActiveOrPaused ? String(mutualMatchesCount) : '—'}
                </Text>
                <Text
                  style={[styles.metricLabel, { color: colors.secondary }]}
                >
                  Mutual Matches
                </Text>
              </View>
            </View>

            {/* 3. Quick Action Cards */}
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>
              Quick Actions
            </Text>

            <View style={styles.quickActionsColumn}>
              {/* Explore Desire Library */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Explore Desire Library. ${unratedInTierCount} unrated items. Rate now`}
                onPress={() => router.push('/(app)/library' as Href)}
                style={({ pressed }) => [
                  styles.actionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.actionCardHeader}>
                  <Text
                    style={[styles.actionCardTitle, { color: colors.primary }]}
                  >
                    📚 Explore Desire Library
                  </Text>
                  <Text
                    style={[styles.actionCardCta, { color: colors.accentWarm }]}
                  >
                    Rate now →
                  </Text>
                </View>
                <Text
                  style={[
                    styles.actionCardSubtitle,
                    { color: colors.secondary },
                  ]}
                >
                  {unratedInTierCount === 0 && allowedItemsCount > 0
                    ? `All ${allowedItemsCount} items in your ${tierCeiling} tier rated · Review or add notes`
                    : `${unratedInTierCount} unrated ${
                        unratedInTierCount === 1 ? 'item' : 'items'
                      } in your ${tierCeiling} tier · 🔒 Only you see your ratings`}
                </Text>
              </Pressable>

              {/* Double-Blind Reveal */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Double-Blind Reveal. Open Reveal flow"
                onPress={() => router.push('/(app)/reveal' as Href)}
                style={({ pressed }) => [
                  styles.actionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor:
                      reveal?.status === 'computed' ||
                      (reveal?.status === 'pending' &&
                        reveal.triggered_by !== userId)
                        ? colors.accentWarm
                        : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.actionCardHeader}>
                  <Text
                    style={[styles.actionCardTitle, { color: colors.primary }]}
                  >
                    ✨ Double-Blind Reveal
                  </Text>
                  <Text
                    style={[styles.actionCardCta, { color: colors.accentWarm }]}
                  >
                    Open →
                  </Text>
                </View>
                <Text
                  style={[
                    styles.actionCardSubtitle,
                    { color: colors.secondary },
                  ]}
                >
                  {revealStatusSummary}
                </Text>
              </Pressable>

              {/* Private Journal Reflection */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Private Journal Reflection. Write today"
                onPress={() => router.push('/(app)/journal' as Href)}
                style={({ pressed }) => [
                  styles.actionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.actionCardHeader}>
                  <Text
                    style={[styles.actionCardTitle, { color: colors.primary }]}
                  >
                    ✍️ Private Journal Reflection
                  </Text>
                  <Text
                    style={[styles.actionCardCta, { color: colors.accentCool }]}
                  >
                    Write today →
                  </Text>
                </View>
                <Text
                  style={[
                    styles.actionCardSubtitle,
                    { color: colors.secondary },
                  ]}
                >
                  🔒 Your private space — reflect solo or chat with the AI
                  Intimacy Coach
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Pairing Manage Bottom-Sheet Modal */}
      <PairingManageModal
        visible={manageModalVisible}
        pairing={pairing}
        onClose={() => setManageModalVisible(false)}
        onUpdated={() => {
          void loadDashboard(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  headerSection: {
    marginBottom: SPACING.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  privacyShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  privacyShieldText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tierPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  tierPillText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  greetingTitle: {
    ...TYPOGRAPHY.h1,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  greetingSubtitle: {
    ...TYPOGRAPHY.body,
  },
  card: {
    borderRadius: RADII.xl,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.elevated,
  },
  loadingCard: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
  },
  errorTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 4,
  },
  errorDescription: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  pairingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
    marginBottom: 6,
  },
  pairingTitle: {
    ...TYPOGRAPHY.h2,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  codeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    borderWidth: 1,
  },
  codeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  pairingMetaText: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  cardActionsRow: {
    gap: SPACING.xs,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  managePairingButton: {
    minHeight: 44,
    borderRadius: RADII.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
  },
  managePairingText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  dualButtonsRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  dualPrimaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  dualSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  dualSecondaryText: {
    ...TYPOGRAPHY.button,
    fontSize: 14,
  },
  inlineLinkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  inlineLinkText: {
    ...TYPOGRAPHY.caption,
    textDecorationLine: 'underline',
  },
  progressSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADII.lg,
    borderWidth: 1,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.subtle,
  },
  metricColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    ...TYPOGRAPHY.h1,
  },
  metricTotal: {
    ...TYPOGRAPHY.h2,
  },
  metricLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  metricSubHint: {
    fontSize: 11,
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 44,
    marginHorizontal: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h2,
    letterSpacing: -0.3,
    marginBottom: SPACING.xs,
  },
  quickActionsColumn: {
    gap: SPACING.sm,
  },
  actionCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.sm + 2,
    minHeight: 84,
    justifyContent: 'center',
    ...SHADOWS.subtle,
  },
  actionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
    marginBottom: 4,
  },
  actionCardTitle: {
    ...TYPOGRAPHY.h3,
    flex: 1,
  },
  actionCardCta: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  actionCardSubtitle: {
    ...TYPOGRAPHY.caption,
    lineHeight: 19,
  },
});
