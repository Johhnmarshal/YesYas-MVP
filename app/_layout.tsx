import { type Href, Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BiometricGate } from '@/components/BiometricGate';
import { EncryptionKeyGate } from '@/components/EncryptionKeyGate';
import { consumeInitialUrlAuth, supabase } from '@/lib/supabase';
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

async function fetchProfileOnboardingStatus(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
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
  const segments = useSegments();

  const syncSessionProfile = useCallback(async (uid: string | null) => {
    if (!uid) {
      setUserId(null);
      setOnboardingComplete(null);
      return;
    }
    setUserId(uid);
    const completed = await fetchProfileOnboardingStatus(uid);
    setOnboardingComplete(completed);
  }, []);

  useEffect(() => {
    const listener: OnboardingListener = () => {
      setOnboardingComplete(true);
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

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
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
          if (latestStatus) {
            setOnboardingComplete(true);
            if (inAuthGroup) {
              router.replace('/(app)/home');
            }
          } else {
            router.replace('/(app)/onboarding/tone' as Href);
          }
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

  if (!ready || (userId !== null && onboardingComplete === null)) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <BiometricGate active={userId !== null}>
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
