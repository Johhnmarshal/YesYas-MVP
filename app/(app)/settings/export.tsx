import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
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
  type PairingWithPartner,
  fetchActivePairings,
  getActiveOrPendingPairing,
} from '@/lib/pairing';
import { showMessage } from '@/lib/alert';
import { shareText } from '@/lib/share';
import { fetchPairReveals, requestTherapistExport } from '@/lib/reveal';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export default function TherapistExportScreen() {
  const colors = useThemeColors();
  const [userId, setUserId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingWithPartner | null>(null);
  const [loading, setLoading] = useState(true);

  // Export & Consent State
  const [callerConsented, setCallerConsented] = useState(false);
  const [bothConsented, setBothConsented] = useState(false);
  const [submittingConsent, setSubmittingConsent] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);

  const loadExportState = useCallback(async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;
      setUserId(user.id);

      const activePairings = await fetchActivePairings(user.id);
      const currentPairing =
        activePairings[0] ?? (await getActiveOrPendingPairing(user.id));
      setPairing(currentPairing);

      if (!currentPairing || currentPairing.status !== 'active') {
        return;
      }

      // Check existing consent events for this pairing within 7 days (matching request_therapist_export RPC)
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: events } = await supabase
        .from('consent_events')
        .select('user_id, event_type, created_at')
        .eq('pairing_id', currentPairing.id)
        .eq('event_type', 'therapist_export')
        .gte('created_at', sevenDaysAgo);

      const partnerId = currentPairing.partner_user_id;
      const callerHas = (events ?? []).some((e) => e.user_id === user.id);
      const partnerHasFromRls =
        partnerId !== null &&
        (events ?? []).some((e) => e.user_id === partnerId);

      setCallerConsented(callerHas);

      if (callerHas && partnerHasFromRls) {
        setBothConsented(true);
        void fetchOrGenerateReport(currentPairing, user.id);
      } else if (callerHas) {
        // Because consent_events is self-read-only under RLS, probe the
        // therapist-export Edge Function (which verifies both partners via service_role)
        const { data, error } = await supabase.functions.invoke(
          'therapist-export',
          {
            body: { pairingId: currentPairing.id },
          },
        );
        if (!error && data && typeof data.formattedText === 'string') {
          setBothConsented(true);
          setReportText(data.formattedText);
        } else {
          setBothConsented(false);
        }
      } else {
        setBothConsented(false);
      }
    } catch (err) {
      console.warn('Error loading export status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadExportState();
    }, [loadExportState]),
  );

  async function fetchOrGenerateReport(
    activePairing: PairingWithPartner,
    callerId: string,
  ) {
    setGeneratingReport(true);
    try {
      // 1. Try calling the therapist-export Supabase Edge Function
      const { data, error } = await supabase.functions.invoke(
        'therapist-export',
        {
          body: { pairingId: activePairing.id },
        },
      );

      if (!error && data && typeof data.formattedText === 'string') {
        setReportText(data.formattedText);
        return;
      }

      // 2. Local Fallback generator: query reveals.summary and build summary text
      const reveals = await fetchPairReveals(activePairing.id);
      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const callerProfile = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', callerId)
        .maybeSingle();

      const callerName = callerProfile.data?.display_name?.trim() || 'Partner 1';
      const partnerName =
        activePairing.partner_display_name?.trim() || 'Partner 2';

      const lines = [
        '========================================================',
        'YESYAS! COUPLES MUTUAL REFLECTION SUMMARY',
        '========================================================',
        'Report Type: Clinical & Couples Counseling Aggregate',
        `Date Generated: ${dateStr}`,
        `Pairing ID: ${activePairing.id}`,
        '',
        'PARTNERS:',
        `- ${callerName}`,
        `- ${partnerName}`,
        '',
        'CONSENT AUDIT STATUS:',
        // Deliberately weaker than the Edge Function's wording. This is the
        // client-side fallback: it runs when the therapist-export function is
        // unreachable, so it has only the caller's own consent_events rows to
        // go on — consent_events is self-read only under RLS, and the
        // partner's row is invisible here. Claiming the chain was verified
        // would be an attestation with nothing behind it, in a document
        // written for a clinician. Only the server, holding the service-role
        // key, can see both sides and say that.
        'Both partners recorded consent in the app before this summary was',
        'generated. This copy was produced on-device and could not re-check',
        'the cryptographic audit chain — ask for a server-generated copy if',
        'that verification matters.',
        '',
        'REVEAL HISTORY & AGGREGATE SUMMARY:',
      ];

      if (reveals.length === 0) {
        lines.push('No completed mutual reveals recorded yet for this pairing.');
      } else {
        reveals.forEach((r, idx) => {
          const summaryObj = (r.summary as Record<string, unknown> | null) ?? {};
          const matchCount =
            typeof summaryObj.match_count === 'number'
              ? summaryObj.match_count
              : 0;
          const curiosityCount =
            typeof summaryObj.curiosity_count === 'number'
              ? summaryObj.curiosity_count
              : typeof summaryObj.mismatch_count === 'number'
                ? summaryObj.mismatch_count
                : 0;

          const rDate = r.revealed_at || r.triggered_at;
          const formatted = rDate
            ? new Date(rDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : `Session ${idx + 1}`;

          lines.push(
            `[Session ${idx + 1} — ${formatted}] Status: ${r.status}`,
          );
          lines.push(`  • Mutual High-Alignment Desires: ${matchCount}`);
          lines.push(
            `  • Curiosity Bridge Items (Exploration Zone): ${curiosityCount}`,
          );
          lines.push('');
        });
      }

      lines.push('--------------------------------------------------------');
      lines.push('CLINICAL & PRIVACY ARCHITECTURE NOTICE:');
      lines.push(
        'This document contains exclusively mutual alignment aggregate metrics.',
      );
      lines.push('In strict compliance with the YesYas zero-knowledge architecture:');
      lines.push('- Individual desire ratings are never revealed, logged, or exported.');
      lines.push('- Unshared desires remain completely confidential to each individual.');
      lines.push('- Only mutually shared alignments are summarized.');
      lines.push('========================================================');

      setReportText(lines.join('\n'));
    } catch (err) {
      console.warn('Error generating therapist summary report:', err);
    } finally {
      setGeneratingReport(false);
    }
  }

  async function handleGrantConsent() {
    if (!pairing || submittingConsent) return;
    setSubmittingConsent(true);
    try {
      const result = await requestTherapistExport(pairing.id);
      setCallerConsented(true);

      if (result.both_consented) {
        setBothConsented(true);
        if (userId) {
          await fetchOrGenerateReport(pairing, userId);
        }
        showMessage(
          'Dual Consent Verified',
          'Both partners have consented. The clinical summary report is now ready to view and share.',
        );
      } else {
        setBothConsented(false);
        showMessage(
          'Consent Recorded',
          'Your export consent has been logged to the audit chain. Once your partner opens this screen and grants consent, the summary will unlock.',
        );
      }
    } catch (err) {
      showMessage(
        'Consent Error',
        err instanceof Error
          ? err.message
          : 'Failed to record export consent.',
      );
    } finally {
      setSubmittingConsent(false);
    }
  }

  async function handleShareReport() {
    if (!reportText) return;
    const outcome = await shareText({
      message: reportText,
      title: 'YesYas Couples Clinical Summary',
    });
    if (outcome === 'copied') {
      showMessage(
        'Copied',
        'The clinical summary is on your clipboard — paste it wherever you need it.',
      );
    } else if (outcome === 'unavailable') {
      showMessage(
        'Could not share',
        'This browser cannot share or copy automatically. Use Print / Save as PDF, or select the summary text and copy it manually.',
      );
    }
  }

  function handlePrintPdf() {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    } else {
      void handleShareReport();
    }
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
            Therapist Export
          </Text>
        </View>
        <Pressable
          onPress={() => void loadExportState()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Refresh status"
          style={styles.refreshButton}
        >
          <Ionicons name="refresh" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        {loading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={{ marginVertical: SPACING.xl }}
          />
        ) : !pairing || pairing.status !== 'active' ? (
          /* Unpaired State */
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="people-outline"
              size={40}
              color={colors.muted}
            />
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Active Pairing Required
            </Text>
            <Text style={[styles.cardBody, { color: colors.muted }]}>
              Therapist summary reports synthesize mutual alignment metrics
              between two partners. Pair with your partner and complete a
              reveal session to use this feature.
            </Text>
            <Pressable
              onPress={() => router.push('/(app)/pairing/invite' as Href)}
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Invite partner"
            >
              <Text style={styles.primaryButtonText}>Invite My Partner</Text>
            </Pressable>
          </View>
        ) : (
          /* Paired State */
          <>
            {/* Dual-Consent Status Banner */}
            <View
              style={[
                styles.statusBanner,
                {
                  backgroundColor: bothConsented
                    ? '#10B98115'
                    : callerConsented
                      ? '#F59E0B15'
                      : colors.surface,
                  borderColor: bothConsented
                    ? '#10B981'
                    : callerConsented
                      ? '#F59E0B'
                      : colors.border,
                },
              ]}
            >
              <Ionicons
                name={
                  bothConsented
                    ? 'shield-checkmark'
                    : callerConsented
                      ? 'time-outline'
                      : 'shield-outline'
                }
                size={24}
                color={
                  bothConsented
                    ? '#10B981'
                    : callerConsented
                      ? '#F59E0B'
                      : colors.primary
                }
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.statusBannerTitle,
                    {
                      color: bothConsented
                        ? '#10B981'
                        : callerConsented
                          ? '#D97706'
                          : colors.text,
                    },
                  ]}
                >
                  {bothConsented
                    ? 'Dual Partner Consent Verified'
                    : callerConsented
                      ? 'Waiting for Partner Consent'
                      : 'Dual Consent Required'}
                </Text>
                <Text
                  style={[styles.statusBannerSubtitle, { color: colors.muted }]}
                >
                  {bothConsented
                    ? 'Both partners have granted explicit export consent.'
                    : callerConsented
                      ? `Your consent is logged. Ask ${pairing.partner_display_name?.trim() || 'your partner'} to open this screen and grant consent.`
                      : 'To protect mutual privacy, both partners must explicitly consent before any summary is exported.'}
                </Text>
              </View>
            </View>

            {/* Grant / Request Consent Button if not yet consented */}
            {!callerConsented && (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Grant Export Consent
                </Text>
                <Text style={[styles.cardBody, { color: colors.muted }]}>
                  By granting consent, you authorize YesYas! to compile aggregate
                  counts of shared alignment and curiosity zone items for clinical
                  counseling. Individual raw ratings are never exported.
                </Text>
                <Pressable
                  onPress={handleGrantConsent}
                  disabled={submittingConsent}
                  style={[
                    styles.primaryButton,
                    { backgroundColor: colors.primary },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Grant therapist export consent"
                >
                  {submittingConsent ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      I Consent to Therapist Summary
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* Formatted Report Display when both consented */}
            {bothConsented && (
              <View
                style={[
                  styles.reportContainer,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.reportHeader}>
                  <View>
                    <Text
                      style={[styles.reportHeading, { color: colors.text }]}
                    >
                      Couples Clinical Summary
                    </Text>
                    <Text
                      style={[styles.reportSubheading, { color: colors.muted }]}
                    >
                      Match counts & curiosity zone metrics
                    </Text>
                  </View>
                  <View style={styles.actionButtonGroup}>
                    <Pressable
                      onPress={handlePrintPdf}
                      disabled={!reportText}
                      style={[
                        styles.printButton,
                        { borderColor: colors.border, backgroundColor: colors.surface },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Print or save PDF report"
                    >
                      <Ionicons name="print-outline" size={16} color={colors.text} />
                      <Text style={[styles.printButtonText, { color: colors.text }]}>PDF</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleShareReport}
                      disabled={!reportText}
                      style={[
                        styles.shareButton,
                        { backgroundColor: colors.primary },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Share therapist summary report"
                    >
                      <Ionicons name="share-outline" size={16} color="#FFFFFF" />
                      <Text style={styles.shareButtonText}>Share</Text>
                    </Pressable>
                  </View>
                </View>

                {generatingReport ? (
                  <View style={styles.reportLoading}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text
                      style={[styles.reportLoadingText, { color: colors.muted }]}
                    >
                      Compiling aggregate metrics...
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={[
                      styles.reportTextBox,
                      { backgroundColor: colors.bg, borderColor: colors.border },
                    ]}
                    nestedScrollEnabled
                  >
                    <Text
                      style={[styles.reportText, { color: colors.text }]}
                      selectable
                    >
                      {reportText}
                    </Text>
                  </ScrollView>
                )}
              </View>
            )}
          </>
        )}
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
  refreshButton: {
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
    gap: SPACING.md,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusBannerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  card: {
    padding: SPACING.lg,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  cardTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
    textAlign: 'center',
  },
  cardBody: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xs,
  },
  primaryButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  reportContainer: {
    padding: SPACING.md,
    borderRadius: 16,
    borderWidth: 1,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  reportHeading: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  reportSubheading: {
    fontSize: 12,
  },
  actionButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  printButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  reportLoading: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  reportLoadingText: {
    fontSize: 13,
  },
  reportTextBox: {
    maxHeight: 400,
    padding: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  reportText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
