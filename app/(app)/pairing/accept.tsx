import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type PairingInvitePreview,
  acceptPairingInvite,
  describePairingError,
  previewPairingInvite,
} from '@/lib/pairing';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

function sanitizeCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function formatExpiryLabel(expiresAtIso: string): string {
  const parsed = new Date(expiresAtIso);
  if (Number.isNaN(parsed.getTime())) {
    return 'Valid for 48 hours';
  }
  const diffMs = parsed.getTime() - Date.now();
  if (diffMs <= 0) {
    return 'Expired';
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `Expires in ${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Partner Invite Preview & Acceptance screen (`/(app)/pairing/accept`).
 * Supports deep-link `?code=XXXX` or manual 8-character uppercase code input,
 * previews the inviter's display name and expiry via `previewPairingInvite(code)`,
 * and atomically accepts the pairing via `acceptPairingInvite(code)`.
 */
export default function PairingAcceptScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ code?: string }>();

  const initialCode = sanitizeCodeInput(
    Array.isArray(params.code) ? params.code[0] ?? '' : params.code ?? '',
  );

  const [code, setCode] = useState<string>(initialCode);
  const [preview, setPreview] = useState<PairingInvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [accepting, setAccepting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePreviewCode = useCallback(async (targetCode: string) => {
    const normalized = sanitizeCodeInput(targetCode);
    if (normalized.length < 8) {
      setErrorMessage('Please enter all 8 characters of your partner’s invite code.');
      setPreview(null);
      return;
    }

    setPreviewLoading(true);
    setErrorMessage(null);
    setPreview(null);

    try {
      const result = await previewPairingInvite(normalized);
      if (!result) {
        setErrorMessage(
          'This invite code is invalid, expired, or has already been claimed.',
        );
      } else {
        setPreview(result);
      }
    } catch (err) {
      setErrorMessage(
        describePairingError(
          err,
          'Could not verify this invite code. Please check your connection and try again.',
        ),
      );
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialCode.length === 8) {
      setCode(initialCode);
      void handlePreviewCode(initialCode);
    }
  }, [handlePreviewCode, initialCode]);

  const handleCodeChange = useCallback((nextText: string) => {
    const cleaned = sanitizeCodeInput(nextText);
    setCode(cleaned);
    setPreview(null);
    setErrorMessage(null);
  }, []);

  const handleAcceptInvite = useCallback(async () => {
    const normalized = sanitizeCodeInput(code);
    if (normalized.length < 8 || accepting) return;

    setAccepting(true);
    setErrorMessage(null);

    try {
      await acceptPairingInvite(normalized);
      router.replace('/(app)/home' as Href);
    } catch (err) {
      setErrorMessage(
        describePairingError(
          err,
          'Could not accept this invite. Please verify the code and try again.',
        ),
      );
      setAccepting(false);
    }
  }, [accepting, code]);

  const isBusy = previewLoading || accepting;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          disabled={isBusy}
          onPress={() => router.replace('/(app)/home' as Href)}
          style={({ pressed }) => [
            styles.backButton,
            { opacity: pressed || isBusy ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text style={[styles.backButtonText, { color: colors.primary }]}>
            Home
          </Text>
        </Pressable>

        <Text style={[styles.screenTitle, { color: colors.primary }]}>
          Enter partner’s code
        </Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          Preview your partner’s invite before confirming. Pairing carries over
          your solo ratings while keeping individual scores strictly private.
        </Text>

        {/* Code Input Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.inputLabel, { color: colors.secondary }]}>
            8-CHARACTER INVITE CODE
          </Text>

          <TextInput
            value={code}
            onChangeText={handleCodeChange}
            placeholder="E.G. 7K9M2P4X"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            editable={!isBusy}
            accessibilityLabel="8-character partner invite code input"
            style={[
              styles.codeInput,
              {
                backgroundColor: colors.bg,
                borderColor: preview ? colors.success : colors.border,
                color: colors.primary,
              },
            ]}
          />

          <Text style={[styles.charCounter, { color: colors.muted }]}>
            {code.length} / 8 characters
          </Text>

          {!preview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview Invite"
              disabled={isBusy || code.length < 8}
              onPress={() => void handlePreviewCode(code)}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor:
                    code.length === 8 ? colors.primary : colors.muted,
                  opacity: pressed || isBusy ? 0.8 : 1,
                },
              ]}
            >
              {previewLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="search-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Preview Invite</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

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
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.error}
            />
            <Text style={[styles.errorText, { color: colors.error }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {/* Invite Preview & Confirmation Card */}
        {preview ? (
          <View
            style={[
              styles.previewCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentWarm,
              },
            ]}
          >
            <View style={styles.previewBadgeRow}>
              <View
                style={[
                  styles.verifiedPill,
                  { backgroundColor: colors.success },
                ]}
              >
                <Text style={styles.verifiedPillText}>VALID INVITE</Text>
              </View>
              <Text style={[styles.expiryText, { color: colors.secondary }]}>
                ⏳ {formatExpiryLabel(preview.expires_at)}
              </Text>
            </View>

            <Text style={[styles.previewTitle, { color: colors.primary }]}>
              You’ve been invited to pair with {preview.inviter_display_name}
            </Text>

            <View
              style={[
                styles.reassuranceBox,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.reassuranceText, { color: colors.secondary }]}
              >
                🔒 Accepting pairs your accounts for Double-Blind Reveals,
                graduates your solo Desire Library ratings into this pairing,
                and logs a tamper-evident{' '}
                <Text style={styles.boldText}>pairing_accepted</Text> consent
                event for both of you.
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Confirm & Pair with ${preview.inviter_display_name}`}
              disabled={accepting}
              onPress={() => void handleAcceptInvite()}
              style={({ pressed }) => [
                styles.confirmButton,
                {
                  backgroundColor: colors.accentWarm,
                  opacity: pressed || accepting ? 0.85 : 1,
                },
              ]}
            >
              {accepting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name="heart-circle-outline"
                    size={22}
                    color="#FFFFFF"
                  />
                  <Text style={styles.confirmButtonText}>Confirm & Pair</Text>
                </>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decline invite and return to Home"
              disabled={accepting}
              onPress={() => router.replace('/(app)/home' as Href)}
              style={({ pressed }) => [
                styles.secondaryActionButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.secondaryActionText,
                  { color: colors.secondary },
                ]}
              >
                Decline & return to Home
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Switch to Create Invite Code Flow */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Need to invite your partner instead? Create an invite code"
          disabled={isBusy}
          onPress={() => router.push('/(app)/pairing/invite' as Href)}
          style={({ pressed }) => [
            styles.switchFlowCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: pressed || isBusy ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.switchFlowTextBlock}>
            <Text style={[styles.switchFlowTitle, { color: colors.primary }]}>
              Need to create an invite code instead?
            </Text>
            <Text
              style={[styles.switchFlowSubtitle, { color: colors.secondary }]}
            >
              Generate your own 8-character code to share with your partner
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.secondary}
          />
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
    paddingBottom: SPACING.xl,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
    gap: 6,
    marginBottom: SPACING.xs,
  },
  backButtonText: {
    ...TYPOGRAPHY.button,
  },
  screenTitle: {
    ...TYPOGRAPHY.h1,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.md,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  inputLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  codeInput: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  charCounter: {
    ...TYPOGRAPHY.caption,
    textAlign: 'right',
    marginTop: 6,
    marginBottom: SPACING.sm,
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
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    flex: 1,
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: 2,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  previewBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  verifiedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  verifiedPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  expiryText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  previewTitle: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.sm,
  },
  reassuranceBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  reassuranceText: {
    ...TYPOGRAPHY.caption,
    lineHeight: 20,
  },
  boldText: {
    fontWeight: '700',
  },
  confirmButton: {
    minHeight: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  confirmButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  secondaryActionButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryActionText: {
    ...TYPOGRAPHY.button,
  },
  switchFlowCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 68,
  },
  switchFlowTextBlock: {
    flex: 1,
    paddingRight: SPACING.xs,
  },
  switchFlowTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: 2,
  },
  switchFlowSubtitle: {
    ...TYPOGRAPHY.caption,
  },
});
