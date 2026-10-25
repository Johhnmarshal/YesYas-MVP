import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type MismatchBridgeItem,
  MismatchBridgeModal,
} from '@/components/MismatchBridgeModal';
import type {
  RevealMatchItem,
  RevealMismatchItem,
} from '@/lib/database.types';
import { fetchUserDesires } from '@/lib/desires';
import {
  type PairingWithPartner,
  getActiveOrPendingPairing,
  updatePairingStatus,
} from '@/lib/pairing';
import {
  type RevealRow,
  fetchCurrentReveal,
  MIN_RATINGS_FOR_REVEAL,
  isCadenceError,
  isTooFewRatingsError,
  nextRevealAvailableAt,
  triggerReveal,
  withdrawReveal,
} from '@/lib/reveal';
import { supabase } from '@/lib/supabase';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import {
  SCREEN_CAPTURE_KEYS,
  useScreenCaptureProtection,
} from '@/lib/screen-capture';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function formatRemainingDuration(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return '0h 00m';
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Double-Blind Reveal state machine screen (`/(app)/reveal`).
 * Implements:
 * - `no_reveal` trigger view with rated item count & privacy reassurance
 * - `pending` (`awaiting_partner` or partner-waiting-for-you) with 72h readiness countdown and `withdrawReveal`
 * - `both_ready` transition state
 * - `computed` (`completed`) celebratory Mutual Matches (`both >= 4`) + anonymized Curiosity Bridge (`one >= 4 AND other = 3`) opening `<MismatchBridgeModal />` + 24h ephemeral countdown
 * - `expired` summary view with one-tap reset to start a fresh reveal
 * - Supabase Realtime subscription on `public.reveals` + 30s polling fallback
 * - `AppState` background privacy blur overlay
 */
export default function RevealScreen() {
  const colors = useThemeColors();
  useScreenCaptureProtection(SCREEN_CAPTURE_KEYS.reveal);

  const [userId, setUserId] = useState<string>('');
  const [pairing, setPairing] = useState<PairingWithPartner | null>(null);
  const [ratedCount, setRatedCount] = useState<number>(0);
  // Ratings in THIS pairing, which is what trigger_reveal's P0002 guard counts.
  // ratedCount above is the union with solo ratings and is only for display;
  // gating the button on that union would re-create the mismatch the guard
  // exists to catch.
  const [pairedRatedCount, setPairedRatedCount] = useState<number>(0);
  const [reveal, setReveal] = useState<RevealRow | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [startFreshMode, setStartFreshMode] = useState<boolean>(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<boolean>(false);

  const [bridgeModalVisible, setBridgeModalVisible] = useState<boolean>(false);
  const [selectedBridgeItem, setSelectedBridgeItem] =
    useState<MismatchBridgeItem | null>(null);
  const [parkedItemIds, setParkedItemIds] = useState<Record<string, boolean>>(
    {},
  );

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [privacyShieldActive, setPrivacyShieldActive] = useState<boolean>(
    () => AppState.currentState !== 'active',
  );
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Background privacy blur overlay listener (iOS app switcher / backgrounding)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      setPrivacyShieldActive(nextState !== 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Countdown clock tick every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const loadRevealScreenData = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        throw new Error('Please sign in to access Double-Blind Reveals.');
      }

      setUserId(user.id);

      const currentPairing = await getActiveOrPendingPairing(user.id);
      setPairing(currentPairing);

      if (
        !currentPairing ||
        (currentPairing.status !== 'active' &&
          currentPairing.status !== 'paused')
      ) {
        const soloDesires = await fetchUserDesires(user.id, null);
        setRatedCount(soloDesires.length);
        setPairedRatedCount(0);
        setReveal(null);
        return;
      }

      const [pairedDesires, soloDesires, currentReveal] = await Promise.all([
        fetchUserDesires(user.id, currentPairing.id),
        fetchUserDesires(user.id, null),
        fetchCurrentReveal(currentPairing.id),
      ]);

      const uniqueRatedIds = new Set<string>();
      for (const row of soloDesires) uniqueRatedIds.add(row.library_item_id);
      for (const row of pairedDesires) uniqueRatedIds.add(row.library_item_id);

      setRatedCount(uniqueRatedIds.size);
      setPairedRatedCount(pairedDesires.length);
      setReveal(currentReveal);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to load reveal status. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRevealScreenData(reveal === null);
    }, [loadRevealScreenData, reveal]),
  );

  // Supabase Realtime subscription on `public.reveals` + 30s polling fallback
  useEffect(() => {
    const activePairingId =
      pairing && (pairing.status === 'active' || pairing.status === 'paused')
        ? pairing.id
        : null;

    if (!activePairingId) return;

    const channel = supabase
      .channel(`reveal-watch-${activePairingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reveals',
          filter: `pairing_id=eq.${activePairingId}`,
        },
        () => {
          void fetchCurrentReveal(activePairingId)
            .then((latest) => {
              setReveal(latest);
              setStartFreshMode(false);
            })
            .catch(() => {
              // Handled by 30s polling fallback
            });
        },
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      void fetchCurrentReveal(activePairingId)
        .then((latest) => {
          setReveal(latest);
        })
        .catch(() => {
          // Non-fatal offline poll failure
        });
    }, 30000);

    return () => {
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [pairing]);

  // Null when a new reveal is allowed now.
  const cadenceNextAt = nextRevealAvailableAt(reveal);

  // The server refuses below the threshold (P0002). Disable rather than let it
  // refuse: the refusal would be a tester's only feedback, and the reveal is
  // the one action that spends a weekly slot.
  const tooFewRatingsToReveal = pairedRatedCount < MIN_RATINGS_FOR_REVEAL;
  const ratingsStillNeeded = Math.max(
    0,
    MIN_RATINGS_FOR_REVEAL - pairedRatedCount,
  );

  const handleTriggerReveal = useCallback(async () => {
    if (!pairing || pairing.status !== 'active' || actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      const result = await triggerReveal(pairing.id);
      const updatedReveal = await fetchCurrentReveal(pairing.id);
      setReveal(updatedReveal);
      setStartFreshMode(false);
      setConfirmingWithdraw(false);

      if (result.status === 'computed') {
        void hapticSuccess();
        setStatusBanner(
          '✨ Both partners are ready! Your mutual matches have been computed.',
        );
      } else {
        void hapticMedium();
      }
    } catch (err) {
      // trigger_reveal raises P0001 when the weekly cadence blocks a reveal.
      // The raw text is a database message; say when instead.
      if (isCadenceError(err)) {
        const next = nextRevealAvailableAt(reveal);
        setErrorMessage(
          next
            ? `You've already revealed together this week. Your next reveal unlocks on ${next.toLocaleDateString(
                undefined,
                { weekday: 'long', day: 'numeric', month: 'long' },
              )}.`
            : "You've already revealed together this week.",
        );
      } else if (isTooFewRatingsError(err)) {
        setErrorMessage(
          `Rate at least ${MIN_RATINGS_FOR_REVEAL} items in the Desire Library first — a reveal uses your weekly slot, so it needs something to compare.`,
        );
      } else {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Could not trigger reveal. Please try again.',
        );
      }
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, pairing, reveal]);

  const handleWithdrawReveal = useCallback(async () => {
    if (!pairing || actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setStatusBanner(null);

    try {
      await withdrawReveal(pairing.id);
      const latest = await fetchCurrentReveal(pairing.id);
      setReveal(latest);
      setConfirmingWithdraw(false);
      setStartFreshMode(true);
      setStatusBanner(
        'Your reveal readiness has been withdrawn. Nothing was shared.',
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not withdraw reveal readiness.',
      );
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, pairing]);

  const handleResumePairing = useCallback(async () => {
    if (!pairing || actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    try {
      await updatePairingStatus(pairing.id, 'active');
      await loadRevealScreenData(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not resume pairing.',
      );
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, loadRevealScreenData, pairing]);

  const partnerName = pairing?.partner_display_name?.trim() || 'your partner';

  const matches: RevealMatchItem[] = useMemo(() => {
    if (!reveal || !Array.isArray(reveal.matches)) return [];
    return reveal.matches;
  }, [reveal]);

  const mismatches: RevealMismatchItem[] = useMemo(() => {
    if (!reveal || !Array.isArray(reveal.mismatches)) return [];
    return reveal.mismatches;
  }, [reveal]);

  // Determine effective state machine phase
  const effectiveState = useMemo(() => {
    if (!pairing || pairing.status === 'pending') {
      return 'unpaired' as const;
    }
    if (pairing.status === 'paused') {
      return 'paused' as const;
    }
    if (!reveal || startFreshMode) {
      return 'no_reveal' as const;
    }
    if (reveal.status === 'pending') {
      const windowEndMs =
        new Date(reveal.triggered_at).getTime() + SEVENTY_TWO_HOURS_MS;
      if (windowEndMs <= nowMs) {
        return 'no_reveal' as const;
      }
      if (reveal.triggered_by && reveal.triggered_by !== userId) {
        return 'partner_waiting_for_you' as const;
      }
      return 'awaiting_partner' as const;
    }
    if (reveal.status === 'both_ready') {
      return 'both_ready' as const;
    }
    if (reveal.status === 'computed') {
      if (
        reveal.expires_at &&
        new Date(reveal.expires_at).getTime() <= nowMs
      ) {
        return 'expired' as const;
      }
      return 'completed' as const;
    }
    return 'expired' as const;
  }, [nowMs, pairing, reveal, startFreshMode, userId]);

  const pendingCountdownLabel = useMemo(() => {
    if (!reveal?.triggered_at) return '72h 00m';
    const targetMs =
      new Date(reveal.triggered_at).getTime() + SEVENTY_TWO_HOURS_MS;
    return formatRemainingDuration(targetMs, nowMs);
  }, [nowMs, reveal?.triggered_at]);

  const computedExpiryLabel = useMemo(() => {
    if (!reveal) return '24h 00m';
    const targetMs = reveal.expires_at
      ? new Date(reveal.expires_at).getTime()
      : new Date(reveal.revealed_at ?? reveal.triggered_at).getTime() +
        TWENTY_FOUR_HOURS_MS;
    return formatRemainingDuration(targetMs, nowMs);
  }, [nowMs, reveal]);

  const handleOpenBridgeItem = useCallback((item: RevealMismatchItem) => {
    void hapticLight();
    setSelectedBridgeItem(item);
    setBridgeModalVisible(true);
  }, []);

  const handleParkBridgeItem = useCallback((item: MismatchBridgeItem | null) => {
    if (!item) return;
    setParkedItemIds((prev) => ({
      ...prev,
      [item.library_item_id]: true,
    }));
    setStatusBanner(
      `Parked "${item.title}" for later — zero pressure, always.`,
    );
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Back Navigation */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            onPress={() => router.replace('/(app)/home' as Href)}
            style={({ pressed }) => [
              styles.backButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backButtonText, { color: colors.primary }]}>
              Home
            </Text>
          </Pressable>

          <View
            style={[
              styles.privacyPill,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[styles.privacyPillText, { color: colors.accentCool }]}
            >
              🔒 Double-Blind Protected
            </Text>
          </View>
        </View>

        {/* Status Toast / Feedback Banner */}
        {statusBanner ? (
          <View
            style={[
              styles.bannerCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentCool,
              },
            ]}
          >
            <Text style={[styles.bannerText, { color: colors.primary }]}>
              {statusBanner}
            </Text>
          </View>
        ) : null}

        {/* Error Card */}
        {errorMessage ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.error }]}>
              {errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading reveal status"
              onPress={() => void loadRevealScreenData(true)}
              style={styles.retryLink}
            >
              <Text style={[styles.retryLinkText, { color: colors.primary }]}>
                Retry
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Loading Skeleton */}
        {loading ? (
          <View
            style={[
              styles.card,
              styles.centeredCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              Checking reveal status…
            </Text>
          </View>
        ) : null}

        {/* Unpaired State */}
        {!loading && effectiveState === 'unpaired' ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.screenTitle, { color: colors.primary }]}>
              Pair with your partner first
            </Text>
            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              You’ve rated {ratedCount} {ratedCount === 1 ? 'item' : 'items'} in
              Solo Mode. When you pair with your partner, your ratings carry
              over and you can trigger a Double-Blind Reveal together.
            </Text>

            <View style={styles.actionsColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create Invite Code"
                onPress={() => router.push('/(app)/pairing/invite' as Href)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={styles.primaryButtonText}>Create Invite Code</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enter Partner Code"
                onPress={() => router.push('/(app)/pairing/accept' as Href)}
                style={({ pressed }) => [
                  styles.outlineButton,
                  {
                    borderColor: colors.primary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.outlineButtonText, { color: colors.primary }]}
                >
                  Enter Partner Code
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Paused Pairing State */}
        {!loading && effectiveState === 'paused' ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentWarm,
              },
            ]}
          >
            <Text style={[styles.screenTitle, { color: colors.primary }]}>
              Pairing is currently paused
            </Text>
            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              Your pairing with {partnerName} is paused. Resume your pairing
              whenever you both feel ready to start a new reveal.
            </Text>

            <View style={styles.actionsColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Resume pairing"
                disabled={actionBusy}
                onPress={() => void handleResumePairing()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || actionBusy ? 0.8 : 1,
                  },
                ]}
              >
                {actionBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Resume Pairing</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to Home"
                onPress={() => router.replace('/(app)/home' as Href)}
                style={styles.secondaryLinkButton}
              >
                <Text
                  style={[
                    styles.secondaryLinkText,
                    { color: colors.secondary },
                  ]}
                >
                  Back to Home
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* State 1: Trigger Reveal (no_reveal or partner_waiting_for_you or both_ready) */}
        {!loading &&
        (effectiveState === 'no_reveal' ||
          effectiveState === 'partner_waiting_for_you' ||
          effectiveState === 'both_ready') ? (
          <View>
            <Text style={[styles.screenTitle, { color: colors.primary }]}>
              {effectiveState === 'partner_waiting_for_you'
                ? `${partnerName} is ready for a reveal!`
                : effectiveState === 'both_ready'
                  ? 'Both of you are ready!'
                  : 'Ready for a reveal?'}
            </Text>

            <Text style={[styles.subtitle, { color: colors.secondary }]}>
              {effectiveState === 'partner_waiting_for_you'
                ? `You’ve rated ${ratedCount} items. ${partnerName} has already marked ready (${pendingCountdownLabel} left in window). Tap below to compute your mutual matches immediately.`
                : `You’ve rated ${ratedCount} ${
                    ratedCount === 1 ? 'item' : 'items'
                  }. When ${partnerName} is ready too, you’ll see what you share.`}
            </Text>

            <View
              style={[
                styles.reassuranceCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.reassuranceTitle, { color: colors.primary }]}>
                🔒 Your ratings stay private, always.
              </Text>
              <Text
                style={[styles.reassuranceBody, { color: colors.secondary }]}
              >
                • <Text style={styles.boldText}>Mutual Matches:</Text> Only
                items you both rated 4 or 5 appear as shared matches.
                {'\n'}• <Text style={styles.boldText}>Curiosity Bridge:</Text>{' '}
                If one of you rated 4–5 and the other rated 3 (open to
                exploring), the item surfaces anonymously with gentle
                conversation prompts — never showing who rated which way.
                {'\n'}• <Text style={styles.boldText}>Hard Veto:</Text> Any item
                rated 1 or 2 by either of you is strictly excluded.
              </Text>
            </View>

            <View style={styles.actionsColumn}>
              {tooFewRatingsToReveal ? (
                <Text style={[styles.revealGateHint, { color: colors.secondary }]}>
                  {`Rate ${ratingsStillNeeded} more ${
                    ratingsStillNeeded === 1 ? 'item' : 'items'
                  } in the Desire Library to unlock your reveal. It uses your weekly slot, so it needs something to compare.`}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: actionBusy || tooFewRatingsToReveal }}
                accessibilityLabel={
                  tooFewRatingsToReveal
                    ? `Reveal locked until you rate ${ratingsStillNeeded} more items`
                    : effectiveState === 'partner_waiting_for_you' ||
                        effectiveState === 'both_ready'
                      ? 'See our matches'
                      : "I'm ready"
                }
                disabled={actionBusy || tooFewRatingsToReveal}
                onPress={() => void handleTriggerReveal()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor:
                      effectiveState === 'partner_waiting_for_you' ||
                      effectiveState === 'both_ready'
                        ? colors.accentWarm
                        : colors.primary,
                    opacity:
                      pressed || actionBusy || tooFewRatingsToReveal ? 0.5 : 1,
                  },
                ]}
              >
                {actionBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {effectiveState === 'partner_waiting_for_you' ||
                    effectiveState === 'both_ready'
                      ? '✨ I’m ready — See our matches'
                      : 'I’m ready'}
                  </Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Explore Desire Library to rate more items"
                disabled={actionBusy}
                onPress={() => router.push('/(app)/library' as Href)}
                style={({ pressed }) => [
                  styles.outlineButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.outlineButtonText, { color: colors.primary }]}
                >
                  Rate more items in Library first
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Not yet, return to Home"
                disabled={actionBusy}
                onPress={() => router.replace('/(app)/home' as Href)}
                style={styles.secondaryLinkButton}
              >
                <Text
                  style={[
                    styles.secondaryLinkText,
                    { color: colors.secondary },
                  ]}
                >
                  Not yet
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* State 2: Waiting for Partner (awaiting_partner) */}
        {!loading && effectiveState === 'awaiting_partner' ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentCool,
              },
            ]}
          >
            <View style={styles.waitingHeaderRow}>
              <View
                style={[
                  styles.avatarCircle,
                  { backgroundColor: colors.accentCool },
                ]}
              >
                <Text style={styles.avatarInitial}>
                  {partnerName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.waitingTitleBlock}>
                <Text style={[styles.screenTitle, { color: colors.primary }]}>
                  Waiting for {partnerName}…
                </Text>
                <Text
                  style={[styles.waitingSubtitle, { color: colors.secondary }]}
                >
                  Double-blind readiness window active
                </Text>
              </View>
            </View>

            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              {partnerName} has 72 hours to tap ready. Your ratings remain
              completely locked until both of you opt in.
            </Text>

            <View
              style={[
                styles.countdownBanner,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="hourglass-outline"
                size={20}
                color={colors.accentCool}
              />
              <Text
                style={[styles.countdownBannerText, { color: colors.primary }]}
              >
                ⏳ {pendingCountdownLabel} remaining
              </Text>
            </View>

            {!confirmingWithdraw ? (
              <View style={styles.actionsColumn}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Withdraw Reveal"
                  disabled={actionBusy}
                  onPress={() => setConfirmingWithdraw(true)}
                  style={({ pressed }) => [
                    styles.destructiveOutlineButton,
                    {
                      borderColor: colors.error,
                      opacity: pressed || actionBusy ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.destructiveOutlineText,
                      { color: colors.error },
                    ]}
                  >
                    Withdraw my reveal
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to Home"
                  onPress={() => router.replace('/(app)/home' as Href)}
                  style={styles.secondaryLinkButton}
                >
                  <Text
                    style={[
                      styles.secondaryLinkText,
                      { color: colors.secondary },
                    ]}
                  >
                    Back to Home
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View
                style={[
                  styles.withdrawConfirmBox,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.error,
                  },
                ]}
              >
                <Text
                  style={[styles.withdrawConfirmTitle, { color: colors.error }]}
                >
                  Withdraw your reveal readiness?
                </Text>
                <Text
                  style={[
                    styles.withdrawConfirmBody,
                    { color: colors.secondary },
                  ]}
                >
                  This cancels the current pending reveal window immediately.
                  You can tap ready again whenever you like.
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm Withdraw Reveal"
                  disabled={actionBusy}
                  onPress={() => void handleWithdrawReveal()}
                  style={({ pressed }) => [
                    styles.destructiveButton,
                    {
                      backgroundColor: colors.error,
                      opacity: pressed || actionBusy ? 0.8 : 1,
                    },
                  ]}
                >
                  {actionBusy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.destructiveButtonText}>
                      Confirm Withdraw Reveal
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Keep waiting for partner"
                  disabled={actionBusy}
                  onPress={() => setConfirmingWithdraw(false)}
                  style={styles.secondaryLinkButton}
                >
                  <Text
                    style={[
                      styles.secondaryLinkText,
                      { color: colors.primary },
                    ]}
                  >
                    Keep waiting
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}

        {/* State 3: Reveal Moment (completed / computed) */}
        {!loading && effectiveState === 'completed' ? (
          <View>
            <View
              style={[
                styles.celebrationHeaderCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.accentWarm,
                },
              ]}
            >
              <Text
                style={[styles.celebrationTitle, { color: colors.primary }]}
              >
                ✨ You have {matches.length}{' '}
                {matches.length === 1 ? 'match' : 'matches'}
              </Text>
              <Text
                style={[
                  styles.celebrationSubtitle,
                  { color: colors.secondary },
                ]}
              >
                Shared desires you and {partnerName} both rated 4 or 5
              </Text>
              <View
                style={[
                  styles.ephemeralPill,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={15}
                  color={colors.accentWarm}
                />
                <Text
                  style={[
                    styles.ephemeralPillText,
                    { color: colors.secondary },
                  ]}
                >
                  This reveal disappears in {computedExpiryLabel}
                </Text>
              </View>
            </View>

            {/* Mutual Matches Section (both >= 4) */}
            <Text style={[styles.sectionHeading, { color: colors.primary }]}>
              Things you both want ({matches.length})
            </Text>

            {matches.length === 0 ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.emptyMatchTitle, { color: colors.primary }]}>
                  No 4–5 overlaps in this window yet
                </Text>
                <Text style={[styles.bodyText, { color: colors.secondary }]}>
                  As you both explore and rate more items in the Desire Library,
                  future reveals will surface new mutual matches.
                </Text>
              </View>
            ) : (
              <View style={styles.matchesList}>
                {matches.map((matchItem) => (
                  <View
                    key={matchItem.library_item_id}
                    style={[
                      styles.matchCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.accentWarm,
                      },
                    ]}
                  >
                    <View style={styles.matchBadgeRow}>
                      <View
                        style={[
                          styles.tierBadge,
                          { backgroundColor: colors.primary },
                        ]}
                      >
                        <Text style={styles.tierBadgeText}>
                          {matchItem.tier.toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.mutualTagText,
                          { color: colors.accentWarm },
                        ]}
                      >
                        ★ Mutual Match (Both ≥ 4)
                      </Text>
                    </View>

                    <Text
                      style={[styles.matchTitle, { color: colors.primary }]}
                    >
                      {matchItem.title}
                    </Text>

                    {matchItem.description ? (
                      <Text
                        style={[
                          styles.matchDescription,
                          { color: colors.secondary },
                        ]}
                      >
                        {matchItem.description}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}

            {/* Curiosity Bridge Section (one >= 4 AND other = 3, anonymized) */}
            <View style={styles.bridgeSection}>
              <Text style={[styles.sectionHeading, { color: colors.primary }]}>
                🌉 Curiosity Bridge ({mismatches.length})
              </Text>
              <Text
                style={[styles.bridgeSectionHint, { color: colors.secondary }]}
              >
                Items where one of you felt drawn (4–5) and the other felt open
                to exploring (3). Exact scores and who rated which way are
                hidden.
              </Text>

              {mismatches.length === 0 ? (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.bodyText, { color: colors.secondary }]}>
                    No Curiosity Bridge items in this reveal window.
                  </Text>
                </View>
              ) : (
                <View style={styles.matchesList}>
                  {mismatches.map((bridgeItem) => {
                    const isParked = Boolean(
                      parkedItemIds[bridgeItem.library_item_id],
                    );
                    return (
                      <Pressable
                        key={bridgeItem.library_item_id}
                        accessibilityRole="button"
                        accessibilityLabel={`Explore Curiosity Bridge item: ${bridgeItem.title}`}
                        onPress={() => handleOpenBridgeItem(bridgeItem)}
                        style={({ pressed }) => [
                          styles.bridgeCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.accentCool,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <View style={styles.matchBadgeRow}>
                          <View
                            style={[
                              styles.tierBadge,
                              { backgroundColor: colors.primary },
                            ]}
                          >
                            <Text style={styles.tierBadgeText}>
                              {bridgeItem.tier.toUpperCase()}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.bridgeTagText,
                              { color: colors.accentCool },
                            ]}
                          >
                            {isParked
                              ? '🔖 Parked for later'
                              : '🌉 Curiosity Zone'}
                          </Text>
                        </View>

                        <Text
                          style={[styles.matchTitle, { color: colors.primary }]}
                        >
                          {bridgeItem.title}
                        </Text>

                        <View style={styles.bridgeExploreRow}>
                          <Text
                            style={[
                              styles.bridgeExploreText,
                              { color: colors.accentWarm },
                            ]}
                          >
                            Explore together with gentle prompts →
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Post-Reveal Actions */}
            <View style={styles.actionsColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discuss in Journal"
                onPress={() => router.push('/(app)/journal' as Href)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name="journal-outline" size={20} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Discuss in Journal</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start a new reveal window"
                onPress={() => setStartFreshMode(true)}
                style={({ pressed }) => [
                  styles.outlineButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.outlineButtonText, { color: colors.primary }]}
                >
                  Start a new reveal
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* State 4: Expired Reveal Summary */}
        {!loading && effectiveState === 'expired' ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.screenTitle, { color: colors.primary }]}>
              Your last reveal has expired
            </Text>
            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              Your last reveal had{' '}
              <Text style={styles.boldText}>
                {reveal?.summary?.match_count ?? 0} mutual{' '}
                {(reveal?.summary?.match_count ?? 0) === 1
                  ? 'match'
                  : 'matches'}
              </Text>
              {reveal?.summary?.mismatch_count !== undefined
                ? ` and ${reveal.summary.mismatch_count} Curiosity Bridge ${
                    reveal.summary.mismatch_count === 1 ? 'item' : 'items'
                  }`
                : ''}
              . For your privacy, detailed reveal items automatically clear 24
              hours after computation.
            </Text>

            {/* Items clear after 24 hours but the cadence runs for 7 days, so
                for most of that window an expired reveal cannot be replaced
                yet. Offering the button anyway meant a raw database error. */}
            {cadenceNextAt ? (
              <Text style={[styles.bodyText, { color: colors.secondary }]}>
                You&apos;ve already revealed together this week. Your next
                reveal unlocks on{' '}
                <Text style={styles.boldText}>
                  {cadenceNextAt.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
                .
              </Text>
            ) : null}

            <View style={styles.actionsColumn}>
              {cadenceNextAt ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start a new reveal"
                  onPress={() => setStartFreshMode(true)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    Start a new reveal
                  </Text>
                </Pressable>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discuss in Journal"
                onPress={() => router.push('/(app)/journal' as Href)}
                style={({ pressed }) => [
                  styles.outlineButton,
                  {
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.outlineButtonText, { color: colors.primary }]}
                >
                  Discuss in Journal
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Non-judgmental Curiosity Bridge Modal */}
      <MismatchBridgeModal
        visible={bridgeModalVisible}
        item={selectedBridgeItem}
        items={mismatches}
        onClose={() => setBridgeModalVisible(false)}
        onParkForNow={handleParkBridgeItem}
      />

      {/* iOS / Background Privacy Blur Shield Overlay */}
      {privacyShieldActive ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            styles.privacyShieldOverlay,
            { backgroundColor: colors.bg },
          ]}
        >
          <Ionicons name="lock-closed" size={36} color={colors.primary} />
          <Text style={[styles.privacyShieldTitle, { color: colors.primary }]}>
            YesYas! Privacy Shield
          </Text>
          <Text
            style={[styles.privacyShieldSubtitle, { color: colors.secondary }]}
          >
            Reveal content is hidden while the app is in the background.
          </Text>
        </View>
      ) : null}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 6,
  },
  backButtonText: {
    ...TYPOGRAPHY.button,
  },
  privacyPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  privacyPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bannerCard: {
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  bannerText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    borderRadius: RADII.md,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    flex: 1,
  },
  retryLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  retryLinkText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  card: {
    borderRadius: RADII.xl,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.elevated,
  },
  centeredCard: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  screenTitle: {
    ...TYPOGRAPHY.h1,
    letterSpacing: -0.5,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.md,
  },
  bodyText: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.md,
  },
  boldText: {
    fontWeight: '700',
  },
  reassuranceCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.subtle,
  },
  reassuranceTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
  },
  reassuranceBody: {
    ...TYPOGRAPHY.caption,
    lineHeight: 21,
  },
  actionsColumn: {
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  revealGateHint: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    paddingHorizontal: SPACING.sm,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  outlineButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  outlineButtonText: {
    ...TYPOGRAPHY.button,
  },
  secondaryLinkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLinkText: {
    ...TYPOGRAPHY.button,
  },
  waitingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  waitingTitleBlock: {
    flex: 1,
  },
  waitingSubtitle: {
    ...TYPOGRAPHY.caption,
  },
  countdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  countdownBannerText: {
    ...TYPOGRAPHY.h3,
  },
  destructiveOutlineButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  destructiveOutlineText: {
    ...TYPOGRAPHY.button,
  },
  withdrawConfirmBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  withdrawConfirmTitle: {
    ...TYPOGRAPHY.h3,
  },
  withdrawConfirmBody: {
    ...TYPOGRAPHY.caption,
    marginBottom: 4,
  },
  destructiveButton: {
    minHeight: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  destructiveButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  celebrationHeaderCard: {
    borderRadius: RADII.xl,
    borderWidth: 1.5,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.goldGlow,
  },
  celebrationTitle: {
    ...TYPOGRAPHY.h1,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  celebrationSubtitle: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  ephemeralPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  ephemeralPillText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  sectionHeading: {
    ...TYPOGRAPHY.h2,
    letterSpacing: -0.3,
    marginBottom: SPACING.xs,
  },
  emptyMatchTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 4,
  },
  matchesList: {
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  matchCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.sm + 2,
    ...SHADOWS.goldGlow,
  },
  matchBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.xs,
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  mutualTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  matchTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 4,
  },
  matchDescription: {
    ...TYPOGRAPHY.caption,
    lineHeight: 19,
  },
  bridgeSection: {
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  bridgeSectionHint: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.sm,
  },
  bridgeCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.sm + 2,
    ...SHADOWS.terracottaGlow,
  },
  bridgeTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  bridgeExploreRow: {
    marginTop: 6,
  },
  bridgeExploreText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
  },
  privacyShieldOverlay: {
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    gap: SPACING.xs,
  },
  privacyShieldTitle: {
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
  },
  privacyShieldSubtitle: {
    ...TYPOGRAPHY.body,
    textAlign: 'center',
  },
});
