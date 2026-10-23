import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export default function PrivacyModelScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Privacy Model
          </Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Core Guarantee Hero Card */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.heroBadgeRow}>
            <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            <Text style={[styles.heroBadgeText, { color: colors.primary }]}>
              Zero-Deduction Architecture
            </Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.text }]}>
            Our Privacy Guarantee in Plain English
          </Text>
          <Text style={[styles.heroBody, { color: colors.muted }]}>
            YesYas! is engineered so that neither partner can ever read or deduce
            the other’s private ratings, notes, or rejections.
          </Text>
        </View>

        {/* Section 1: What The Server Cannot See */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            🔒 What The Server CANNOT See
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.itemRow}>
              <Ionicons name="lock-closed" size={18} color="#10B981" />
              <View style={styles.itemContent}>
                <Text style={[styles.itemHeader, { color: colors.text }]}>
                  Personal Desire Notes
                </Text>
                <Text style={[styles.itemText, { color: colors.muted }]}>
                  Encrypted on your device with authenticated AES-CTR + HMAC-SHA256
                  (prefixed `enc:v1:`). The server and database only ever store
                  ciphertext bytes.
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.itemRow}>
              <Ionicons name="lock-closed" size={18} color="#10B981" />
              <View style={styles.itemContent}>
                <Text style={[styles.itemHeader, { color: colors.text }]}>
                  Journal Reflections at Rest
                </Text>
                <Text style={[styles.itemText, { color: colors.muted }]}>
                  Stored encrypted with your master key. Reinstalling or switching
                  devices requires your 100-bit recovery code to restore your
                  key.
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.itemRow}>
              <Ionicons name="eye-off" size={18} color="#10B981" />
              <View style={styles.itemContent}>
                <Text style={[styles.itemHeader, { color: colors.text }]}>
                  Individual Numeric Ratings
                </Text>
                <Text style={[styles.itemText, { color: colors.muted }]}>
                  Your 1–5 star ratings are private to you. The double-blind
                  reveal only exposes matching items where both rated 4+, or
                  Curiosity Bridges. Items rated 1 or 2 are permanently omitted
                  without explanation.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Section 2: What The Server Can See */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            👁️ What The Server CAN See
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.itemRow}>
              <Ionicons name="person-circle-outline" size={18} color={colors.primary} />
              <View style={styles.itemContent}>
                <Text style={[styles.itemHeader, { color: colors.text }]}>
                  Account Identity & Pairings
                </Text>
                <Text style={[styles.itemText, { color: colors.muted }]}>
                  Your account email (used for magic-link authentication) and your
                  active pairing identifier.
                </Text>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.itemRow}>
              <Ionicons name="git-commit-outline" size={18} color={colors.primary} />
              <View style={styles.itemContent}>
                <Text style={[styles.itemHeader, { color: colors.text }]}>
                  Consent Audit Events
                </Text>
                <Text style={[styles.itemText, { color: colors.muted }]}>
                  Timestamped records of when you accepted a pairing, triggered a
                  reveal, or consented to an export, chained via SHA-256 hashes.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Section 3: AI Coach Disclosure (R-41 / D-1) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            🤖 Transparent AI Coach Disclosure
          </Text>

          <View
            style={[
              styles.calloutCard,
              { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: '#D97706' },
            ]}
          >
            <Text style={[styles.calloutHeader, { color: colors.text }]}>
              The AI Coach Receives Plaintext During Conversations
            </Text>
            <Text style={[styles.calloutText, { color: colors.muted }]}>
              While your journal entries are encrypted before being stored in the
              database, your message is transmitted in plaintext to the AI model
              over TLS so it can generate reflective responses.
            </Text>
            <Text style={[styles.calloutSubtext, { color: colors.muted }]}>
              • The AI Coach is strictly solo: it never reads your partner’s
              reflections or ratings.{"\n"}
              • Prompts are strictly bounded by intimacy safety rules.{"\n"}
              • You can report any message immediately for safety review.
            </Text>
          </View>
        </View>

        {/* Section 4: Screen Capture & OS Realities (R-13) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            📱 Device Screen Capture Protection
          </Text>

          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.osNote, { color: colors.muted }]}>
              <Text style={{ fontWeight: '700', color: colors.text }}>Android: </Text>
              Screen recording and screenshots are hardware-blocked on reveal and
              journal screens via FLAG_SECURE.{"\n\n"}
              <Text style={{ fontWeight: '700', color: colors.text }}>iOS: </Text>
              Apple does not allow third-party apps to block screenshots at the
              operating system level. YesYas! applies an automated privacy blur
              whenever you switch apps.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 6,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
  },
  headerRightSpacer: {
    width: 44,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
    gap: SPACING.lg,
  },
  heroCard: {
    padding: SPACING.lg,
    borderRadius: RADII.xl,
    borderWidth: 1,
    gap: SPACING.xs,
    ...SHADOWS.subtle,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  heroBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    gap: SPACING.xs + 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginLeft: 4,
  },
  card: {
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    ...SHADOWS.subtle,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    paddingVertical: 6,
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemHeader: {
    fontSize: 13,
    fontWeight: '700',
  },
  itemText: {
    fontSize: 12,
    lineHeight: 17,
  },
  divider: {
    height: 1,
    marginVertical: SPACING.xs + 2,
  },
  calloutCard: {
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderLeftWidth: 4,
    gap: SPACING.xs,
    ...SHADOWS.subtle,
  },
  calloutHeader: {
    fontSize: 13,
    fontWeight: '700',
  },
  calloutText: {
    fontSize: 12,
    lineHeight: 18,
  },
  calloutSubtext: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  osNote: {
    fontSize: 12,
    lineHeight: 18,
  },
});
