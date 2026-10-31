import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { isValidRecoveryCode } from '@/lib/crypto';
import {
  RecoveryCodeError,
  ensureKeyReady,
  resetEncryptionKey,
  unlockWithRecoveryCode,
} from '@/lib/key-recovery';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

type GateState = 'checking' | 'ready' | 'locked' | 'error';

interface EncryptionKeyGateProps {
  children: ReactNode;
  userId: string | null;
}

/**
 * Resolves the device encryption key before any screen can read or write an
 * encrypted column.
 *
 * The case this exists for: a signed-in user on a device that holds no key, on
 * an account that has a recovery backup. Previously the app minted a fresh key
 * at that moment and every existing note and journal entry became
 * undecryptable. Now it blocks here and asks for the recovery code instead.
 *
 * A failed check (offline, RLS error) is also blocking, deliberately: carrying
 * on would mean guessing that the account has no backup.
 */
export function EncryptionKeyGate({ children, userId }: EncryptionKeyGateProps) {
  const colors = useThemeColors();
  const [state, setState] = useState<GateState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const check = useCallback(async () => {
    if (!userId) {
      setState('ready');
      return;
    }
    setState('checking');
    setErrorMessage(null);
    try {
      const status = await ensureKeyReady(userId);
      setState(status.state === 'locked' ? 'locked' : 'ready');
    } catch {
      setState('error');
      setErrorMessage(
        'We could not check your encryption key. Check your connection and try again.',
      );
    }
  }, [userId]);

  useEffect(() => {
    void check();
  }, [check]);

  const onUnlock = useCallback(async () => {
    if (!userId || unlocking) return;
    setUnlocking(true);
    setErrorMessage(null);
    try {
      await unlockWithRecoveryCode(userId, code);
      setCode('');
      setState('ready');
    } catch (err) {
      setErrorMessage(
        err instanceof RecoveryCodeError
          ? err.message
          : 'Something went wrong unlocking this device. Please try again.',
      );
    } finally {
      setUnlocking(false);
    }
  }, [code, unlocking, userId]);

  const runReset = useCallback(async () => {
    if (!userId) return;
    try {
      await resetEncryptionKey(userId);
      setCode('');
      setState('ready');
    } catch {
      setErrorMessage('Could not reset the key. Please try again.');
    }
  }, [userId]);

  const onStartFresh = useCallback(() => {
    if (!userId) return;

    const title = 'Start fresh on this device?';
    const body =
      'Your existing journal entries and private notes were encrypted with a key only your recovery code can unlock. Starting fresh creates a new key and makes all of that content permanently unreadable. This cannot be undone.';

    // react-native-web does not implement Alert, which would leave this
    // button silently doing nothing on the web build.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`)) {
        void runReset();
      }
      return;
    }

    Alert.alert(title, body, [
      { text: 'Keep trying my code', style: 'cancel' },
      {
        text: 'Start fresh',
        style: 'destructive',
        onPress: () => {
          void runReset();
        },
      },
    ]);
  }, [runReset, userId]);

  if (state === 'ready') {
    return <>{children}</>;
  }

  if (state === 'checking') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: colors.bg }]}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.primary }]}>
            Can&apos;t verify your key
          </Text>
          <Text style={[styles.body, { color: colors.secondary }]}>
            {errorMessage}
          </Text>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={() => void check()}
            accessibilityRole="button"
            accessibilityLabel="Try checking your encryption key again"
          >
            <Text style={[styles.primaryButtonText, { color: colors.surface }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const codeLooksComplete = isValidRecoveryCode(code);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.lockIcon, { color: colors.primary }]}>🔑</Text>
          <Text style={[styles.title, { color: colors.primary }]}>
            Unlock your private content
          </Text>
          <Text style={[styles.body, { color: colors.secondary }]}>
            Your journal entries and private notes are encrypted with a key that
            never leaves your devices. This device doesn&apos;t have it yet —
            enter the recovery code you saved to restore access.
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor={colors.muted}
            value={code}
            onChangeText={(next) => {
              setCode(next);
              setErrorMessage(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            editable={!unlocking}
            accessibilityLabel="Recovery code"
            accessibilityHint="Enter the recovery code you saved when you set up encryption"
          />

          {errorMessage ? (
            <Text
              style={[styles.error, { color: colors.error }]}
              accessibilityLiveRegion="polite"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              (!codeLooksComplete || unlocking) && styles.buttonDisabled,
            ]}
            disabled={!codeLooksComplete || unlocking}
            onPress={() => void onUnlock()}
            accessibilityRole="button"
            accessibilityLabel="Unlock with recovery code"
          >
            {unlocking ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: colors.surface }]}>
                Unlock this device
              </Text>
            )}
          </Pressable>

          <Text style={[styles.caption, { color: colors.muted }]}>
            Checking the code takes a moment — it is deliberately slow so a
            stolen copy of your data is hard to brute-force.
          </Text>

          <Pressable
            style={styles.textButton}
            onPress={onStartFresh}
            accessibilityRole="button"
            accessibilityLabel="Start fresh on this device and permanently lose existing encrypted content"
          >
            <Text style={[styles.textButtonLabel, { color: colors.error }]}>
              I&apos;ve lost my recovery code
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  lockIcon: { fontSize: 40, textAlign: 'center' },
  title: { ...TYPOGRAPHY.h1, textAlign: 'center' },
  body: { ...TYPOGRAPHY.body, textAlign: 'center', marginBottom: SPACING.xs },
  input: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    ...TYPOGRAPHY.body,
    letterSpacing: 1,
    minHeight: 48,
  },
  error: { ...TYPOGRAPHY.caption },
  primaryButton: {
    borderRadius: RADII.md,
    padding: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: { ...TYPOGRAPHY.button },
  buttonDisabled: { opacity: 0.5 },
  caption: { ...TYPOGRAPHY.caption, textAlign: 'center' },
  textButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  textButtonLabel: { ...TYPOGRAPHY.caption, fontWeight: '600' },
});
