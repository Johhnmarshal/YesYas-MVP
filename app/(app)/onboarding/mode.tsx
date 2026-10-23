import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { notifyOnboardingComplete } from '@/app/_layout';
import type { DesireTier, ToneLabel } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

function parseToneParam(raw?: string | string[]): ToneLabel {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === 'romantic' || val === 'playful' || val === 'direct') {
    return val;
  }
  return 'romantic';
}

function parseTierParam(raw?: string | string[]): DesireTier {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === 'sensory' || val === 'suggestive' || val === 'explicit') {
    return val;
  }
  return 'suggestive';
}

/**
 * Onboarding Step 3/3 — Mode Selection.
 * Presents two action cards ("Explore solo — Journal your desires first" and
 * "Invite my partner now"), saves `tone_preference`, `content_tier_preference`,
 * and `onboarding_complete: true` on `public.profiles`, then navigates to
 * `/(app)/journal` or `/(app)/pairing/invite`.
 */
export default function OnboardingModeScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ tone?: string; tier?: string }>();
  const tone = parseToneParam(params.tone);
  const tier = parseTierParam(params.tier);

  const [submittingMode, setSubmittingMode] = useState<'solo' | 'pair' | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSelectMode(mode: 'solo' | 'pair') {
    if (submittingMode !== null) return;
    setSubmittingMode(mode);
    setErrorMessage(null);

    try {
      const { data: userRes, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userRes.user) {
        throw new Error(authErr?.message ?? 'Please sign in to continue.');
      }

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          tone_preference: tone,
          content_tier_preference: tier,
          onboarding_complete: true,
        })
        .eq('id', userRes.user.id);

      if (updateErr) {
        throw new Error(updateErr.message);
      }

      notifyOnboardingComplete();

      const destination: Href =
        mode === 'solo'
          ? ('/(app)/journal' as Href)
          : ('/(app)/pairing/invite' as Href);
      router.replace(destination);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not save your preferences. Please try again.';
      setErrorMessage(message);
      setSubmittingMode(null);
    }
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      const backHref = `/(app)/onboarding/tier?tone=${encodeURIComponent(tone)}` as Href;
      router.replace(backHref);
    }
  }

  const isBusy = submittingMode !== null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepLabel, { color: colors.secondary }]}>
          Step 3 of 3
        </Text>
        <Text style={[styles.title, { color: colors.primary }]}>
          How would you like to start?
        </Text>

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
          </View>
        ) : null}

        <View style={styles.cardsColumn}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Explore solo — Journal your desires first"
            disabled={isBusy}
            onPress={() => void handleSelectMode('solo')}
            style={({ pressed }) => [
              styles.modeCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: pressed || isBusy ? 0.8 : 1,
              },
            ]}
          >
            <View style={styles.modeCardHeader}>
              <Text style={[styles.modeCardTitle, { color: colors.primary }]}>
                Explore solo
              </Text>
              {submittingMode === 'solo' ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.chevron, { color: colors.primary }]}>→</Text>
              )}
            </View>
            <Text style={[styles.modeCardSubtitle, { color: colors.secondary }]}>
              Journal your desires first
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite my partner now"
            disabled={isBusy}
            onPress={() => void handleSelectMode('pair')}
            style={({ pressed }) => [
              styles.modeCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: pressed || isBusy ? 0.8 : 1,
              },
            ]}
          >
            <View style={styles.modeCardHeader}>
              <Text style={[styles.modeCardTitle, { color: colors.primary }]}>
                Invite my partner now
              </Text>
              {submittingMode === 'pair' ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.chevron, { color: colors.primary }]}>→</Text>
              )}
            </View>
            <Text style={[styles.modeCardSubtitle, { color: colors.secondary }]}>
              Share a private invite code and discover what overlaps
            </Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to content tier preference"
          disabled={isBusy}
          onPress={handleBack}
          style={({ pressed }) => [
            styles.secondaryButton,
            { opacity: pressed || isBusy ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
            Back
          </Text>
        </Pressable>
      </ScrollView>
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
    justifyContent: 'center',
  },
  stepLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h1,
    marginBottom: SPACING.lg,
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
  },
  cardsColumn: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  modeCard: {
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    justifyContent: 'center',
  },
  modeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modeCardTitle: {
    ...TYPOGRAPHY.h2,
  },
  chevron: {
    ...TYPOGRAPHY.h2,
  },
  modeCardSubtitle: {
    ...TYPOGRAPHY.body,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...TYPOGRAPHY.button,
  },
});
