import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import Head from 'expo-router/head';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LEGAL_IS_DRAFT, LEGAL_LAST_UPDATED } from '@/lib/legal';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

interface LegalPageProps {
  title: string;
  intro: string;
  sections: LegalSection[];
  footer?: ReactNode;
}

/**
 * Shared layout for the Privacy Policy and Terms. Public: reachable signed
 * out, from the sign-in screen and Settings (see app/_layout.tsx).
 */
export function LegalPage({ title, intro, sections, footer }: LegalPageProps) {
  const colors = useThemeColors();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/' as Href);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <Head>
        <title>{`${title} · YesYas!`}</title>
      </Head>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
          </Pressable>

          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.updated, { color: colors.textMuted }]}>
            Last updated {LEGAL_LAST_UPDATED}
          </Text>

          {LEGAL_IS_DRAFT ? (
            <View
              style={[
                styles.draft,
                { backgroundColor: colors.accentWarmSubtle, borderColor: colors.accentWarm },
              ]}
            >
              <Text style={[styles.draftText, { color: colors.text }]}>
                Draft. This document is being reviewed and may change before
                YesYas! opens to the public.
              </Text>
            </View>
          ) : null}

          <Text style={[styles.body, { color: colors.text }]}>{intro}</Text>

          {sections.map((section) => (
            <View key={section.heading} style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { color: colors.text }]}
              >
                {section.heading}
              </Text>
              {section.paragraphs.map((paragraph, index) => (
                <Text
                  key={`${section.heading}-${index}`}
                  style={[styles.body, { color: colors.secondary }]}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}

          {footer}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  column: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  backText: {
    ...TYPOGRAPHY.button,
  },
  title: {
    ...TYPOGRAPHY.h1,
    marginTop: SPACING.xs,
  },
  updated: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.sm,
  },
  draft: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  draftText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  section: {
    marginTop: SPACING.md,
  },
  heading: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.xs,
  },
  body: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.xs,
  },
});

export default LegalPage;
