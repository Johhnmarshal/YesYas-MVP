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

import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export const LOCK_ENABLED_KEY = '@yesyas/lock_enabled';
export const PIN_CODE_KEY = '@yesyas/pin_code';

export interface BiometricSettings {
  enabled: boolean;
  hasPin: boolean;
  pin: string | null;
}

/**
 * Reads device biometric/PIN lock preferences from AsyncStorage.
 */
export async function getBiometricSettings(): Promise<BiometricSettings> {
  try {
    const [enabledRaw, pinRaw] = await Promise.all([
      AsyncStorage.getItem(LOCK_ENABLED_KEY),
      AsyncStorage.getItem(PIN_CODE_KEY),
    ]);
    const validPin = pinRaw && /^\d{6}$/.test(pinRaw) ? pinRaw : null;
    return {
      enabled: enabledRaw === 'true',
      hasPin: validPin !== null,
      pin: validPin,
    };
  } catch {
    return {
      enabled: false,
      hasPin: false,
      pin: null,
    };
  }
}

/**
 * Persists device biometric/PIN lock preferences in AsyncStorage.
 */
export async function saveBiometricSettings(
  enabled: boolean,
  pin?: string,
): Promise<void> {
  if (!enabled) {
    await AsyncStorage.setItem(LOCK_ENABLED_KEY, 'false');
    if (pin === '') {
      await AsyncStorage.removeItem(PIN_CODE_KEY);
    }
    return;
  }

  if (pin !== undefined) {
    const trimmed = pin.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      throw new Error('PIN must be a 6-digit number.');
    }
    await AsyncStorage.setItem(PIN_CODE_KEY, trimmed);
  } else {
    const existingPin = await AsyncStorage.getItem(PIN_CODE_KEY);
    if (!existingPin || !/^\d{6}$/.test(existingPin)) {
      throw new Error('Cannot enable lock without configuring a PIN.');
    }
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
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const wasInBackgroundRef = useRef(false);

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
        setLocked(false);
        setPinInput('');
        setErrorMessage(null);
      }
    } catch {
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
    setStoredPin(settings.pin);

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
          if (storedPin && next === storedPin) {
            setLocked(false);
            setErrorMessage(null);
            return '';
          }
          setErrorMessage('Incorrect PIN. Please try again.');
          return '';
        }
        setErrorMessage(null);
        return next;
      });
    },
    [storedPin],
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
                onPress={() => void triggerBiometricPrompt()}
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
    borderRadius: 12,
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
  biometricButton: {
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricButtonText: {
    ...TYPOGRAPHY.button,
  },
});

export default BiometricGate;
