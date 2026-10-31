import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  hapticError,
  hapticLight,
  hapticSelection,
  hapticSuccess,
} from '@/lib/haptics';
import { hashPin, verifyPin } from '@/lib/crypto';
import { supabase } from '@/lib/supabase';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export const LOCK_ENABLED_KEY = '@yesyas/lock_enabled';
/** Pre-hashing location. Read once so an existing PIN can be migrated, then deleted. */
export const PIN_CODE_KEY = '@yesyas/pin_code';
/** SecureStore keys allow alphanumerics, ".", "-" and "_" only. */
const PIN_VERIFIER_KEY = 'yesyas_pin_verifier_v1';

export interface BiometricSettings {
  enabled: boolean;
  hasPin: boolean;
}

// expo-secure-store is unavailable on web, where this degrades to AsyncStorage.
// The verifier is a PBKDF2 hash either way, so the stored value is never the PIN.
async function loadSecureStore() {
  if (Platform.OS === 'web') return null;
  try {
    const mod = await import('expo-secure-store');
    if (!(await mod.isAvailableAsync())) return null;
    return mod;
  } catch {
    return null;
  }
}

async function readVerifier(): Promise<string | null> {
  const secure = await loadSecureStore();
  if (secure) {
    try {
      const v = await secure.getItemAsync(PIN_VERIFIER_KEY);
      if (v) return v;
    } catch {
      // Fall through to the migration path.
    }
  }
  try {
    const webVerifier = await AsyncStorage.getItem(PIN_VERIFIER_KEY);
    if (webVerifier) return webVerifier;
  } catch {
    // Ignore.
  }

  // Migration: a 6-digit PIN was previously stored in cleartext. Convert it to
  // a verifier and remove the cleartext copy, so an existing lock keeps working
  // without the user re-entering anything.
  try {
    const legacy = await AsyncStorage.getItem(PIN_CODE_KEY);
    if (legacy && /^\d{6}$/.test(legacy)) {
      const verifier = await hashPin(legacy);
      await writeVerifier(verifier);
      await AsyncStorage.removeItem(PIN_CODE_KEY);
      return verifier;
    }
  } catch {
    // Ignore.
  }
  return null;
}

async function writeVerifier(verifier: string): Promise<void> {
  const secure = await loadSecureStore();
  if (secure) {
    try {
      await secure.setItemAsync(PIN_VERIFIER_KEY, verifier, {
        keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return;
    } catch {
      // Fall through.
    }
  }
  await AsyncStorage.setItem(PIN_VERIFIER_KEY, verifier);
}

async function clearVerifier(): Promise<void> {
  const secure = await loadSecureStore();
  if (secure) {
    try {
      await secure.deleteItemAsync(PIN_VERIFIER_KEY);
    } catch {
      // Best effort.
    }
  }
  try {
    await AsyncStorage.removeItem(PIN_VERIFIER_KEY);
    await AsyncStorage.removeItem(PIN_CODE_KEY);
  } catch {
    // Best effort.
  }
}

/** Reads lock preferences. Never returns the PIN — it is not stored. */
export async function getBiometricSettings(): Promise<BiometricSettings> {
  try {
    const [enabledRaw, verifier] = await Promise.all([
      AsyncStorage.getItem(LOCK_ENABLED_KEY),
      readVerifier(),
    ]);
    return {
      enabled: enabledRaw === 'true',
      hasPin: verifier !== null,
    };
  } catch {
    return { enabled: false, hasPin: false };
  }
}

/** Checks an entered PIN against the stored verifier, in constant time. */
export async function checkPin(pin: string): Promise<boolean> {
  const verifier = await readVerifier();
  if (!verifier) return false;
  return verifyPin(pin, verifier);
}

/**
 * Persists lock preferences. The PIN is hashed with PBKDF2 and the verifier is
 * kept in the device keychain; the PIN itself is never written anywhere. It
 * used to be stored as cleartext in AsyncStorage, which is a plain file on
 * native and localStorage on web.
 */
export async function saveBiometricSettings(
  enabled: boolean,
  pin?: string,
): Promise<void> {
  if (!enabled) {
    await AsyncStorage.setItem(LOCK_ENABLED_KEY, 'false');
    if (pin === '') {
      await clearVerifier();
    }
    return;
  }

  if (pin !== undefined) {
    const trimmed = pin.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      throw new Error('PIN must be a 6-digit number.');
    }
    await writeVerifier(await hashPin(trimmed));
  } else if ((await readVerifier()) === null) {
    throw new Error('Cannot enable lock without configuring a PIN.');
  }

  await AsyncStorage.setItem(LOCK_ENABLED_KEY, 'true');
}

interface BiometricGateProps {
  children: ReactNode;
  active?: boolean;
}

const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
];

/**
 * Device lock overlay that checks `@yesyas/lock_enabled` and `@yesyas/pin_code`
 * in AsyncStorage, triggers `expo-local-authentication` on app foreground
 * (`AppState` change from `background` to `active`), and provides a 6-digit
 * PIN keypad fallback.
 */
export function BiometricGate({ children, active = true }: BiometricGateProps) {
  const colors = useThemeColors();
  const [initializing, setInitializing] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);
  // Two-tap confirm rather than Alert.alert: react-native-web's Alert is not
  // reliable, and the web build is the beta channel. A silent no-op here
  // would leave the user exactly as stuck as before.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const wasInBackgroundRef = useRef(false);

  /**
   * The way out of a forgotten PIN.
   *
   * Without this the locked overlay had no exit at all: no sign-out, no reset,
   * no attempt counter. A tester who forgot their six digits could only
   * reinstall the app — which discards the device keychain entry, and with it
   * every journal entry and private note, because nobody has a recovery code
   * (user_key_recovery is empty on production). Forgetting a PIN destroyed all
   * your data.
   *
   * Clearing the lock on sign-out is safe. The PIN is a local convenience lock
   * over content that already sits behind account authentication: whoever does
   * this is signed out immediately and needs the account's email and
   * passphrase to get back in. It deliberately does NOT call clearMasterKey —
   * the device key stays put, so the journal survives and is readable again
   * after signing back in.
   */
  const handleForgotPin = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    setErrorMessage(null);
    try {
      // Clears LOCK_ENABLED_KEY and the PBKDF2 verifier.
      await saveBiometricSettings(false, '');
      // The pre-hashing plaintext PIN, if this device still carries one.
      await AsyncStorage.removeItem(PIN_CODE_KEY);
      await supabase.auth.signOut();
      setPinInput('');
      setConfirmingSignOut(false);
      setLocked(false);
    } catch {
      setErrorMessage(
        'Could not sign out. Check your connection and try again.',
      );
    } finally {
      setSigningOut(false);
    }
  }, [signingOut]);

  const triggerBiometricPrompt = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      setAuthenticating(true);
      setErrorMessage(null);
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const canUseBiometric = hasHardware && isEnrolled;
      setBiometricSupported(canUseBiometric);

      if (!canUseBiometric) {
        setAuthenticating(false);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock YesYas!',
        fallbackLabel: 'Use 6-digit PIN',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: false,
      });

      if (result.success) {
        void hapticSuccess();
        setLocked(false);
        setPinInput('');
        setErrorMessage(null);
      }
    } catch {
      void hapticError();
      setErrorMessage('Biometric check unavailable. Please enter your 6-digit PIN.');
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const evaluateLockState = useCallback(async () => {
    if (!active) {
      setLocked(false);
      setInitializing(false);
      return;
    }

    const settings = await getBiometricSettings();

    if (settings.enabled) {
      setLocked(true);
      setPinInput('');
      setErrorMessage(null);
      setInitializing(false);
      void triggerBiometricPrompt();
    } else {
      setLocked(false);
      setInitializing(false);
    }
  }, [active, triggerBiometricPrompt]);

  useEffect(() => {
    void evaluateLockState();
  }, [evaluateLockState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        wasInBackgroundRef.current = true;
      } else if (nextState === 'active' && wasInBackgroundRef.current) {
        wasInBackgroundRef.current = false;
        void evaluateLockState();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [evaluateLockState]);

  const handleKeyPress = useCallback(
    (key: string) => {
      // The verifier is a PBKDF2 derivation and takes a moment on a phone.
      // Swallow presses while it runs, so a sixth digit typed twice cannot
      // start a second check or leave a stray digit in the next attempt.
      if (verifyingPin) return;
      void hapticSelection();
      if (key === 'clear') {
        setPinInput('');
        setErrorMessage(null);
        return;
      }

      if (key === 'back') {
        setPinInput((prev) => prev.slice(0, -1));
        setErrorMessage(null);
        return;
      }

      setPinInput((prev) => {
        if (prev.length >= 6) return prev;
        const next = prev + key;
        if (next.length === 6) {
          // checkPin is a PBKDF2 derivation, so it cannot run inside the state
          // updater. Clear the field immediately and verify alongside.
          void (async () => {
            setVerifyingPin(true);
            const ok = await checkPin(next);
            setVerifyingPin(false);
            if (ok) {
              void hapticSuccess();
              setLocked(false);
              setErrorMessage(null);
              return;
            }
            void hapticError();
            setErrorMessage('Incorrect PIN. Please try again.');
          })();
          return '';
        }
        setErrorMessage(null);
        return next;
      });
    },
    [verifyingPin],
  );

  if (initializing) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {children}
      {locked && active ? (
        <SafeAreaView
          style={[
            StyleSheet.absoluteFillObject,
            styles.overlay,
            { backgroundColor: colors.bg },
          ]}
        >
          <View style={styles.content}>
            <Text style={[styles.lockIcon, { color: colors.primary }]}>🔒</Text>
            <Text style={[styles.title, { color: colors.primary }]}>
              YesYas! is locked
            </Text>
            <Text style={[styles.subtitle, { color: colors.secondary }]}>
              Enter your 6-digit PIN to continue
            </Text>

            <View
              style={styles.dotsRow}
              accessibilityRole="text"
              accessibilityLabel={`${pinInput.length} of 6 PIN digits entered`}
            >
              {[0, 1, 2, 3, 4, 5].map((index) => {
                const filled = index < pinInput.length;
                return (
                  <View
                    key={index}
                    style={[
                      styles.dot,
                      {
                        borderColor: colors.primary,
                        backgroundColor: filled ? colors.primary : 'transparent',
                      },
                    ]}
                  />
                );
              })}
            </View>

            {errorMessage ? (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {errorMessage}
              </Text>
            ) : (
              <View style={styles.errorSpacer} />
            )}

            <View style={styles.keypad}>
              {KEYPAD_ROWS.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.keypadRow}>
                  {row.map((key) => {
                    const isClear = key === 'clear';
                    const isBack = key === 'back';
                    const label = isClear ? 'Clear' : isBack ? '⌫' : key;
                    const a11yLabel = isClear
                      ? 'Clear PIN'
                      : isBack
                        ? 'Delete last digit'
                        : `Digit ${key}`;

                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={a11yLabel}
                        onPress={() => handleKeyPress(key)}
                        style={({ pressed }) => [
                          styles.keyButton,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            isClear ? styles.keyActionText : styles.keyDigitText,
                            { color: colors.primary },
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {biometricSupported && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Unlock with biometrics"
                disabled={authenticating}
                onPress={() => {
                  void hapticLight();
                  void triggerBiometricPrompt();
                }}
                style={({ pressed }) => [
                  styles.biometricButton,
                  {
                    borderColor: colors.primary,
                    opacity: pressed || authenticating ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[styles.biometricButtonText, { color: colors.primary }]}>
                  {authenticating ? 'Checking biometrics…' : 'Use Face ID / Touch ID'}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                confirmingSignOut
                  ? 'Confirm sign out and clear the PIN lock'
                  : 'Forgot your PIN? Sign out instead'
              }
              disabled={signingOut}
              onPress={() => {
                void hapticLight();
                if (confirmingSignOut) {
                  void handleForgotPin();
                } else {
                  setConfirmingSignOut(true);
                }
              }}
              style={({ pressed }) => [
                styles.forgotPinButton,
                { opacity: pressed || signingOut ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.forgotPinText, { color: colors.textMuted }]}>
                {signingOut
                  ? 'Signing out…'
                  : confirmingSignOut
                    ? 'Tap again to sign out. Your journal is kept and stays readable once you sign back in.'
                    : 'Forgot your PIN?'}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  lockIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h1,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    minHeight: 24,
    marginBottom: SPACING.sm,
  },
  errorSpacer: {
    minHeight: 24,
    marginBottom: SPACING.sm,
  },
  keypad: {
    width: '100%',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  keyButton: {
    minWidth: 80,
    minHeight: 56,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  keyDigitText: {
    ...TYPOGRAPHY.h2,
  },
  keyActionText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  forgotPinButton: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    alignSelf: 'center',
    maxWidth: 320,
  },
  forgotPinText: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
  },
  biometricButton: {
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricButtonText: {
    ...TYPOGRAPHY.button,
  },
});

export default BiometricGate;
