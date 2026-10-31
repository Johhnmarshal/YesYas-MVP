import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { isValidRecoveryCode } from '@/lib/crypto';
import { createRecoveryCode, verifyRecoveryCode } from '@/lib/key-recovery';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

type Step = 'generating' | 'show' | 'confirming' | 'done' | 'error';

interface RecoveryCodeModalProps {
  visible: boolean;
  userId: string | null;
  /** True when replacing an existing code, which invalidates the old one. */
  replacing?: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

/**
 * Creates a recovery code and makes the user type it back before closing.
 *
 * The re-entry step is the point: a code that was never written down correctly
 * is indistinguishable from no code at all, and the user only finds out on the
 * reinstall where they needed it. Confirming now, while the real key is still
 * on the device, is the only moment a mistake is cheap.
 */
export function RecoveryCodeModal({
  visible,
  userId,
  replacing = false,
  onClose,
  onCreated,
}: RecoveryCodeModalProps) {
  const colors = useThemeColors();
  const [step, setStep] = useState<Step>('generating');
  const [code, setCode] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!userId) return;
    setStep('generating');
    setErrorMessage(null);
    setConfirmInput('');
    try {
      const created = await createRecoveryCode(userId);
      setCode(created);
      setStep('show');
      onCreated?.();
    } catch {
      setStep('error');
      setErrorMessage(
        'We could not create a recovery code. Check your connection and try again.',
      );
    }
  }, [onCreated, userId]);

  useEffect(() => {
    if (visible) {
      void generate();
    } else {
      setCode(null);
      setConfirmInput('');
      setErrorMessage(null);
      setStep('generating');
    }
  }, [generate, visible]);

  const onConfirm = useCallback(async () => {
    if (!userId) return;
    setStep('confirming');
    setErrorMessage(null);
    const ok = await verifyRecoveryCode(userId, confirmInput);
    if (ok) {
      setStep('done');
      return;
    }
    setStep('show');
    setErrorMessage(
      'That does not match the code above. Check each character and try again.',
    );
  }, [confirmInput, userId]);

  const [copied, setCopied] = useState(false);

  /**
   * Clipboard only — deliberately not the share sheet.
   *
   * shareText() would offer the OS share targets, and a recovery code handed
   * to a chat app is a recovery code in someone else's message history. The
   * destination for this is a password manager.
   *
   * This does not weaken the re-entry step below. The code is already
   * `selectable`, so copy and paste was always possible; the button only makes
   * the supported path findable. And pasting from a password manager satisfies
   * what re-entry is actually checking — that the code left this screen intact
   * — better than transcribing 24 characters by hand on a phone, which is the
   * alternative that has produced zero saved codes so far.
   */
  const handleCopyCode = useCallback(async () => {
    if (!code) return;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav?.clipboard?.writeText) {
      setErrorMessage(
        'This device will not let the app copy for you. Select the code above and copy it manually.',
      );
      return;
    }
    try {
      await nav.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setErrorMessage(
        'Copying was blocked. Select the code above and copy it manually.',
      );
    }
  }, [code]);

  const confirmLooksComplete = isValidRecoveryCode(confirmInput);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ScrollView contentContainerStyle={styles.body}>
            {step === 'generating' ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.caption, { color: colors.muted }]}>
                  Creating your recovery code…
                </Text>
              </View>
            ) : null}

            {step === 'error' ? (
              <>
                <Text style={[styles.title, { color: colors.primary }]}>
                  Couldn&apos;t create a code
                </Text>
                <Text style={[styles.text, { color: colors.secondary }]}>
                  {errorMessage}
                </Text>
                <Pressable
                  style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                  onPress={() => void generate()}
                  accessibilityRole="button"
                  accessibilityLabel="Try creating a recovery code again"
                >
                  <Text style={[styles.primaryButtonText, { color: colors.surface }]}>
                    Try again
                  </Text>
                </Pressable>
              </>
            ) : null}

            {step === 'done' ? (
              <>
                <Ionicons
                  name="checkmark-circle"
                  size={40}
                  color={colors.success}
                  style={styles.icon}
                />
                <Text style={[styles.title, { color: colors.primary }]}>
                  Recovery code saved
                </Text>
                <Text style={[styles.text, { color: colors.secondary }]}>
                  You can now sign in on another device, or reinstall YesYas!,
                  without losing your journal or your private notes.
                </Text>
                <Pressable
                  style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close recovery code setup"
                >
                  <Text style={[styles.primaryButtonText, { color: colors.surface }]}>
                    Done
                  </Text>
                </Pressable>
              </>
            ) : null}

            {step === 'show' || step === 'confirming' ? (
              <>
                <Text style={[styles.title, { color: colors.primary }]}>
                  {replacing ? 'Your new recovery code' : 'Your recovery code'}
                </Text>
                <Text style={[styles.text, { color: colors.secondary }]}>
                  Store this in your password manager now. It is the only way to
                  read your journal and private notes on a new device, and we
                  cannot show it to you again or reset it for you.
                  {replacing
                    ? ' Your previous recovery code no longer works.'
                    : ''}
                </Text>

                <View
                  style={[
                    styles.codeBox,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  <Text
                    selectable
                    style={[styles.codeText, { color: colors.text }]}
                    accessibilityLabel={`Recovery code: ${code
                      ?.split('')
                      .join(' ')}`}
                  >
                    {code}
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy the recovery code to the clipboard"
                  onPress={() => void handleCopyCode()}
                  style={({ pressed }) => [
                    styles.copyButton,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.copyButtonText, { color: colors.primary }]}>
                    {copied ? 'Copied — now paste it somewhere safe' : 'Copy code'}
                  </Text>
                </Pressable>

                <Text style={[styles.label, { color: colors.text }]}>
                  Type it back to confirm you saved it
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  placeholderTextColor={colors.muted}
                  value={confirmInput}
                  onChangeText={(next) => {
                    setConfirmInput(next);
                    setErrorMessage(null);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  editable={step === 'show'}
                  accessibilityLabel="Confirm recovery code"
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
                    (!confirmLooksComplete || step === 'confirming') &&
                      styles.buttonDisabled,
                  ]}
                  disabled={!confirmLooksComplete || step === 'confirming'}
                  onPress={() => void onConfirm()}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm recovery code"
                >
                  {step === 'confirming' ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text
                      style={[styles.primaryButtonText, { color: colors.surface }]}
                    >
                      Confirm
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  style={styles.textButton}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close without confirming the recovery code"
                >
                  <Text style={[styles.textButtonLabel, { color: colors.muted }]}>
                    I&apos;ll confirm later
                  </Text>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: '90%',
  },
  body: { padding: SPACING.md, gap: SPACING.xs },
  centered: { alignItems: 'center', gap: SPACING.xs, paddingVertical: SPACING.lg },
  icon: { alignSelf: 'center' },
  title: { ...TYPOGRAPHY.h2 },
  text: { ...TYPOGRAPHY.body },
  label: { ...TYPOGRAPHY.h3, marginTop: SPACING.xs },
  caption: { ...TYPOGRAPHY.caption },
  copyButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  codeBox: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    marginVertical: SPACING.xs,
  },
  codeText: {
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
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
    marginTop: SPACING.xs,
  },
  primaryButtonText: { ...TYPOGRAPHY.button },
  buttonDisabled: { opacity: 0.5 },
  textButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  textButtonLabel: { ...TYPOGRAPHY.caption, fontWeight: '600' },
});
