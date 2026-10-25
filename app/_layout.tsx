import { type Href, Stack, router, useSegments } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BiometricGate } from '@/components/BiometricGate';
import { EncryptionKeyGate } from '@/components/EncryptionKeyGate';
import {
  consumeInitialUrlAuth,
  subscribeToAuthDeepLinks,
  supabase,
} from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type OnboardingListener = () => void;
const onboardingListeners = new Set<OnboardingListener>();

/**
 * Notifies the root layout that onboarding has just been completed so route
 * transitions out of `/(app)/onboarding/mode` proceed without a round-trip flash.
 */
export function notifyOnboardingComplete(): void {
  onboardingListeners.forEach((listener) => listener());
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
async function fetchProfileOnboardingStatus(
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return null;
  }
  if (!data) {
    return false;
  }
  return Boolean(data.onboarding_complete);
}

/**
 * Root layout. Boots the Supabase session listener, checks
 * `public.profiles.onboarding_complete`, and gates navigation between
 * `/(auth)/sign-in`, `/(app)/onboarding/tone`, and `(app)`.
 * Wraps the authenticated `(app)` experience in `<BiometricGate>`.
 */
export default function RootLayout() {
  const colors = useThemeColors();
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
  const segments = useSegments();

  const syncSessionProfile = useCallback(async (uid: string | null) => {
    if (!uid) {
      setUserId(null);
      setOnboardingComplete(null);
      setOnboardingCheckFailed(false);
      return;
    }
    setUserId(uid);
    const completed = await fetchProfileOnboardingStatus(uid);
    setOnboardingCheckFailed(completed === null);
    setOnboardingComplete(completed);
  }, []);

  useEffect(() => {
    const listener: OnboardingListener = () => {
      setOnboardingComplete(true);
      setOnboardingCheckFailed(false);
    };
    onboardingListeners.add(listener);
    return () => {
      onboardingListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
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
    const inOnboarding = segList[0] === '(app)' && segList[1] === 'onboarding';
    const signedIn = userId !== null;

    if (!signedIn) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
      return;
    }

    if (onboardingComplete === null) {
      return;
    }

    if (!onboardingComplete) {
      if (!inOnboarding) {
        let cancelled = false;
        void fetchProfileOnboardingStatus(userId).then((latestStatus) => {
          if (cancelled) return;
          setOnboardingCheckFailed(latestStatus === null);
          if (latestStatus === true) {
            setOnboardingComplete(true);
            if (inAuthGroup) {
              router.replace('/(app)/home');
            }
          } else if (latestStatus === false) {
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
  }, [ready, userId, onboardingComplete, segments]);

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
    (userId !== null && onboardingComplete === null && !onboardingCheckFailed)
  ) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        {pageHead}
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <BiometricGate active={userId !== null}>
      {pageHead}
      <EncryptionKeyGate userId={userId}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </EncryptionKeyGate>
    </BiometricGate>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
