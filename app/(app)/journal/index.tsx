import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { friendlyError } from '@/lib/errors';
import {
  type JournalEntryWithBody,
  fetchJournalEntries,
  reportAiMessage,
  saveJournalEntry,
  sendAiCoachMessage,
} from '@/lib/journal';
import { PrivacyShield } from '@/components/PrivacyShield';
import { RecoveryCodeModal } from '@/components/RecoveryCodeModal';
import { entryAuthor, groupJournalThreads } from '@/lib/journal-threads';
import { showMessage } from '@/lib/alert';
import { hasRecoveryBackup } from '@/lib/key-recovery';
import { getActiveOrPendingPairing } from '@/lib/pairing';
import {
  SCREEN_CAPTURE_KEYS,
  useScreenCaptureProtection,
} from '@/lib/screen-capture';
import { supabase } from '@/lib/supabase';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors, withAlpha } from '@/lib/theme';

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

const PROMPT_STARTERS = [
  { icon: '💡', text: 'What made me feel most connected recently?' },
  { icon: '🌿', text: 'A boundary that helps me feel safe and open' },
  { icon: '✨', text: "A curiosity I haven't quite found the words for" },
];

export default function JournalScreen() {
  const colors = useThemeColors();
  // On a short viewport (a phone in landscape) the starter chips and the
  // composer together leave almost no room for the journal itself, so the
  // chips step aside; the composer stays.
  const { height: viewportHeight } = useWindowDimensions();
  const showStarters = viewportHeight >= 500;
  useScreenCaptureProtection(SCREEN_CAPTURE_KEYS.journalList);
  const [userId, setUserId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(() => {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<TextInput | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [pastEntries, setPastEntries] = useState<JournalEntryWithBody[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [isPaired, setIsPaired] = useState(false);
  const [checkingPairing, setCheckingPairing] = useState(true);
  // Set when a reply came from the local fallback rather than the coach, so
  // the stock phrasing is explained instead of reading as a poor answer.
  const [coachNotice, setCoachNotice] = useState<string | null>(null);
  // Shown once there is something to lose. The device key lives only on this
  // device; without a recovery code a reinstall or a second device loses every
  // entry permanently and silently. Until now the only place that said so was
  // the Settings screen, which a tester has no reason to open — and
  // user_key_recovery has zero rows on production.
  //
  // Entries that could not be decrypted on production showed what that costs,
  // so a recovery code is now required before the first entry rather than
  // suggested after it.
  const [needsRecoveryCode, setNeedsRecoveryCode] = useState(false);
  const [recoveryModalVisible, setRecoveryModalVisible] = useState(false);

  // One card per conversation, the reflection before the reply.
  const threads = useMemo(() => groupJournalThreads(pastEntries), [pastEntries]);

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

      try {
        setNeedsRecoveryCode(!(await hasRecoveryBackup(user.id)));
      } catch {
        // Offline or the check failed. Do not block writing over a backup
        // that may well exist.
        setNeedsRecoveryCode(false);
      }
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
    if (!text || !userId || isTyping || needsRecoveryCode) return;

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

      // A built-in stock prompt is not a reply to what was written. It used
      // to be saved and shown as one, so every tester got the same sentence
      // back and it sat in Past Reflections as if they had written it. Now
      // only a real coach reply is kept; otherwise the person is told why
      // there is none.
      if (aiResponse.isFallback) {
        setCoachNotice(
          aiResponse.reason === 'rate_limited'
            ? 'Your entry is saved. You have reached the coach limit for now, so there is no reply this time.'
            : aiResponse.reason === 'no_provider'
              ? 'Your entry is saved. The reflective coach is not switched on yet, so there is no reply.'
              : 'Your entry is saved. The coach could not be reached, so there is no reply this time.',
        );
        const updatedEntries = await fetchJournalEntries(userId);
        setPastEntries(updatedEntries);
        return;
      }
      setCoachNotice(null);

      // 3. Encrypt & persist the coach's reply in the same thread
      const savedAiRow = await saveJournalEntry(
        userId,
        aiResponse.reply,
        aiResponse.threadId ?? threadId ?? null,
        'coach',
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
      showMessage(
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
      showMessage(
        'Thank You',
        'This response has been reported for safety review. Your feedback keeps YesYas! grounded and safe.',
      );
    } catch (err) {
      showMessage(
        'Report Error',
        friendlyError(err, 'Failed to submit report. Please try again.'),
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
                <Text style={[styles.welcomeSubtitle, { color: colors.textMuted }]}>
                  Reflect on your boundaries, curiosities, and desires.
                </Text>
              </View>
            </View>
            <Text style={[styles.welcomeDisclaimer, { color: colors.textMuted }]}>
              The coach is a self-reflection companion, not a licensed
              therapist. Entries are encrypted on this device before they are
              saved. What you send to the coach is also passed to our AI
              provider so it can reply.
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
                            ? { color: colors.onPrimary }
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
                              color={colors.textMuted}
                            />
                            <Text
                              style={[
                                styles.flagButtonText,
                                { color: colors.textMuted },
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
                          { color: colors.textMuted },
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
                  Past Reflections ({threads.length})
                </Text>
              </View>
              <Pressable
                onPress={() => void loadUserData()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Refresh past entries"
                style={styles.refreshButton}
              >
                <Ionicons name="refresh" size={16} color={colors.textMuted} />
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
                  color={colors.textMuted}
                />
                <Text
                  style={[styles.emptyCardTitle, { color: colors.text }]}
                >
                  Your Journal Is Waiting
                </Text>
                <Text
                  style={[styles.emptyCardBody, { color: colors.textMuted }]}
                >
                  Write a thought, emotion, or question above. Your entries are
                  never visible to anyone else, even if you pair with a partner.
                </Text>
              </View>
            ) : (
              <View style={styles.entriesList}>
                {threads.map((thread) => {
                  const first = thread.entries[0];
                  const replies = thread.entries.filter((e) => entryAuthor(e) === 'coach');
                  const mine = thread.entries.filter((e) => entryAuthor(e) === 'user');
                  const lead = mine[0] ?? first;
                  const leadText = (entry: JournalEntryWithBody) =>
                    entry.bodyState === 'ok'
                      ? entry.body
                      : entry.bodyState === 'locked'
                        ? 'Still encrypted: this device has no key for it yet. Close and reopen YesYas! to enter your recovery code.'
                        : 'This entry was written with a key that is no longer on this device, and there was no recovery code to bring it back, so it cannot be opened.';
                  return (
                    <Pressable
                      key={thread.key}
                      onPress={() => {
                        router.push(`/(app)/journal/${lead.id}` as Href);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`View reflection from ${formatEntryDate(thread.startedAt)}`}
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
                            color={colors.textMuted}
                          />
                          <Text
                            style={[
                              styles.entryCardDate,
                              { color: colors.textMuted },
                            ]}
                          >
                            {formatEntryDate(thread.startedAt)}
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
                        numberOfLines={3}
                        style={[
                          styles.entryCardSnippet,
                          {
                            color:
                              lead.bodyState === 'ok' ? colors.text : colors.textMuted,
                          },
                        ]}
                      >
                        {entryAuthor(lead) === 'coach' ? `Coach: ${leadText(lead)}` : leadText(lead)}
                      </Text>
                      {mine.length > 0 && replies.length > 0 ? (
                        <View
                          style={[
                            styles.threadReply,
                            { backgroundColor: colors.accentWarmSubtle },
                          ]}
                        >
                          <Text
                            style={[styles.threadReplyLabel, { color: colors.secondary }]}
                          >
                            Coach
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={[styles.threadReplyText, { color: colors.secondary }]}
                          >
                            {leadText(replies[replies.length - 1])}
                          </Text>
                        </View>
                      ) : null}
                      {mine.length > 1 ? (
                        <Text style={[styles.threadMore, { color: colors.textMuted }]}>
                          {mine.length} reflections in this conversation
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>

        {needsRecoveryCode ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create your recovery code before writing"
            onPress={() => setRecoveryModalVisible(true)}
            style={({ pressed }) => [
              styles.recoveryWarning,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accentWarm,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="key-outline"
              size={16}
              color={colors.accentWarm}
              style={styles.recoveryWarningIcon}
            />
            <Text
              style={[styles.recoveryWarningText, { color: colors.secondary }]}
            >
              Before you write, create a recovery code. Entries are encrypted
              with a key kept only on this device; the code is the only way to
              open them on a new phone or after clearing this browser. Tap to
              create it.
            </Text>
          </Pressable>
        ) : null}

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

        {/* Reflection Prompt Starters (when no active messages) */}
        {messages.length === 0 && showStarters && (
          <View
            style={[
              styles.promptsContainer,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.promptsLabel, { color: colors.secondary }]}>
              Reflection starters:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.promptsScrollContent}
            >
              {PROMPT_STARTERS.map((prompt, idx) => (
                <Pressable
                  key={idx}
                  accessibilityRole="button"
                  accessibilityLabel={`Use prompt: ${prompt.text}`}
                  onPress={() => {
                    setInputText(prompt.text);
                    inputRef.current?.focus();
                  }}
                  style={({ pressed }) => [
                    styles.promptChip,
                    {
                      backgroundColor: colors.bg,
                      borderColor: colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.promptChipText, { color: colors.primary }]}
                  >
                    {prompt.icon} {prompt.text}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

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
            ref={inputRef}
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.bg,
                borderColor: colors.border,
              },
            ]}
            placeholder={
              needsRecoveryCode
                ? 'Create your recovery code first'
                : 'Write a private reflection or question...'
            }
            placeholderTextColor={colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            editable={!needsRecoveryCode}
            multiline
            maxLength={1000}
            returnKeyType="default"
            accessibilityLabel="Journal reflection input"
          />
          <Pressable
            onPress={handleSendMessage}
            disabled={!inputText.trim() || isTyping || needsRecoveryCode}
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
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Ionicons
                name="arrow-up"
                size={18}
                color={inputText.trim() ? colors.onPrimary : colors.muted}
              />
            )}
          </Pressable>
        </View>

        {/* Sticky Graduation Footer (only visible when user is unpaired and not typing) */}
        {!checkingPairing && !isPaired && inputText.trim().length === 0 && (
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
              <Text style={[styles.footerSubtitle, { color: colors.textMuted }]}>
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
              <Ionicons
                name="heart-outline"
                size={16}
                color={colors.onPrimary}
              />
              <Text
                style={[
                  styles.graduateButtonText,
                  { color: colors.onPrimary },
                ]}
              >
                Invite partner
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Recovery code, required before the first entry */}
      <RecoveryCodeModal
        visible={recoveryModalVisible}
        userId={userId}
        onClose={() => setRecoveryModalVisible(false)}
        onCreated={() => setNeedsRecoveryCode(false)}
      />

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

            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
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
                <Text style={[styles.modalConfirmButtonText, { color: colors.onPrimary }]}>
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
                { backgroundColor: withAlpha(colors.accentGold, 0.15) },
              ]}
            >
              <Ionicons name="flag" size={24} color={colors.accentGold} />
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Report AI Response
            </Text>

            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
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
                      color={selected ? colors.primary : colors.textMuted}
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
                  { backgroundColor: colors.error },
                ]}
              >
                {submittingReport ? (
                  <ActivityIndicator size="small" color={colors.onError} />
                ) : (
                  <Text style={[styles.modalConfirmButtonText, { color: colors.onError }]}>Submit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PrivacyShield
        message="Your journal is hidden while the app is in the background."
      />
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
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: '600',
  },
  entryCardSnippet: {
    fontSize: TYPOGRAPHY.body.fontSize,
    lineHeight: 20,
  },
  recoveryWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  recoveryWarningIcon: {
    marginTop: 1,
  },
  recoveryWarningText: {
    ...TYPOGRAPHY.caption,
    flex: 1,
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
    fontSize: 12,
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
  promptsContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: 4,
    borderTopWidth: 1,
  },
  promptsLabel: {
    ...TYPOGRAPHY.caption,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  promptsScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  promptChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptChipText: {
    ...TYPOGRAPHY.caption,
    fontSize: 13,
    fontWeight: '500',
  },
  threadReply: {
    marginTop: SPACING.xs,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: 2,
  },
  threadReplyLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  threadReplyText: {
    ...TYPOGRAPHY.caption,
  },
  threadMore: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
  },
});
