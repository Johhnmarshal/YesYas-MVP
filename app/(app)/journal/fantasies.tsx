import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecoveryCodeModal } from '@/components/RecoveryCodeModal';
import { StarRating } from '@/components/StarRating';
import { VaultSwitch } from '@/components/VaultSwitch';
import { confirm } from '@/lib/alert';
import { friendlyError } from '@/lib/errors';
import {
  type Fantasy,
  type FantasyCard,
  answerFantasyCard,
  deleteFantasy,
  fetchFantasies,
  fetchFantasyCards,
  reportFantasyCard,
  saveFantasy,
  sendFantasyCard,
  withdrawFantasyCard,
} from '@/lib/fantasies';
import {
  FANTASY_CARD_MAX_LENGTH,
  FANTASY_CONTENT_RULES,
  cardProblem,
  sendDisclosure,
  sentCardStatus,
} from '@/lib/fantasy-rules';
import { hasRecoveryBackup } from '@/lib/key-recovery';
import { getActiveOrPendingPairing } from '@/lib/pairing';
import { supabase } from '@/lib/supabase';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

const REPORT_REASONS = [
  'It makes me uncomfortable',
  'It feels like pressure',
  'It mentions someone else',
  'Something else',
] as const;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Fantasy Vault (`/(app)/journal/fantasies`).
 *
 * Write fantasies privately (encrypted on this device), and send one at a
 * time to your partner as a card. They rate it; only a yes comes back.
 */
export default function FantasiesScreen() {
  const colors = useThemeColors();

  const [userId, setUserId] = useState<string | null>(null);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [pairingActive, setPairingActive] = useState(false);
  const [partnerName, setPartnerName] = useState('Your partner');
  const [fantasies, setFantasies] = useState<Fantasy[]>([]);
  const [cards, setCards] = useState<FantasyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  /** Text waiting on the "before you send" confirmation, if any. */
  const [pendingSend, setPendingSend] = useState<{ text: string; fromFantasyId: string | null } | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [needsRecoveryCode, setNeedsRecoveryCode] = useState(false);
  const [recoveryVisible, setRecoveryVisible] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;
      setUserId(user.id);
      const pairing = await getActiveOrPendingPairing(user.id);
      const pid =
        pairing && (pairing.status === 'active' || pairing.status === 'paused') ? pairing.id : null;
      setPairingId(pid);
      setPairingActive(pairing?.status === 'active');
      const name = pairing?.partner_display_name?.trim();
      setPartnerName(name ? name : 'Your partner');
      const [mine, shared, backedUp] = await Promise.all([
        fetchFantasies(user.id),
        pid ? fetchFantasyCards(pid) : Promise.resolve([]),
        hasRecoveryBackup(user.id).catch(() => true),
      ]);
      setFantasies(mine);
      setCards(shared);
      setNeedsRecoveryCode(!backedUp);
    } catch (err) {
      setLoadError(friendlyError(err, 'Could not open your fantasies.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const received = cards.filter((c) => c.direction === 'received');
  const sent = cards.filter((c) => c.direction === 'sent');
  const draftProblem = draft.trim() ? cardProblem(draft) : null;

  const handleSavePrivately = useCallback(async () => {
    if (!userId || !draft.trim()) return;
    if (needsRecoveryCode) {
      setRecoveryVisible(true);
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      const saved = await saveFantasy(userId, draft);
      setFantasies((f) => [saved, ...f]);
      setDraft('');
      setNotice({ text: 'Saved. Only you can read it.', tone: 'ok' });
    } catch (err) {
      setNotice({ text: friendlyError(err, 'Could not save that.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }, [draft, needsRecoveryCode, userId]);

  const handleConfirmSend = useCallback(async () => {
    if (!pairingId || !pendingSend) return;
    setBusy('send');
    setNotice(null);
    try {
      await sendFantasyCard(pairingId, pendingSend.text);
      if (!pendingSend.fromFantasyId) setDraft('');
      setPendingSend(null);
      setNotice({ text: `Sent to ${partnerName}.`, tone: 'ok' });
      setCards(await fetchFantasyCards(pairingId));
    } catch (err) {
      setNotice({ text: friendlyError(err, 'Could not send that card.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }, [pairingId, partnerName, pendingSend]);

  const handleAnswer = useCallback(
    async (card: FantasyCard, rating: number) => {
      if (rating < 1) return;
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, my_response: rating } : c)));
      try {
        await answerFantasyCard(card.id, rating);
      } catch (err) {
        setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, my_response: card.my_response } : c)));
        setNotice({ text: friendlyError(err, 'Could not save your answer.'), tone: 'error' });
      }
    },
    [],
  );

  const handleReport = useCallback(async (cardId: string, reason: string) => {
    setBusy(`report:${cardId}`);
    try {
      await reportFantasyCard(cardId, reason);
      setCards((cs) => cs.filter((c) => c.id !== cardId));
      setReportingId(null);
      setNotice({ text: 'Reported. The card is hidden and kept for review.', tone: 'ok' });
    } catch (err) {
      setNotice({ text: friendlyError(err, 'Could not report that card.'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }, []);

  const handleWithdraw = useCallback(async (cardId: string) => {
    const ok = await confirm({
      title: 'Take this card back?',
      message: 'It disappears for both of you.',
      confirmText: 'Take back',
    });
    if (!ok) return;
    try {
      await withdrawFantasyCard(cardId);
      setCards((cs) => cs.filter((c) => c.id !== cardId));
    } catch (err) {
      setNotice({ text: friendlyError(err, 'Could not take that card back.'), tone: 'error' });
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!userId) return;
      const ok = await confirm({
        title: 'Delete this fantasy?',
        message: 'This cannot be undone. Cards you already sent are not affected.',
        confirmText: 'Delete',
      });
      if (!ok) return;
      try {
        await deleteFantasy(userId, id);
        setFantasies((f) => f.filter((x) => x.id !== id));
      } catch (err) {
        setNotice({ text: friendlyError(err, 'Could not delete that.'), tone: 'error' });
      }
    },
    [userId],
  );

  const cardStyle = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Vault</Text>
            <VaultSwitch current="fantasies" />
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : loadError ? (
            <View style={cardStyle}>
              <Text style={[styles.body, { color: colors.error }]}>{loadError}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.linkRow}>
                <Text style={[styles.link, { color: colors.accentWarm }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {received.length > 0 ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>From {partnerName}</Text>
                  {received.map((card) => (
                    <View
                      key={card.id}
                      style={[styles.card, { backgroundColor: colors.accentWarmSubtle, borderColor: colors.accentWarm }]}
                    >
                      <Text style={[styles.cardMeta, { color: colors.secondary }]}>
                        {partnerName} wrote this · {shortDate(card.created_at)}
                      </Text>
                      <Text style={[styles.cardBody, { color: colors.text }]}>{card.body}</Text>
                      <StarRating
                        value={card.my_response}
                        onChange={(r) => void handleAnswer(card, r)}
                        // The generic hint ("unless you both say yes") is not
                        // true here: only this person's yes matters.
                        showCaption={card.my_response !== null}
                      />
                      <Text style={[styles.small, { color: colors.secondary }]}>
                        {card.my_response
                          ? card.my_response >= 4
                            ? `${partnerName} can see you said yes.`
                            : `Only you can see this answer. ${partnerName} is not told.`
                          : `Only a 4 or 5 goes back to ${partnerName}. Anything lower stays with you.`}
                      </Text>
                      {reportingId === card.id ? (
                        <View style={styles.reportBox}>
                          <Text style={[styles.small, { color: colors.text }]}>
                            Why are you reporting it? The card is hidden from you and kept for review. {partnerName} is not told.
                          </Text>
                          <View style={styles.chips}>
                            {REPORT_REASONS.map((reason) => (
                              <Pressable
                                key={reason}
                                accessibilityRole="button"
                                disabled={busy === `report:${card.id}`}
                                onPress={() => void handleReport(card.id, reason)}
                                style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                              >
                                <Text style={[styles.chipText, { color: colors.text }]}>{reason}</Text>
                              </Pressable>
                            ))}
                          </View>
                          <Pressable accessibilityRole="button" onPress={() => setReportingId(null)} style={styles.linkRow}>
                            <Text style={[styles.link, { color: colors.secondary }]}>Cancel</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Report this card"
                          onPress={() => setReportingId(card.id)}
                          style={styles.linkRow}
                        >
                          <Ionicons name="flag-outline" size={14} color={colors.secondary} />
                          <Text style={[styles.smallLink, { color: colors.secondary }]}>Report</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={cardStyle}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Write a fantasy</Text>
                <Text style={[styles.small, { color: colors.secondary }]}>
                  Say it in your own words. Keep it to yourself, or send it to {pairingId ? partnerName : 'your partner once you pair'} as a card.
                </Text>
                <TextInput
                  value={draft}
                  onChangeText={(t) => {
                    setDraft(t);
                    if (pendingSend && !pendingSend.fromFantasyId) setPendingSend(null);
                  }}
                  multiline
                  placeholder="I keep thinking about…"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Your fantasy"
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                />
                <Text
                  style={[
                    styles.small,
                    { color: draftProblem && draft.trim() ? colors.accentWarm : colors.secondary },
                  ]}
                >
                  {draft.trim().length}/{FANTASY_CARD_MAX_LENGTH} for a card
                </Text>
                <View style={styles.rules}>
                  {FANTASY_CONTENT_RULES.map((rule) => (
                    <View key={rule} style={styles.ruleRow}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={colors.secondary} />
                      <Text style={[styles.small, styles.flex, { color: colors.secondary }]}>{rule}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.buttons}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!draft.trim() || busy !== null}
                    onPress={() => void handleSavePrivately()}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { borderColor: colors.primary, opacity: !draft.trim() ? 0.5 : pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={colors.primary} />
                    <Text style={[styles.buttonText, { color: colors.primary }]}>Keep it private</Text>
                  </Pressable>
                  {pairingActive ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={!draft.trim() || !!draftProblem || busy !== null}
                      onPress={() => setPendingSend({ text: draft.trim(), fromFantasyId: null })}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        {
                          backgroundColor: colors.accentWarm,
                          opacity: !draft.trim() || draftProblem ? 0.5 : pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="paper-plane-outline" size={16} color={colors.onAccentWarm} />
                      <Text style={[styles.buttonText, { color: colors.onAccentWarm }]}>Send to {partnerName}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {draftProblem && draft.trim() ? (
                  <Text style={[styles.small, { color: colors.accentWarm }]}>{draftProblem}</Text>
                ) : null}

                {pendingSend ? (
                  <View style={[styles.disclosure, { borderColor: colors.accentWarm, backgroundColor: colors.accentWarmSubtle }]}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Before you send</Text>
                    {sendDisclosure(partnerName).map((line) => (
                      <View key={line} style={styles.ruleRow}>
                        <Ionicons name="information-circle-outline" size={16} color={colors.accentWarm} />
                        <Text style={[styles.body, styles.flex, { color: colors.text }]}>{line}</Text>
                      </View>
                    ))}
                    <View style={styles.buttons}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setPendingSend(null)}
                        style={[styles.secondaryButton, { borderColor: colors.border }]}
                      >
                        <Text style={[styles.buttonText, { color: colors.secondary }]}>Not yet</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy === 'send'}
                        onPress={() => void handleConfirmSend()}
                        style={[styles.primaryButton, { backgroundColor: colors.accentWarm }]}
                      >
                        {busy === 'send' ? (
                          <ActivityIndicator size="small" color={colors.onAccentWarm} />
                        ) : (
                          <Text style={[styles.buttonText, { color: colors.onAccentWarm }]}>Send card</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {notice ? (
                  <Text
                    accessibilityRole={notice.tone === 'error' ? 'alert' : undefined}
                    style={[styles.small, { color: notice.tone === 'error' ? colors.error : colors.success }]}
                  >
                    {notice.text}
                  </Text>
                ) : null}
                {needsRecoveryCode ? (
                  <Pressable accessibilityRole="button" onPress={() => setRecoveryVisible(true)} style={styles.linkRow}>
                    <Ionicons name="key-outline" size={14} color={colors.accentWarm} />
                    <Text style={[styles.smallLink, { color: colors.accentWarm }]}>
                      Private fantasies are encrypted on this device. Create a recovery code first so you never lose them.
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {sent.length > 0 ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Sent to {partnerName}</Text>
                  {sent.map((card) => (
                    <View key={card.id} style={cardStyle}>
                      <Text style={[styles.cardBody, { color: colors.text }]}>{card.body}</Text>
                      <View style={styles.statusRow}>
                        <Ionicons
                          name={card.is_yes ? 'heart' : 'time-outline'}
                          size={16}
                          color={card.is_yes ? colors.accentWarm : colors.secondary}
                        />
                        <Text
                          style={[
                            styles.small,
                            styles.flex,
                            { color: card.is_yes ? colors.accentWarm : colors.secondary, fontWeight: card.is_yes ? '600' : '400' },
                          ]}
                        >
                          {sentCardStatus(card.is_yes, partnerName)} · {shortDate(card.created_at)}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Take this card back"
                          onPress={() => void handleWithdraw(card.id)}
                          style={styles.linkRow}
                        >
                          <Text style={[styles.smallLink, { color: colors.secondary }]}>Take back</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your private fantasies</Text>
                {fantasies.length === 0 ? (
                  <Text style={[styles.small, { color: colors.secondary }]}>
                    Nothing here yet. Whatever you keep here is encrypted on this device; nobody else can read it, us included.
                  </Text>
                ) : (
                  fantasies.map((f) => (
                    <View key={f.id} style={cardStyle}>
                      {f.bodyState === 'ok' ? (
                        <Text style={[styles.cardBody, { color: colors.text }]}>{f.body}</Text>
                      ) : (
                        <Text style={[styles.small, { color: colors.secondary }]}>
                          Locked on this device. Unlock with your recovery code in Settings to read it.
                        </Text>
                      )}
                      <View style={styles.statusRow}>
                        <Text style={[styles.small, styles.flex, { color: colors.secondary }]}>
                          {shortDate(f.created_at)} · only you
                        </Text>
                        {pairingActive && f.bodyState === 'ok' && !cardProblem(f.body) ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Send this fantasy to ${partnerName}`}
                            onPress={() => setPendingSend({ text: f.body, fromFantasyId: f.id })}
                            style={styles.linkRow}
                          >
                            <Text style={[styles.smallLink, { color: colors.accentWarm }]}>Send to {partnerName}</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Delete this fantasy"
                          onPress={() => void handleDelete(f.id)}
                          style={styles.linkRow}
                        >
                          <Text style={[styles.smallLink, { color: colors.secondary }]}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <RecoveryCodeModal
        visible={recoveryVisible}
        userId={userId}
        onClose={() => setRecoveryVisible(false)}
        onCreated={() => setNeedsRecoveryCode(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: { gap: SPACING.sm },
  title: { ...TYPOGRAPHY.h1 },
  loader: { marginTop: SPACING.lg },
  section: { gap: SPACING.sm },
  sectionTitle: { ...TYPOGRAPHY.h3 },
  card: {
    borderWidth: 1,
    borderRadius: RADII.lg,
    padding: SPACING.sm,
    gap: SPACING.xs,
    ...SHADOWS.subtle,
  },
  cardMeta: { ...TYPOGRAPHY.caption },
  cardBody: { ...TYPOGRAPHY.body },
  body: { ...TYPOGRAPHY.body },
  small: { ...TYPOGRAPHY.caption },
  input: {
    ...TYPOGRAPHY.body,
    minHeight: 120,
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: 12,
    textAlignVertical: 'top',
  },
  rules: { gap: 4 },
  ruleRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: 4 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.pill,
    flexGrow: 1,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADII.pill,
    borderWidth: 1.5,
    flexGrow: 1,
  },
  buttonText: { ...TYPOGRAPHY.button },
  disclosure: { borderWidth: 1, borderRadius: RADII.md, padding: SPACING.sm, gap: SPACING.xs, marginTop: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 4 },
  link: { ...TYPOGRAPHY.button },
  smallLink: { ...TYPOGRAPHY.caption, fontWeight: '600', flexShrink: 1 },
  reportBox: { gap: SPACING.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderWidth: 1, borderRadius: RADII.pill, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  chipText: { ...TYPOGRAPHY.caption },
});
