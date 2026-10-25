import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type PairingInviteResult,
  createPairingInvite,
  describePairingError,
  getActiveOrPendingPairing,
} from '@/lib/pairing';
import { showMessage } from '@/lib/alert';
import { shareText } from '@/lib/share';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

function formatCountdown48h(expiresAtIso: string, nowMs: number): string {
  const targetMs = new Date(expiresAtIso).getTime();
  if (Number.isNaN(targetMs)) {
    return '48h 00m remaining';
  }
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return 'Expired';
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m remaining`;
}

/**
 * Partner Invite Creation screen (`/(app)/pairing/invite`).
 * Generates or displays an active 8-character invite code with a 48-hour
 * expiration countdown, one-tap copy, native system share sheet (`yesyasapp://pair?code=XXXX`),
 * and navigation to `/(app)/pairing/accept` or `/(app)/home`.
 */
export default function PairingInviteScreen() {
  const colors = useThemeColors();

  const [invite, setInvite] = useState<PairingInviteResult | null>(null);
  const [alreadyPairedPartner, setAlreadyPairedPartner] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const initializeInvite = useCallback(async (forceNew = false) => {
    if (forceNew) {
      setRegenerating(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    setCopied(false);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = authData.user;
      if (!user) {
        throw new Error('Please sign in to create a partner invite.');
      }

      if (!forceNew) {
        const existing = await getActiveOrPendingPairing(user.id);
        if (
          existing &&
          (existing.status === 'active' || existing.status === 'paused')
        ) {
          setAlreadyPairedPartner(
            existing.partner_display_name ?? 'your partner',
          );
          setInvite(null);
          return;
        }

        if (
          existing &&
          existing.status === 'pending' &&
          existing.invite_code &&
          existing.invite_expires_at &&
          new Date(existing.invite_expires_at).getTime() > Date.now()
        ) {
          setAlreadyPairedPartner(null);
          setInvite({
            pairing_id: existing.id,
            invite_code: existing.invite_code,
            expires_at: existing.invite_expires_at,
          });
          return;
        }
      }

      const created = await createPairingInvite();
      setAlreadyPairedPartner(null);
      setInvite(created);
      setNowMs(Date.now());
    } catch (err) {
      setErrorMessage(
        describePairingError(err, 'Could not generate an invite code. Please try again.'),
      );
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, []);

  useEffect(() => {
    void initializeInvite(false);
  }, [initializeInvite]);

  const handleCopyCode = useCallback(async () => {
    if (!invite?.invite_code) return;
    const outcome = await shareText({ message: invite.invite_code });
    if (outcome === 'unavailable') {
      // Previously this branch was a silent catch, so the "Copied!" state
      // simply never arrived and the button looked broken.
      showMessage(
        'Could not copy',
        `This browser blocked the clipboard. Your code is ${invite.invite_code} — write it down or select it on screen.`,
      );
      return;
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 3000);
  }, [invite?.invite_code]);

  const handleShareInvite = useCallback(async () => {
    if (!invite?.invite_code) return;
    const code = invite.invite_code;

    // The link has to match the platform. `yesyasapp://` only resolves where
    // the native app is installed, and the beta runs on the web — so the old
    // message handed every web tester a scheme their device has nothing
    // registered for, which opens nothing and reports nothing.
    const link =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}/pairing/accept?code=${encodeURIComponent(code)}`
        : `yesyasapp://pairing/accept?code=${encodeURIComponent(code)}`;

    // The code leads, because the code always works. The link needs the
    // recipient to be signed in already: the accept screen sits inside the
    // (app) group behind auth, and the root layout's redirect to
    // /(auth)/sign-in does not carry the query parameter through. Someone
    // signed out follows the link, lands on sign-in, and arrives with no code
    // — so they need to have it in front of them regardless.
    const message = `Join me on YesYas! My private invite code is ${code} — enter it on the "Join your partner" screen within 48 hours. Already signed in? This opens it directly: ${link}`;

    const outcome = await shareText({
      title: 'Pair with me on YesYas!',
      message,
    });

    if (outcome === 'copied') {
      showMessage(
        'Invite copied',
        'The invitation is on your clipboard — paste it into a message to your partner.',
      );
    } else if (outcome === 'unavailable') {
      showMessage(
        'Could not share',
        `This browser cannot share or copy automatically. Send your partner this code: ${code}`,
      );
    }
  }, [invite?.invite_code]);

  const countdownLabel = invite
    ? formatCountdown48h(invite.expires_at, nowMs)
    : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Back Navigation */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          onPress={() => router.replace('/(app)/home' as Href)}
          style={({ pressed }) => [
            styles.backButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.primary} />
          <Text style={[styles.backButtonText, { color: colors.primary }]}>
            Home
          </Text>
        </Pressable>

        <Text style={[styles.screenTitle, { color: colors.primary }]}>
          Invite your partner
        </Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          Share this one-time 8-character code with your partner. Once they
          accept, your solo ratings carry over automatically.
        </Text>

        {/* Loading state */}
        {loading ? (
          <View
            style={[
              styles.card,
              styles.centeredCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.secondary }]}>
              Preparing your private invite code…
            </Text>
          </View>
        ) : null}

        {/* Error state */}
        {!loading && errorMessage ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
              },
            ]}
          >
            <Text style={[styles.errorTitle, { color: colors.error }]}>
              Unable to create invite code
            </Text>
            <Text
              style={[styles.errorDescription, { color: colors.secondary }]}
            >
              {errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry generating invite code"
              onPress={() => void initializeInvite(true)}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Already Paired state */}
        {!loading && !errorMessage && alreadyPairedPartner ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentCool,
              },
            ]}
          >
            <Text style={[styles.alreadyPairedTitle, { color: colors.primary }]}>
              💑 You are already paired with {alreadyPairedPartner}
            </Text>
            <Text
              style={[styles.errorDescription, { color: colors.secondary }]}
            >
              Only one active pairing is allowed at a time. You can manage or
              pause your current pairing from the Home dashboard.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to Home dashboard"
              onPress={() => router.replace('/(app)/home' as Href)}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Go to Home</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Active Pending Invite Card */}
        {!loading && !errorMessage && invite ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.codeLabel, { color: colors.secondary }]}>
              YOUR 8-CHARACTER INVITE CODE
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Invite code ${invite.invite_code}. Tap to copy`}
              onPress={() => void handleCopyCode()}
              style={({ pressed }) => [
                styles.codeDisplayBox,
                {
                  backgroundColor: colors.bg,
                  borderColor: copied ? colors.success : colors.accentWarm,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                selectable
                style={[styles.codeText, { color: colors.primary }]}
              >
                {invite.invite_code}
              </Text>
              <Text
                style={[
                  styles.tapToCopyHint,
                  { color: copied ? colors.success : colors.secondary },
                ]}
              >
                {copied ? '✓ Code copied!' : 'Tap code to copy'}
              </Text>
            </Pressable>

            <View style={styles.countdownRow}>
              <Ionicons
                name="time-outline"
                size={16}
                color={colors.accentCool}
              />
              <Text
                style={[styles.countdownText, { color: colors.secondary }]}
              >
                ⏳ Valid for 48 hours · {countdownLabel}
              </Text>
            </View>

            <View style={styles.buttonGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share invite link with partner"
                onPress={() => void handleShareInvite()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Share Invite</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy 8-character invite code"
                onPress={() => void handleCopyCode()}
                style={({ pressed }) => [
                  styles.outlineButton,
                  {
                    borderColor: colors.primary,
                    backgroundColor: colors.bg,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={copied ? 'checkmark-circle' : 'copy-outline'}
                  size={18}
                  color={copied ? colors.success : colors.primary}
                />
                <Text
                  style={[
                    styles.outlineButtonText,
                    { color: copied ? colors.success : colors.primary },
                  ]}
                >
                  {copied ? 'Copied!' : 'Copy Code'}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Generate a new invite code"
                disabled={regenerating}
                onPress={() => void initializeInvite(true)}
                style={({ pressed }) => [
                  styles.regenerateButton,
                  { opacity: pressed || regenerating ? 0.65 : 1 },
                ]}
              >
                {regenerating ? (
                  <ActivityIndicator size="small" color={colors.secondary} />
                ) : (
                  <Text
                    style={[
                      styles.regenerateButtonText,
                      { color: colors.secondary },
                    ]}
                  >
                    Rotate / Generate New Code
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Privacy Reassurance Card */}
        <View
          style={[
            styles.privacyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.privacyTitle, { color: colors.primary }]}>
            🔒 What happens when you pair?
          </Text>
          <Text style={[styles.privacyBody, { color: colors.secondary }]}>
            • Your existing solo Desire Library ratings carry over automatically.
            {'\n'}• Your partner never sees your raw 1–5 scores or encrypted
            notes.
            {'\n'}• Only mutual matches (both rated 4 or 5) surface when you
            both opt into a Double-Blind Reveal.
          </Text>
        </View>

        {/* Switch to Accept Code Flow */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Have a partner's code? Enter it here"
          onPress={() => router.push('/(app)/pairing/accept' as Href)}
          style={({ pressed }) => [
            styles.switchFlowCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.accentCool,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.switchFlowTextBlock}>
            <Text style={[styles.switchFlowTitle, { color: colors.primary }]}>
              Have a partner’s code?
            </Text>
            <Text
              style={[styles.switchFlowSubtitle, { color: colors.secondary }]}
            >
              Enter their 8-character code to preview and accept
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.accentCool}
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
  centeredCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    textAlign: 'center',
  },
  errorTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
  },
  alreadyPairedTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
  },
  errorDescription: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.md,
  },
  codeLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  codeDisplayBox: {
    borderRadius: 12,
    borderWidth: 2,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  codeText: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 38,
    letterSpacing: 4,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  tapToCopyHint: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    marginTop: 6,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: SPACING.md,
  },
  countdownText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  buttonGroup: {
    gap: SPACING.xs,
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
  outlineButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  outlineButtonText: {
    ...TYPOGRAPHY.button,
  },
  regenerateButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  regenerateButtonText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  privacyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  privacyTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
  },
  privacyBody: {
    ...TYPOGRAPHY.caption,
    lineHeight: 20,
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
