import {
  type ErrorBoundaryProps,
  type Href,
  Stack,
  router,
  useSegments,
} from 'expo-router';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from '@react-navigation/native';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { BiometricGate } from '@/components/BiometricGate';
import { EncryptionKeyGate } from '@/components/EncryptionKeyGate';
import { installGlobalErrorHandlers, reportError } from '@/lib/error-reporting';
import {
  consumeInitialUrlAuth,
  subscribeToAuthDeepLinks,
  supabase,
} from '@/lib/supabase';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

type OnboardingListener = () => void;
const onboardingListeners = new Set<OnboardingListener>();

/**
 * Notifies the root layout that onboarding has just been completed so route
 * transitions out of `/(app)/onboarding/mode` proceed without a round-trip flash.
 */
export function notifyOnboardingComplete(): void {
  onboardingListeners.forEach((listener) => listener());
}

const consentListeners = new Set<OnboardingListener>();

/**
 * Notifies the root layout that the 18+ confirmation and Terms consent were
 * just saved (app/(app)/onboarding/consent.tsx), so it can move on without
 * refetching the profile.
 */
export function notifyConsentGiven(): void {
  consentListeners.forEach((listener) => listener());
}

interface ProfileStatus {
  onboardingComplete: boolean;
  /** Both age_confirmed_at and terms_accepted_at are recorded. */
  consentGiven: boolean;
}

/**
 * Three outcomes, and the third one matters.
 *
 * `null` means "could not find out" — a network failure, a transient Supabase
 * error, an RLS hiccup. This used to return `false` for those, conflating not
 * knowing with not onboarded, and the router acts on `false` by sending the
 * user to /(app)/onboarding/tone.
 *
 * So a signed-in user with a flaky connection was walked through onboarding
 * again, and step 3 writes tone_preference and content_tier_preference on
 * completion — overwriting settings they had chosen deliberately. The content
 * tier is a consent boundary in this app, so a dropped request could quietly
 * move someone from Sensory to whatever they tapped in a hurry the second
 * time.
 *
 * The router already treats `null` as "do nothing and wait", so the fix is to
 * stop lying to it. A missing row genuinely is `false`: the
 * on_auth_user_created trigger creates a profile at signup, so no row means no
 * onboarding has happened.
 */
async function fetchProfileStatus(userId: string): Promise<ProfileStatus | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_complete, age_confirmed_at, terms_accepted_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return null;
  }
  if (!data) {
    return { onboardingComplete: false, consentGiven: false };
  }
  return {
    onboardingComplete: Boolean(data.onboarding_complete),
    consentGiven: Boolean(data.age_confirmed_at && data.terms_accepted_at),
  };
}

/**
 * Any render error anywhere in the tree lands here instead of a white screen.
 * expo-router uses the ErrorBoundary exported from a layout file.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = useThemeColors();
  useEffect(() => {
    reportError(error, 'render');
  }, [error]);

  return (
    <View style={[styles.errorScreen, { backgroundColor: colors.bg }]}>
      <View style={styles.errorColumn}>
        <Text accessibilityRole="header" style={[styles.errorTitle, { color: colors.text }]}>
          Something went wrong
        </Text>
        <Text style={[styles.errorBody, { color: colors.secondary }]}>
          This screen hit a problem and could not finish loading. Your data is
          safe. Try again, and if it keeps happening, close and reopen YesYas!.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void retry()}
          style={({ pressed }) => [
            styles.errorButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.errorButtonText, { color: colors.onPrimary }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Root layout. Boots the Supabase session listener, checks
 * `public.profiles.onboarding_complete`, and gates navigation between
 * `/(auth)/sign-in`, `/(app)/onboarding/tone`, and `(app)`.
 * Wraps the authenticated `(app)` experience in `<BiometricGate>`.
 */
export default function RootLayout() {
  const colors = useThemeColors();
  const scheme = useColorScheme();
  // Navigator backgrounds follow the app palette. Without this, react-navigation
  // paints its default light grey behind every screen, which showed around the
  // capped content column on desktop web and in dark mode.
  const navigationTheme = useMemo<Theme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    };
  }, [colors, scheme]);
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null,
  );
  // null for onboardingComplete means two different things: not fetched yet,
  // and fetched-but-failed. The loading gate below must keep waiting for the
  // first and give up on the second, or a dropped profile request leaves the
  // user on a spinner for ever.
  const [onboardingCheckFailed, setOnboardingCheckFailed] = useState(false);
  // null until known; false sends the user to the consent screen first.
  const [consentGiven, setConsentGiven] = useState<boolean | null>(null);
  // Set by a passphrase reset link (Supabase's PASSWORD_RECOVERY event).
  const [recoveryPending, setRecoveryPending] = useState(false);
  const segments = useSegments();

  const syncSessionProfile = useCallback(async (uid: string | null) => {
    if (!uid) {
      setUserId(null);
      setOnboardingComplete(null);
      setConsentGiven(null);
      setOnboardingCheckFailed(false);
      return;
    }
    setUserId(uid);
    const status = await fetchProfileStatus(uid);
    setOnboardingCheckFailed(status === null);
    setOnboardingComplete(status ? status.onboardingComplete : null);
    setConsentGiven(status ? status.consentGiven : null);
  }, []);

  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);

  useEffect(() => {
    const listener: OnboardingListener = () => {
      setOnboardingComplete(true);
      setOnboardingCheckFailed(false);
    };
    onboardingListeners.add(listener);
    const consentListener: OnboardingListener = () => {
      setConsentGiven(true);
    };
    consentListeners.add(consentListener);
    return () => {
      onboardingListeners.delete(listener);
      consentListeners.delete(consentListener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryPending(true);
      }
      const uid = session?.user?.id ?? null;
      void syncSessionProfile(uid);
    });

    void (async () => {
      await consumeInitialUrlAuth();
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const uid = data.session?.user?.id ?? null;
      await syncSessionProfile(uid);
      if (mounted) {
        setReady(true);
      }
    })();

    // Magic links that arrive while the app is already running. getInitialURL
    // inside consumeInitialUrlAuth only covers a cold start; on native a link
    // tapped with the app backgrounded comes through as a 'url' event, which
    // is the more common case once somebody has the app open and goes to their
    // mail. No-op on web.
    const unsubscribeDeepLinks = subscribeToAuthDeepLinks();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      unsubscribeDeepLinks();
    };
  }, [syncSessionProfile]);

  useEffect(() => {
    if (!ready) return;

    const segList = segments as readonly string[];
    const inAuthGroup = segList[0] === '(auth)';
    // Privacy Policy, Terms and the 404 page are open to everyone, signed in
    // or not, and never redirected away from.
    const inPublic = segList[0] === '(public)' || segList[0] === '+not-found';
    const inOnboarding = segList[0] === '(app)' && segList[1] === 'onboarding';
    const inConsent = inOnboarding && segList[2] === 'consent';
    const signedIn = userId !== null;

    if (inPublic) {
      return;
    }

    if (!signedIn) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
      return;
    }

    if (onboardingComplete === null || consentGiven === null) {
      return;
    }

    // 18+ and Terms come before everything else, for new accounts and for
    // accounts that onboarded before the consent screen existed.
    if (!consentGiven) {
      if (!inConsent) {
        router.replace('/(app)/onboarding/consent' as Href);
      }
      return;
    }
    if (inConsent) {
      router.replace(
        (onboardingComplete ? '/(app)/home' : '/(app)/onboarding/tone') as Href,
      );
      return;
    }

    if (recoveryPending) {
      setRecoveryPending(false);
      router.replace('/(app)/settings/passphrase?recovery=1' as Href);
      return;
    }

    if (!onboardingComplete) {
      if (!inOnboarding) {
        let cancelled = false;
        void fetchProfileStatus(userId).then((latest) => {
          if (cancelled) return;
          setOnboardingCheckFailed(latest === null);
          if (latest?.onboardingComplete === true) {
            setOnboardingComplete(true);
            if (inAuthGroup) {
              router.replace('/(app)/home');
            }
          } else if (latest?.onboardingComplete === false) {
            router.replace('/(app)/onboarding/tone' as Href);
          }
          // null: the check itself failed. Leave the user where they are
          // rather than send them through onboarding on the strength of a
          // dropped request.
        });
        return () => {
          cancelled = true;
        };
      }
      return;
    }

    if (inAuthGroup) {
      router.replace('/(app)/home');
    }
  }, [ready, userId, onboardingComplete, consentGiven, recoveryPending, segments]);

  // Rendered in both branches on purpose. The static web export renders this
  // tree while `ready` is still false, so a <Head> placed only in the loaded
  // branch never reaches dist/*.html and every page ships an empty <title>.
  const pageHead = (
    <Head>
      <title>YesYas!</title>
    </Head>
  );

  if (
    !ready ||
    (userId !== null &&
      (onboardingComplete === null || consentGiven === null) &&
      !onboardingCheckFailed)
  ) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        {pageHead}
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navigationTheme}>
    <BiometricGate active={userId !== null}>
      {pageHead}
      <EncryptionKeyGate userId={userId}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="(public)" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </EncryptionKeyGate>
    </BiometricGate>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorScreen: {
    flex: 1,
    justifyContent: 'center',
  },
  errorColumn: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  errorTitle: {
    ...TYPOGRAPHY.h1,
  },
  errorBody: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  errorButton: {
    minHeight: 52,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    alignSelf: 'flex-start',
  },
  errorButtonText: {
    ...TYPOGRAPHY.button,
  },
});
