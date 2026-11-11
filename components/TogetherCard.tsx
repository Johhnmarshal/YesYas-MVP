import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useVoice } from '@/components/VoiceProvider';
import { friendlyError } from '@/lib/errors';
import { hapticMedium } from '@/lib/haptics';
import { nudgeAvailableAt, progressPercent } from '@/lib/packs';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';
import { fillVoice } from '@/lib/voice';
import {
  NudgeCooldownError,
  type NudgeRow,
  fetchRecentNudges,
  fetchSharedProgress,
  sendNudge,
} from '@/lib/together';

interface TogetherCardProps {
  pairingId: string;
  userId: string;
  partnerName: string;
  /** Nudges need an active pairing; progress shows while paused too. */
  active: boolean;
  /** Bumped by Home on focus so the card refetches. */
  refreshKey: number;
}

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h}h ago`;
}

function untilText(ms: number): string {
  const h = Math.ceil(ms / 3600000);
  return h <= 1 ? 'in under an hour' : `in about ${h} hours`;
}

/**
 * "We are doing this together", without showing anyone's answers: a shared
 * count of ideas you have both rated, and a one-tap nudge.
 */
export function TogetherCard({ pairingId, userId, partnerName, active, refreshKey }: TogetherCardProps) {
  const colors = useThemeColors();
  const { voice } = useVoice();
  const [progress, setProgress] = useState<{ together: number; total: number } | null>(null);
  const [nudges, setNudges] = useState<NudgeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [p, n] = await Promise.all([
        fetchSharedProgress(pairingId),
        active ? fetchRecentNudges(pairingId) : Promise.resolve([]),
      ]);
      setProgress(p);
      setNudges(n);
      setNow(Date.now());
    } catch {
      // Decorative: Home still works without it.
    }
  }, [active, pairingId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const received = nudges.find((n) => n.recipient_id === userId) ?? null;
  const lastSent = nudges.find((n) => n.sender_id === userId) ?? null;
  const availableAt = nudgeAvailableAt(lastSent?.created_at ?? null);
  const coolingDown = availableAt > now;

  const handleNudge = useCallback(async () => {
    if (busy || coolingDown) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendNudge(pairingId);
      void hapticMedium();
      setMessage(`Sent. ${partnerName} will see it next time they open the app.`);
      await load();
    } catch (err) {
      setMessage(
        err instanceof NudgeCooldownError ? err.message : friendlyError(err, 'Could not send that.'),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, coolingDown, load, pairingId, partnerName]);

  const pct = progress ? progressPercent(progress.together, progress.total) : 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {received ? (
        <View style={[styles.received, { backgroundColor: colors.accentWarmSubtle }]}>
          <Ionicons name="heart" size={18} color={colors.accentWarm} />
          <Text style={[styles.receivedText, { color: colors.text }]}>
            {fillVoice(voice.nudgeReceived, { name: partnerName })}
            <Text style={{ color: colors.secondary }}> · {ago(received.created_at, now)}</Text>
          </Text>
        </View>
      ) : null}

      {progress && progress.total > 0 ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`You and ${partnerName} have both explored ${progress.together} of ${progress.total} ideas`}
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          style={styles.progress}
        >
          <View style={styles.progressHeader}>
            <Text style={[styles.label, { color: colors.primary }]}>Explored together</Text>
            <Text style={[styles.value, { color: colors.secondary }]}>
              {progress.together} of {progress.total}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.surfaceHighlight }]}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accentWarm }]} />
          </View>
          <Text style={[styles.hint, { color: colors.secondary }]}>
            Ideas you have both rated. It never shows how either of you rated them.
          </Text>
        </View>
      ) : null}

      {active ? (
        <View style={styles.nudgeRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${voice.nudgeButton}. Sends ${partnerName} a nudge with no question attached`}
            accessibilityState={{ disabled: busy || coolingDown, busy }}
            disabled={busy || coolingDown}
            onPress={() => void handleNudge()}
            style={({ pressed }) => [
              styles.nudgeButton,
              {
                borderColor: colors.accentWarm,
                backgroundColor: colors.bg,
                opacity: coolingDown ? 0.55 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.accentWarm} />
            ) : (
              <>
                <Ionicons name="heart-outline" size={18} color={colors.accentWarm} />
                <Text style={[styles.nudgeText, { color: colors.accentWarm }]}>{voice.nudgeButton}</Text>
              </>
            )}
          </Pressable>
          <Text style={[styles.hint, styles.nudgeHint, { color: colors.secondary }]}>
            {message ??
              (coolingDown
                ? `Sent ${ago(lastSent!.created_at, now)}. You can send another ${untilText(availableAt - now)}.`
                : `One tap. ${partnerName} sees it on their Home screen.`)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: RADII.xl,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
    ...SHADOWS.elevated,
  },
  received: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderRadius: RADII.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  receivedText: { ...TYPOGRAPHY.h3, flexShrink: 1 },
  progress: { gap: 6 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { ...TYPOGRAPHY.h3 },
  value: { ...TYPOGRAPHY.caption },
  track: { height: 8, borderRadius: RADII.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: RADII.pill },
  hint: { ...TYPOGRAPHY.caption },
  nudgeRow: { gap: 6 },
  nudgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    alignSelf: 'flex-start',
  },
  nudgeText: { ...TYPOGRAPHY.button },
  nudgeHint: {},
});
