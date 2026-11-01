import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import Head from 'expo-router/head';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

/**
 * Any URL the app does not know. On the web build this is also exported as
 * dist/404.html (see vercel.json), so Vercel serves it instead of its own
 * generic page with a debug request id.
 */
export default function NotFoundScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <Head>
        <title>Page not found · YesYas!</title>
      </Head>
      <View style={styles.column}>
        <Ionicons name="compass-outline" size={40} color={colors.accentWarm} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          This page does not exist
        </Text>
        <Text style={[styles.body, { color: colors.secondary }]}>
          The link may be old or mistyped. Nothing private is lost: your data is
          where you left it.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to YesYas home"
          onPress={() => router.replace('/' as Href)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
            Go to YesYas!
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    justifyContent: 'center',
  },
  column: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: SPACING.md,
    alignItems: 'flex-start',
    gap: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h1,
  },
  body: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  button: {
    minHeight: 52,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  buttonText: {
    ...TYPOGRAPHY.button,
  },
});
