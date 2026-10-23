import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CONSENT_EVENT_LABELS,
  type ConsentEventRow,
  fetchConsentEvents,
  verifyConsentChain,
} from '@/lib/consent';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export default function ConsentAuditScreen() {
  const colors = useThemeColors();
  const [events, setEvents] = useState<ConsentEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;
      const data = await fetchConsentEvents(user.id);
      setEvents(data);
    } catch (err) {
      console.warn('Failed to fetch consent events:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadEvents();
    }, [loadEvents]),
  );

  const verificationResult = verifyConsentChain(events);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function truncateHash(hash: string | null): string {
    if (!hash) return 'null (chain root)';
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  }

  function formatEventDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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
          accessibilityLabel="Back to Settings"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Consent Audit Trail
          </Text>
        </View>
        <Pressable
          onPress={() => void loadEvents()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Refresh audit log"
          style={styles.refreshButton}
        >
          <Ionicons name="refresh" size={20} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerComponent}>
            {/* Verification Badge */}
            <View
              style={[
                styles.verificationCard,
                {
                  backgroundColor: verificationResult.valid
                    ? '#10B98115'
                    : '#EF444415',
                  borderColor: verificationResult.valid ? '#10B981' : '#EF4444',
                },
              ]}
            >
              <Ionicons
                name={
                  verificationResult.valid
                    ? 'shield-checkmark'
                    : 'alert-circle'
                }
                size={24}
                color={verificationResult.valid ? '#10B981' : '#EF4444'}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.verificationTitle,
                    {
                      color: verificationResult.valid ? '#10B981' : '#EF4444',
                    },
                  ]}
                >
                  {verificationResult.valid
                    ? 'Cryptographic Hash-Chain Verified'
                    : 'Audit Chain Integrity Failure'}
                </Text>
                <Text
                  style={[styles.verificationSubtitle, { color: colors.muted }]}
                >
                  {verificationResult.valid
                    ? 'All consent records form an unbroken, tamper-evident SHA-256 chain.'
                    : `Discrepancy detected at event ID: ${verificationResult.brokenAtId}`}
                </Text>
              </View>
            </View>

            <Text style={[styles.sectionHeading, { color: colors.muted }]}>
              {events.length} RECORDED CONSENT EVENT
              {events.length === 1 ? '' : 'S'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              style={{ marginVertical: SPACING.xl }}
            />
          ) : (
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name="document-text-outline"
                size={36}
                color={colors.muted}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No Consent Events Yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                When you accept a pairing, trigger a reveal, or consent to an
                export, a tamper-evident audit record is permanently appended
                here.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => {
          const isExpanded = expandedIds.has(item.id);
          const label =
            CONSENT_EVENT_LABELS[item.event_type] ?? item.event_type;

          return (
            <View
              style={[
                styles.eventCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.eventCardHeader}>
                <View style={styles.eventIndexBadge}>
                  <Text style={[styles.eventIndexText, { color: colors.muted }]}>
                    #{index + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, { color: colors.text }]}>
                    {label}
                  </Text>
                  <Text style={[styles.eventDate, { color: colors.muted }]}>
                    {formatEventDate(item.created_at)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => toggleExpand(item.id)}
                  hitSlop={8}
                  style={styles.expandButton}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isExpanded
                      ? 'Collapse payload details'
                      : 'Expand payload details'
                  }
                >
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              </View>

              {/* Hash information */}
              <View style={styles.hashContainer}>
                <View style={styles.hashRow}>
                  <Text style={[styles.hashLabel, { color: colors.muted }]}>
                    Payload Hash:
                  </Text>
                  <Text
                    style={[
                      styles.hashValue,
                      { color: colors.text, backgroundColor: colors.bg },
                    ]}
                  >
                    {truncateHash(item.payload_hash)}
                  </Text>
                </View>
                <View style={styles.hashRow}>
                  <Text style={[styles.hashLabel, { color: colors.muted }]}>
                    Prev Hash:
                  </Text>
                  <Text
                    style={[
                      styles.hashValue,
                      { color: colors.text, backgroundColor: colors.bg },
                    ]}
                  >
                    {truncateHash(item.prev_hash)}
                  </Text>
                </View>
              </View>

              {/* Expanded Payload view */}
              {isExpanded && (
                <View
                  style={[
                    styles.payloadContainer,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.payloadTitle, { color: colors.muted }]}>
                    RAW EVENT METADATA (IMMUTABLE):
                  </Text>
                  <Text
                    style={[styles.payloadCode, { color: colors.text }]}
                    selectable
                  >
                    {JSON.stringify(
                      {
                        id: item.id,
                        user_id: item.user_id,
                        pairing_id: item.pairing_id,
                        event_type: item.event_type,
                        payload: item.payload,
                        created_at: item.created_at,
                      },
                      null,
                      2,
                    )}
                  </Text>
                </View>
              )}
            </View>
          );
        }}
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
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
  },
  refreshButton: {
    padding: 6,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
    gap: SPACING.sm,
  },
  headerComponent: {
    marginBottom: SPACING.sm,
  },
  verificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  verificationTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  verificationSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  eventCard: {
    padding: SPACING.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  eventCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  eventIndexBadge: {
    paddingTop: 2,
  },
  eventIndexText: {
    fontSize: 12,
    fontWeight: '700',
  },
  eventTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  eventDate: {
    fontSize: 12,
    marginTop: 2,
  },
  expandButton: {
    padding: 4,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hashContainer: {
    marginTop: SPACING.sm,
    gap: 4,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hashLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  hashValue: {
    fontSize: 11,
    fontFamily: 'monospace',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  payloadContainer: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: 8,
    borderWidth: 1,
  },
  payloadTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  payloadCode: {
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  emptyCard: {
    padding: SPACING.xl,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  emptyTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    textAlign: 'center',
    lineHeight: 18,
  },
});
