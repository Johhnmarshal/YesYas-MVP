import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { friendlyError } from '@/lib/errors';
import { passphraseProblem } from '@/lib/validation';
import { supabase } from '@/lib/supabase';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

/**
 * Set or change the account passphrase.
 *
 * Reached two ways: from Settings ("Change passphrase"), and from a
 * passphrase reset email, where app/_layout.tsx catches Supabase's
 * PASSWORD_RECOVERY event and routes here with ?recovery=1.
 */
export default function PassphraseScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ recovery?: string }>();
  const isRecovery = params.recovery === '1';

  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSave() {
    const problem = passphraseProblem(passphrase);
    if (problem) {
      setErrorMessage(problem);
      return;
    }
    if (passphrase !== confirmation) {
      setErrorMessage('The two passphrases do not match.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    const { error } = await supabase.auth.updateUser({ password: passphrase });
    setSaving(false);
    if (error) {
      setErrorMessage(
        friendlyError(
          error,
          'We could not update your passphrase. It may be too common or the same as before; try a different one.',
        ),
      );
      return;
    }
    setPassphrase('');
    setConfirmation('');
    setDone(true);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            onPress={() => router.replace('/(app)/settings' as Href)}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </Pressable>

          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {isRecovery ? 'Choose a new passphrase' : 'Change passphrase'}
          </Text>
          <Text style={[styles.lead, { color: colors.secondary }]}>
            At least 12 characters, with upper and lower case letters and a
            number. Your private notes and journal are not affected: they are
            protected by your device key and recovery code, not this passphrase.
          </Text>

          {done ? (
            <View
              style={[styles.success, { borderColor: colors.success, backgroundColor: colors.surface }]}
              accessibilityLiveRegion="polite"
            >
              <Text style={[styles.successText, { color: colors.text }]}>
                Passphrase updated. Use it next time you sign in.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/(app)/home' as Href)}
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
                  Continue
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                value={passphrase}
                onChangeText={setPassphrase}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                autoCapitalize="none"
                placeholder="New passphrase"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="New passphrase"
                maxLength={128}
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
              />
              <TextInput
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                autoCapitalize="none"
                placeholder="Type it again"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Confirm new passphrase"
                maxLength={128}
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
              />

              {errorMessage ? (
                <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.error }]}>
                  {errorMessage}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={() => void handleSave()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: saving ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
                    Save passphrase
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: SPACING.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  backText: { ...TYPOGRAPHY.button },
  title: { ...TYPOGRAPHY.h1, marginTop: SPACING.xs, marginBottom: SPACING.xs },
  lead: { ...TYPOGRAPHY.body, marginBottom: SPACING.md },
  input: {
    ...TYPOGRAPHY.body,
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    minHeight: 52,
    marginBottom: SPACING.sm,
  },
  error: { ...TYPOGRAPHY.caption, marginBottom: SPACING.sm },
  primaryButton: {
    minHeight: 52,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: { ...TYPOGRAPHY.button },
  success: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    gap: SPACING.sm,
  },
  successText: { ...TYPOGRAPHY.body },
});
