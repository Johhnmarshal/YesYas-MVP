import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type JournalEntryWithBody,
  fetchJournalEntries,
  reportAiMessage,
  saveJournalEntry,
  sendAiCoachMessage,
} from '@/lib/journal';
import { getActiveOrPendingPairing } from '@/lib/pairing';
import {
  SCREEN_CAPTURE_KEYS,
  useScreenCaptureProtection,
} from '@/lib/screen-capture';
import { supabase } from '@/lib/supabase';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  createdAt: string;
  journalEntryId?: string | null;
}

const REPORT_REASONS = [
  'Contains explicit or inappropriate content',
  'Gave specific partner behavior advice',
  'Violates emotional safety or privacy boundaries',
  'Did not feel helpful or grounded',
  'Other safety concern',
];

export default function JournalScreen() {
  const colors = useThemeColors();
  useScreenCaptureProtection(SCREEN_CAPTURE_KEYS.journalList);
  const [userId, setUserId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(() => {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pastEntries, setPastEntries] = useState<JournalEntryWithBody[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [isPaired, setIsPaired] = useState(false);
  const [checkingPairing, setCheckingPairing] = useState(true);
  // Set when a reply came from the local fallback rather than the coach, so
  // the stock phrasing is explained instead of reading as a poor answer.
  const [coachNotice, setCoachNotice] = useState<string | null>(null);

  // Modals
  const [graduationModalVisible, setGraduationModalVisible] = useState(false);
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(
    null,
  );
  const [selectedReportReason, setSelectedReportReason] = useState(
    REPORT_REASONS[0],
  );
  const [submittingReport, setSubmittingReport] = useState(false);

  // Load current user, pairing status, and past entries
  const loadUserData = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }
      setUserId(user.id);

      // Check pairing status
      const pairing = await getActiveOrPendingPairing(user.id);
      setIsPaired(pairing !== null && pairing.status === 'active');
      setCheckingPairing(false);

      // Load past entries
      setLoadingEntries(true);
      const entries = await fetchJournalEntries(user.id);
      setPastEntries(entries);
    } catch (err) {
      console.warn('Error loading journal state:', err);
    } finally {
      setLoadingEntries(false);
      setCheckingPairing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadUserData();
    }, [loadUserData]),
  );

  useEffect(() => {
    // Generate a fresh session threadId on mount if supported
    if (
      !threadId &&
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      setThreadId(crypto.randomUUID());
    }
  }, [threadId]);

  async function handleSendMessage() {
    const text = inputText.trim();
    if (!text || !userId || isTyping) return;

    setInputText('');
    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      // 1. Encrypt & persist user message on device
      const savedUserRow = await saveJournalEntry(
        userId,
        text,
        threadId ?? null,
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMsgId ? { ...m, journalEntryId: savedUserRow.id } : m,
        ),
      );

      // 2. Request AI coach reflective reply
      const aiResponse = await sendAiCoachMessage(text, threadId ?? undefined);

      if (aiResponse.threadId) {
        setThreadId(aiResponse.threadId);
      }

      setCoachNotice(
        aiResponse.reason === 'rate_limited'
          ? 'You have reached the coach limit for now. Your entry is saved — the reply below is a standard prompt.'
          : aiResponse.reason === 'unavailable'
            ? 'The coach could not be reached, so the reply below is a standard prompt. Your entry is saved.'
            : null,
      );

      // 3. Encrypt & persist AI reply on device
      const savedAiRow = await saveJournalEntry(
        userId,
        aiResponse.reply,
        aiResponse.threadId ?? threadId ?? null,
      );

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: aiResponse.reply,
        createdAt: new Date().toISOString(),
        journalEntryId: savedAiRow.id,
      };

      setMessages((prev) => [...prev, aiMsg]);

      // Refresh past entries list in background
      const updatedEntries = await fetchJournalEntries(userId);
      setPastEntries(updatedEntries);
    } catch (err) {
      console.warn('Failed to send journal message:', err);
      Alert.alert(
        'Journal Error',
        'Could not save your journal reflection. Please check your connection and try again.',
      );
    } finally {
      setIsTyping(false);
    }
  }

  async function handleSubmitReport() {
    if (!reportingMessage || !userId || submittingReport) return;
    setSubmittingReport(true);
    try {
      await reportAiMessage(
        userId,
        reportingMessage.journalEntryId ?? null,
        selectedReportReason,
      );
      setReportingMessage(null);
      Alert.alert(
        'Thank You',
        'This response has been reported for safety review. Your feedback keeps YesYas! grounded and safe.',
      );
    } catch (err) {
      Alert.alert(
        'Report Error',
        err instanceof Error
          ? err.message
          : 'Failed to submit report. Please try again.',
      );
    } finally {
      setSubmittingReport(false);
    }
  }

  function handleGraduateToPairing() {
    setGraduationModalVisible(false);
    router.push('/(app)/pairing/invite' as Href);
  }

  function formatEntryDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Top Header with Encryption Badge */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="journal-outline" size={22} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Solo Journal
            </Text>
          </View>
          <View
            style={[
              styles.lockBadge,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="lock-closed" size={13} color={colors.primary} />
            <Text style={[styles.lockBadgeText, { color: colors.primary }]}>
              🔒 Private to you — encrypted on device
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* AI Coach Introduction / Welcome Card */}
          <View
            style={[
              styles.welcomeCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.welcomeHeader}>
              <View
                style={[
                  styles.avatarCircle,
                  { backgroundColor: colors.primary + '18' },
                ]}
              >
                <Ionicons name="sparkles" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                  AI Intimacy Self-Reflection Coach
                </Text>
                <Text style={[styles.welcomeSubtitle, { color: colors.muted }]}>
                  Reflect on your boundaries, curiosities, and desires.
                </Text>
              </View>
            </View>
            <Text style={[styles.welcomeDisclaimer, { color: colors.muted }]}>
              Note: The AI Coach is an intimacy self-reflection companion, not a
              licensed therapist. All entries are encrypted with your device key
              before saving.
            </Text>
          </View>

          {/* Active Conversation Messages */}
          {messages.length > 0 && (
            <View style={styles.chatSection}>
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.messageRow,
                      isUser
                        ? styles.messageRowUser
                        : styles.messageRowAi,
                    ]}
                  >
                    {!isUser && (
                      <View
                        style={[
                          styles.miniAvatar,
                          { backgroundColor: colors.primary + '20' },
                        ]}
                      >
                        <Ionicons
                          name="sparkles"
                          size={12}
                          color={colors.primary}
                        />
                      </View>
                    )}
                    <Pressable
                      onLongPress={() => {
                        if (!isUser) {
                          setReportingMessage(msg);
                        }
                      }}
                      delayLongPress={400}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isUser
                          ? `Your reflection: ${msg.text}`
                          : `AI Coach response: ${msg.text}. Long press to report.`
                      }
                      style={[
                        styles.bubble,
                        isUser
                          ? [
                              styles.bubbleUser,
                              { backgroundColor: colors.primary },
                            ]
                          : [
                              styles.bubbleAi,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderLeftWidth: 3,
                                borderLeftColor: colors.accentWarm,
                              },
                            ],
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          isUser
                            ? { color: '#FFFFFF' }
                            : { color: colors.text },
                        ]}
                      >
                        {msg.text}
                      </Text>

                      {!isUser && (
                        <View style={styles.bubbleActionRow}>
                          <Pressable
                            onPress={() => setReportingMessage(msg)}
                            hitSlop={8}
                            style={styles.flagButton}
                            accessibilityRole="button"
                            accessibilityLabel="Report this AI response"
                          >
                            <Ionicons
                              name="flag-outline"
                              size={12}
                              color={colors.muted}
                            />
                            <Text
                              style={[
                                styles.flagButtonText,
                                { color: colors.muted },
                              ]}
                            >
                              Report
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </Pressable>
                  </View>
                );
              })}

              {isTyping && (
                <View style={[styles.messageRow, styles.messageRowAi]}>
                  <View
                    style={[
                      styles.miniAvatar,
                      { backgroundColor: colors.primary + '20' },
                    ]}
                  >
                    <Ionicons
                      name="sparkles"
                      size={12}
                      color={colors.primary}
                    />
                  </View>
                  <View
                    style={[
                      styles.bubble,
                      styles.bubbleAi,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderLeftWidth: 3,
                        borderLeftColor: colors.accentWarm,
                      },
                    ]}
                  >
                    <View style={styles.typingIndicatorRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text
                        style={[
                          styles.typingText,
                          { color: colors.muted },
                        ]}
                      >
                        AI Coach is reflecting...
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Past Decrypted Journal Entries Section */}
          <View style={styles.pastEntriesSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.sectionHeaderTitle,
                    { color: colors.text },
                  ]}
                >
                  Past Reflections ({pastEntries.length})
                </Text>
              </View>
              <Pressable
                onPress={() => void loadUserData()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Refresh past entries"
                style={styles.refreshButton}
              >
                <Ionicons name="refresh" size={16} color={colors.muted} />
              </Pressable>
            </View>

            {loadingEntries ? (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={{ marginVertical: SPACING.md }}
              />
            ) : pastEntries.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="document-text-outline"
                  size={32}
                  color={colors.muted}
                />
                <Text
                  style={[styles.emptyCardTitle, { color: colors.text }]}
                >
                  Your Journal Is Waiting
                </Text>
                <Text
                  style={[styles.emptyCardBody, { color: colors.muted }]}
                >
                  Write a thought, emotion, or question above. Your entries are
                  never visible to anyone else, even if you pair with a partner.
                </Text>
              </View>
            ) : (
              <View style={styles.entriesList}>
                {pastEntries.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => {
                      router.push(`/(app)/journal/${entry.id}` as Href);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`View entry from ${formatEntryDate(entry.created_at)}`}
                    style={({ pressed }) => [
                      styles.entryCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={styles.entryCardHeader}>
                      <View style={styles.entryCardDateRow}>
                        <Ionicons
                          name="calendar-outline"
                          size={13}
                          color={colors.muted}
                        />
                        <Text
                          style={[
                            styles.entryCardDate,
                            { color: colors.muted },
                          ]}
                        >
                          {formatEntryDate(entry.created_at)}
                        </Text>
                      </View>
                      <View style={styles.entryCardLock}>
                        <Ionicons
                          name="lock-closed"
                          size={11}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.entryCardEncrypted,
                            { color: colors.primary },
                          ]}
                        >
                          Encrypted
                        </Text>
                      </View>
                    </View>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.entryCardSnippet,
                        {
                          color:
                            entry.bodyState === 'ok' ? colors.text : colors.muted,
                        },
                      ]}
                    >
                      {entry.bodyState === 'ok'
                        ? entry.body
                        : entry.bodyState === 'locked'
                          ? 'This entry is still encrypted. Unlock this device with your recovery code in Settings to read it.'
                          : 'This entry can no longer be decrypted on this account.'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        {coachNotice ? (
          <View
            style={[
              styles.coachNotice,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.coachNoticeText, { color: colors.secondary }]}
              accessibilityLiveRegion="polite"
            >
              {coachNotice}
            </Text>
          </View>
        ) : null}

        {/* Input Bar at Bottom */}
        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          <TextInput
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.bg,
                borderColor: colors.border,
              },
            ]}
            placeholder="Write a private reflection or question..."
            placeholderTextColor={colors.muted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
            returnKeyType="default"
            accessibilityLabel="Journal reflection input"
          />
          <Pressable
            onPress={handleSendMessage}
            disabled={!inputText.trim() || isTyping}
            accessibilityRole="button"
            accessibilityLabel="Send reflection to journal"
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  inputText.trim() && !isTyping
                    ? colors.primary
                    : colors.muted + '40',
              },
            ]}
          >
            {isTyping ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>

        {/* Sticky Graduation Footer (only visible when user is unpaired) */}
        {!checkingPairing && !isPaired && (
          <View
            style={[
              styles.stickyFooter,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={{ flex: 1, marginRight: SPACING.sm }}>
              <Text style={[styles.footerTitle, { color: colors.text }]}>
                Ready to share with a partner?
              </Text>
              <Text style={[styles.footerSubtitle, { color: colors.muted }]}>
                Your solo ratings and journal remain private.
              </Text>
            </View>
            <Pressable
              onPress={() => setGraduationModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Invite my partner to pair"
              style={[
                styles.graduateButton,
                { backgroundColor: colors.primary },
              ]}
            >
              <Ionicons name="heart-outline" size={16} color="#FFFFFF" />
              <Text style={styles.graduateButtonText}>Invite partner</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Graduation Confirmation Modal */}
      <Modal
        visible={graduationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGraduationModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.modalIconCircle,
                { backgroundColor: colors.primary + '20' },
              ]}
            >
              <Ionicons name="people" size={28} color={colors.primary} />
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Graduating to Paired Mode
            </Text>

            <Text style={[styles.modalBody, { color: colors.muted }]}>
              Your solo ratings and journal reflections will carry over and
              remain 100% private to you.
            </Text>

            <View
              style={[
                styles.modalInfoCallout,
                { backgroundColor: colors.bg, borderColor: colors.border },
              ]}
            >
              <Ionicons name="shield-checkmark" size={18} color={colors.primary} />
              <Text
                style={[styles.modalInfoCalloutText, { color: colors.text }]}
              >
                When paired, only mutually high-rated desires match. Unshared
                items and your personal journal notes are never exposed.
              </Text>
            </View>

            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => setGraduationModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Keep solo mode"
                style={[
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.modalCancelButtonText, { color: colors.text }]}
                >
                  Keep solo
                </Text>
              </Pressable>

              <Pressable
                onPress={handleGraduateToPairing}
                accessibilityRole="button"
                accessibilityLabel="Invite my partner to pair"
                style={[
                  styles.modalConfirmButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.modalConfirmButtonText}>
                  Invite my partner
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI Message Reporting Modal */}
      <Modal
        visible={reportingMessage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReportingMessage(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.modalIconCircle,
                { backgroundColor: '#F59E0B20' },
              ]}
            >
              <Ionicons name="flag" size={24} color="#F59E0B" />
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Report AI Response
            </Text>

            <Text style={[styles.modalBody, { color: colors.muted }]}>
              Please select the reason for reporting this response. Our safety
              team reviews flagged interactions to ensure privacy and grounded
              support.
            </Text>

            <View style={styles.reportReasonsList}>
              {REPORT_REASONS.map((reason) => {
                const selected = selectedReportReason === reason;
                return (
                  <Pressable
                    key={reason}
                    onPress={() => setSelectedReportReason(reason)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={reason}
                    style={[
                      styles.reasonOption,
                      {
                        backgroundColor: selected
                          ? colors.primary + '15'
                          : colors.bg,
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        selected
                          ? 'radio-button-on'
                          : 'radio-button-off'
                      }
                      size={18}
                      color={selected ? colors.primary : colors.muted}
                    />
                    <Text
                      style={[
                        styles.reasonOptionText,
                        {
                          color: selected ? colors.primary : colors.text,
                          fontWeight: selected ? '600' : '400',
                        },
                      ]}
                    >
                      {reason}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => setReportingMessage(null)}
                disabled={submittingReport}
                accessibilityRole="button"
                accessibilityLabel="Cancel reporting"
                style={[
                  styles.modalCancelButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.modalCancelButtonText, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSubmitReport}
                disabled={submittingReport}
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                style={[
                  styles.modalConfirmButton,
                  { backgroundColor: '#EF4444' },
                ]}
              >
                {submittingReport ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>Submit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  lockBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
  },
  welcomeCard: {
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    ...SHADOWS.subtle,
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  welcomeSubtitle: {
    fontSize: TYPOGRAPHY.caption.fontSize,
  },
  welcomeDisclaimer: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  chatSection: {
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  messageRow: {
    flexDirection: 'row',
    marginVertical: 4,
    alignItems: 'flex-end',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAi: {
    justifyContent: 'flex-start',
    gap: 8,
  },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADII.lg,
    ...SHADOWS.subtle,
  },
  bubbleUser: {
    borderBottomRightRadius: RADII.xs,
  },
  bubbleAi: {
    borderBottomLeftRadius: RADII.xs,
    borderWidth: 1,
  },
  bubbleText: {
    fontSize: TYPOGRAPHY.body.fontSize,
    lineHeight: 22,
  },
  bubbleActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  flagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    minWidth: 44,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  flagButtonText: {
    fontSize: 11,
    fontWeight: '500',
  },
  refreshButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  typingText: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    fontStyle: 'italic',
  },
  pastEntriesSection: {
    marginTop: SPACING.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  sectionHeaderTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
  },
  emptyCard: {
    padding: SPACING.lg,
    borderRadius: RADII.xl,
    borderWidth: 1,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  emptyCardTitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyCardBody: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    textAlign: 'center',
    lineHeight: 18,
  },
  entriesList: {
    gap: SPACING.sm,
  },
  entryCard: {
    padding: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: 1,
    ...SHADOWS.subtle,
  },
  entryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  entryCardDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  entryCardDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  entryCardLock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  entryCardEncrypted: {
    fontSize: 11,
    fontWeight: '600',
  },
  entryCardSnippet: {
    fontSize: TYPOGRAPHY.body.fontSize,
    lineHeight: 20,
  },
  coachNotice: {
    borderTopWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  coachNoticeText: {
    ...TYPOGRAPHY.caption,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 4,
    borderTopWidth: 1,
    gap: SPACING.xs,
  },
  textInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 100,
    borderWidth: 1,
    borderRadius: RADII.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: TYPOGRAPHY.body.fontSize,
  },
  sendButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
  },
  footerTitle: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    fontWeight: '700',
  },
  footerSubtitle: {
    fontSize: 11,
  },
  graduateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderRadius: RADII.pill,
  },
  graduateButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    borderRadius: RADII.xl,
    borderWidth: 1,
    padding: SPACING.lg,
    alignItems: 'center',
    ...SHADOWS.elevated,
  },
  modalIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.h2.fontSize,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  modalBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  modalInfoCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    padding: SPACING.md,
    borderRadius: RADII.md,
    borderWidth: 1,
    marginBottom: SPACING.lg,
    width: '100%',
  },
  modalInfoCalloutText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
  },
  modalCancelButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: RADII.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontWeight: '600',
    fontSize: TYPOGRAPHY.body.fontSize,
  },
  modalConfirmButton: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: TYPOGRAPHY.body.fontSize,
  },
  reportReasonsList: {
    width: '100%',
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    padding: SPACING.sm + 2,
    minHeight: 44,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  reasonOptionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
