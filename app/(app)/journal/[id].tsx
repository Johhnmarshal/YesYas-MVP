import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type JournalEntryWithBody,
  deleteJournalEntry,
  fetchJournalEntryById,
} from '@/lib/journal';
import {
  SCREEN_CAPTURE_KEYS,
  useScreenCaptureProtection,
} from '@/lib/screen-capture';
import { PrivacyShield } from '@/components/PrivacyShield';
import { confirm, showMessage } from '@/lib/alert';
import { shareText } from '@/lib/share';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export default function JournalDetailScreen() {
  const colors = useThemeColors();
  useScreenCaptureProtection(SCREEN_CAPTURE_KEYS.journalEntry);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<JournalEntryWithBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadEntry = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setErrorMsg('Authentication required to read encrypted entries');
        return;
      }

      const row = await fetchJournalEntryById(user.id, id);
      if (!row) {
        setErrorMsg('Entry not found or already deleted');
        return;
      }
      setEntry(row);
    } catch (err) {
      console.warn('Error loading journal entry:', err);
      setErrorMsg('Could not decrypt journal entry on this device.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  async function handleDelete() {
    if (!entry) return;

    const confirmed = await confirm({
      title: 'Delete Reflection?',
      message:
        'Are you sure you want to permanently delete this journal entry? This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      setDeleting(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;
      await deleteJournalEntry(user.id, entry.id);
      router.back();
    } catch (err) {
      showMessage(
        'Delete Failed',
        err instanceof Error ? err.message : 'Could not delete entry.',
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleShare() {
    if (!entry || entry.bodyState !== 'ok') return;
    const outcome = await shareText({
      message: entry.body,
      title: 'My YesYas Reflection',
    });
    if (outcome === 'copied') {
      showMessage('Copied', 'The reflection is on your clipboard.');
    } else if (outcome === 'unavailable') {
      showMessage(
        'Could not share',
        'This browser cannot share or copy automatically. Select the text and copy it manually.',
      );
    }
  }

  function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

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
          accessibilityLabel="Back to Journal"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Reflection Entry
          </Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={handleShare}
            disabled={!entry || loading}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Export or share this entry"
            style={styles.actionIconButton}
          >
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </Pressable>

          <Pressable
            onPress={handleDelete}
            disabled={!entry || deleting || loading}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete this entry"
            style={styles.actionIconButton}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Encryption Assurance Badge */}
        <View
          style={[
            styles.badge,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="lock-closed" size={14} color={colors.primary} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            🔒 Private to you — decrypted on device
          </Text>
        </View>

        {loading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.textMuted }]}>
              Decrypting entry...
            </Text>
          </View>
        ) : errorMsg ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
            <Text style={[styles.errorTitle, { color: colors.text }]}>
              Entry Unavailable
            </Text>
            <Text style={[styles.errorBody, { color: colors.textMuted }]}>
              {errorMsg}
            </Text>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back to Journal"
              style={[
                styles.returnButton,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[styles.returnButtonText, { color: colors.onPrimary }]}>Back to Journal</Text>
            </Pressable>
          </View>
        ) : entry ? (
          <View
            style={[
              styles.entryCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.timestampRow}>
              <Ionicons
                name="calendar-outline"
                size={14}
                color={colors.textMuted}
              />
              <Text style={[styles.timestampText, { color: colors.textMuted }]}>
                {formatTimestamp(entry.created_at)}
              </Text>
            </View>

            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />

            {entry.bodyState === 'ok' ? (
              <Text style={[styles.entryBody, { color: colors.text }]}>
                {entry.body}
              </Text>
            ) : (
              <Text style={[styles.entryBody, { color: colors.textMuted }]}>
                {entry.bodyState === 'locked'
                  ? 'This entry is still encrypted because this device has no key for it. Close and reopen YesYas! to enter your recovery code.'
                  : 'This entry can no longer be decrypted on this account.'}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      <PrivacyShield
        message="This reflection is hidden while the app is in the background."
      />
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
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  actionIconButton: {
    padding: 6,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  entryCard: {
    padding: SPACING.lg,
    borderRadius: 16,
    borderWidth: 1,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm,
  },
  timestampText: {
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginBottom: SPACING.md,
  },
  entryBody: {
    fontSize: TYPOGRAPHY.body.fontSize + 1,
    lineHeight: 26,
  },
  stateContainer: {
    paddingVertical: SPACING.xl * 2,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stateText: {
    fontSize: TYPOGRAPHY.caption.fontSize,
  },
  errorCard: {
    padding: SPACING.xl,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  errorTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  errorBody: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  returnButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  returnButtonText: {
    fontWeight: '600',
  },
});
