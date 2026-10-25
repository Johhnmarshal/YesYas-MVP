import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

interface PrivacyShieldProps {
  /** One line saying what is hidden, in the words of the screen using it. */
  message: string;
}

/**
 * Opaque overlay shown whenever the app is not in the foreground.
 *
 * The Privacy Model screen promises "an automated privacy blur whenever you
 * switch apps", because iOS does not let a third-party app block screenshots
 * and the app-switcher snapshot is the exposure that remains. That promise was
 * only ever kept on the reveal screen, which had this overlay inline. The
 * journal screens — the other surface the screen-capture helper protects, and
 * the one holding free-text entries about someone's intimate life — had
 * nothing, so their contents sat unobscured in the iOS app switcher while the
 * app's own privacy documentation said otherwise.
 *
 * Opaque rather than an actual blur, which is both stronger and avoids a
 * dependency: expo-blur is not installed, and blurred text can sometimes still
 * be recovered.
 *
 * This helps on the web build too. react-native-web implements AppState over
 * document visibility, so switching browser tabs hides the content — which is
 * the only screen-privacy measure available there at all, since nothing on the
 * web can block a screenshot.
 */
export function PrivacyShield({ message }: PrivacyShieldProps) {
  const colors = useThemeColors();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // 'inactive' matters as much as 'background': on iOS it is the state
      // during the app-switcher transition, which is exactly the snapshot
      // being guarded against.
      setActive(next !== 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);

  if (!active) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        styles.overlay,
        { backgroundColor: colors.bg },
      ]}
      accessibilityRole="alert"
      accessibilityLabel="Content hidden while the app is in the background"
    >
      <Ionicons name="lock-closed" size={36} color={colors.primary} />
      <Text style={[styles.title, { color: colors.primary }]}>
        YesYas! Privacy Shield
      </Text>
      <Text style={[styles.subtitle, { color: colors.secondary }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    gap: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    textAlign: 'center',
  },
});
