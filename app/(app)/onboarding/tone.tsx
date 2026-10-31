import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ToneLabel } from '@/lib/database.types';
import { RADII, SPACING, TONE_OPTIONS, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

/**
 * Onboarding Step 1/3 — Tone Preference (`romantic`, `playful`, `direct`).
 * Default is `'romantic'`. Passes selected `tone` to `/(app)/onboarding/tier`.
 */
export default function OnboardingToneScreen() {
  const colors = useThemeColors();
  const [selectedTone, setSelectedTone] = useState<ToneLabel>('romantic');

  function handleContinue() {
    const nextHref = `/(app)/onboarding/tier?tone=${encodeURIComponent(selectedTone)}` as Href;
    router.push(nextHref);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepLabel, { color: colors.secondary }]}>
          Step 1 of 3
        </Text>
        <Text style={[styles.title, { color: colors.primary }]}>
          How do you like to talk about this?
        </Text>

        <View style={styles.optionsList}>
          {TONE_OPTIONS.map((option) => {
            const isSelected = selectedTone === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${option.label}: ${option.description}`}
                onPress={() => setSelectedTone(option.value)}
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
                        borderColor: isSelected ? colors.primary : colors.textMuted,
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue to content tier preference"
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
            Continue
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
    marginBottom: SPACING.lg,
  },
  card: {
    minHeight: 68,
    borderRadius: RADII.md,
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
  primaryButton: {
    minHeight: 56,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
  },
});
