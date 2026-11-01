import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
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

import { notifyConsentGiven } from '@/app/_layout';
import { track } from '@/lib/analytics';
import { friendlyError } from '@/lib/errors';
import { MINIMUM_AGE } from '@/lib/legal';
import { supabase } from '@/lib/supabase';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

interface CheckRowProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}

function CheckRow({ checked, onToggle, label, children }: CheckRowProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.checkRow,
        {
          backgroundColor: colors.surface,
          borderColor: checked ? colors.primary : colors.border,
          borderWidth: checked ? 2 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={checked ? colors.primary : colors.textMuted}
      />
      <View style={styles.checkText}>{children}</View>
    </Pressable>
  );
}

/**
 * Before onboarding: an 18+ confirmation and explicit consent to the Terms
 * and to processing sensitive data, both timestamped on profiles
 * (age_confirmed_at, terms_accepted_at). app/_layout.tsx sends every signed-in
 * account here until both are recorded, including accounts that finished
 * onboarding before this screen existed.
 */
export default function OnboardingConsentScreen() {
  const colors = useThemeColors();
  const [isAdult, setIsAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canContinue = isAdult && accepted && !saving;

  async function handleContinue() {
    if (!canContinue) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const { data: userRes, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userRes.user) throw authErr ?? new Error('Not authenticated');

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('profiles')
        .update({ age_confirmed_at: now, terms_accepted_at: now })
        .eq('id', userRes.user.id);
      if (error) throw error;

      track('consent_given');
      notifyConsentGiven();
    } catch (err: unknown) {
      setErrorMessage(friendlyError(err, 'We could not save that. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepLabel, { color: colors.secondary }]}>
          Before you start
        </Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.primary }]}>
          A couple of things first
        </Text>
        <Text style={[styles.lead, { color: colors.secondary }]}>
          YesYas! is for adults, and what you rate here is personal. We need
          your agreement before you begin.
        </Text>

        <View style={styles.checks}>
          <CheckRow
            checked={isAdult}
            onToggle={() => setIsAdult((v) => !v)}
            label={`I am ${MINIMUM_AGE} or over`}
          >
            <Text style={[styles.checkTitle, { color: colors.text }]}>
              I am {MINIMUM_AGE} or over
            </Text>
            <Text style={[styles.checkBody, { color: colors.secondary }]}>
              The library includes sexually explicit content, which you only see
              if you choose it.
            </Text>
          </CheckRow>

          <CheckRow
            checked={accepted}
            onToggle={() => setAccepted((v) => !v)}
            label="I agree to the Terms and consent to the processing of my sensitive data as described in the Privacy Policy"
          >
            <Text style={[styles.checkTitle, { color: colors.text }]}>
              I agree to the Terms and the Privacy Policy
            </Text>
            <Text style={[styles.checkBody, { color: colors.secondary }]}>
              I consent to YesYas! storing data about my intimate preferences to
              run the app. I can withdraw by deleting my account at any time.
            </Text>
          </CheckRow>
        </View>

        <View style={styles.links}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/terms' as Href)}
            style={styles.linkButton}
          >
            <Text style={[styles.linkText, { color: colors.accentWarm }]}>
              Read the Terms
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/privacy' as Href)}
            style={styles.linkButton}
          >
            <Text style={[styles.linkText, { color: colors.accentWarm }]}>
              Read the Privacy Policy
            </Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.error, { color: colors.error }]}
          >
            {errorMessage}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue }}
          accessibilityLabel="Continue"
          disabled={!canContinue}
          onPress={() => void handleContinue()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: !canContinue ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
              Continue
            </Text>
          )}
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
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
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
    marginBottom: SPACING.xs,
  },
  lead: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.md,
  },
  checks: {
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    minHeight: 68,
  },
  checkText: {
    flex: 1,
  },
  checkTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 2,
  },
  checkBody: {
    ...TYPOGRAPHY.caption,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  linkButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    ...TYPOGRAPHY.button,
    textDecorationLine: 'underline',
  },
  error: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.sm,
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
