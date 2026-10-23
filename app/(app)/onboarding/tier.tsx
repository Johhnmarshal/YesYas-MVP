import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DesireTier, ToneLabel } from '@/lib/database.types';
import { SPACING, TIER_OPTIONS, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

function parseToneParam(raw?: string | string[]): ToneLabel {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === 'romantic' || val === 'playful' || val === 'direct') {
    return val;
  }
  return 'romantic';
}

/**
 * Onboarding Step 2/3 — Content Tier (`sensory`, `suggestive`, `explicit`).
 * Default is `'suggestive'`. Passes `tone` and `tier` to `/(app)/onboarding/mode`.
 */
export default function OnboardingTierScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ tone?: string }>();
  const tone = parseToneParam(params.tone);
  const [selectedTier, setSelectedTier] = useState<DesireTier>('suggestive');

  function handleContinue() {
    const nextHref =
      `/(app)/onboarding/mode?tone=${encodeURIComponent(tone)}&tier=${encodeURIComponent(selectedTier)}` as Href;
    router.push(nextHref);
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/onboarding/tone' as Href);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepLabel, { color: colors.secondary }]}>
          Step 2 of 3
        </Text>
        <Text style={[styles.title, { color: colors.primary }]}>
          What kind of content feels right for now?
        </Text>

        <View style={styles.optionsList}>
          {TIER_OPTIONS.map((option) => {
            const isSelected = selectedTier === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${option.label}: ${option.description}`}
                onPress={() => setSelectedTier(option.value)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                    borderWidth: isSelected ? 2 : 1,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.radioRow}>
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor: isSelected ? colors.primary : colors.muted,
                      },
                    ]}
                  >
                    {isSelected ? (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.cardTextContainer}>
                    <Text style={[styles.cardTitle, { color: colors.primary }]}>
                      {option.label}
                    </Text>
                    <Text
                      style={[
                        styles.cardDescription,
                        { color: colors.secondary },
                      ]}
                    >
                      {option.description}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.hint, { color: colors.muted }]}>
          You can change this any time in settings.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue to mode selection"
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>
            Continue
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to tone preference"
          onPress={handleBack}
          style={({ pressed }) => [
            styles.secondaryButton,
            { opacity: pressed ? 0.7 : 1 },
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
  optionsList: {
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  card: {
    minHeight: 68,
    borderRadius: 12,
    padding: SPACING.sm,
    justifyContent: 'center',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 2,
  },
  cardDescription: {
    ...TYPOGRAPHY.body,
  },
  hint: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
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
