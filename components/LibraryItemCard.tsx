import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { StarRating } from '@/components/StarRating';
import {
  type DesireLibraryItem,
  type DesireWithNote,
  upsertDesireNote,
  upsertDesireRating,
} from '@/lib/desires';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export interface LibraryItemCardProps {
  item: DesireLibraryItem;
  userId: string;
  pairingId: string | null;
  desire?: DesireWithNote;
  onDesireUpdated?: (updated: DesireWithNote) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Collapsible/expandable card for a single Desire Library item.
 * Features:
 * - Tier badge (`SENSORY` / `SUGGESTIVE` / `EXPLICIT`) & tone tags
 * - Immediate optimistic 1–5 star rating via `upsertDesireRating`
 * - Permanent `"🔒 Only you see your ratings"` privacy reassurance
 * - Inline expandable description, 800ms debounced encrypted note editor
 *   via `upsertDesireNote`, and navigation link to `/(app)/library/[id]`.
 */
export function LibraryItemCard({
  item,
  userId,
  pairingId,
  desire,
  onDesireUpdated,
}: LibraryItemCardProps) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState<number | null>(desire?.rating ?? null);
  const [note, setNote] = useState<string>(desire?.note ?? '');
  const [ratingSaving, setRatingSaving] = useState(false);
  const [noteSaveState, setNoteSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Latest values, for the unmount flush below. The cleanup closes over its
  // first render otherwise, and would save stale text.
  const noteRef = useRef(note);
  const ratingRef = useRef(rating);
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    ratingRef.current = rating;
  }, [rating]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Order matters: clearing the mounted flag first makes persistNote skip
      // its setState calls, while the encrypted write still goes out.
      isMountedRef.current = false;
      // Flush, do not discard. This cleanup used to clearTimeout and stop,
      // which threw away up to 800ms of typing every time the card unmounted
      // — and this card is inside a FlatList, so it unmounts when the row
      // scrolls out of the window or a tier/tone/search filter stops matching
      // it, not only when the user navigates. The editor had already said
      // "saving", so the note looked saved as it vanished.
      flushRef.current();
    };
  }, []);

  // Keep local state in sync when parent reloads desires (e.g. after returning from detail view)
  useEffect(() => {
    setRating(desire?.rating ?? null);
  }, [desire?.rating]);

  useEffect(() => {
    setNote(desire?.note ?? '');
  }, [desire?.note]);

  const persistNote = useCallback(
    async (textToSave: string, currentRating: number | null) => {
      if (!userId) return;
      try {
        if (isMountedRef.current) {
          setNoteSaveState('saving');
          setErrorMsg(null);
        }

        const promises = [
          upsertDesireNote({
            userId,
            pairingId,
            libraryItemId: item.id,
            note: textToSave,
            defaultRating: currentRating ?? 3,
          }),
          ...(pairingId !== null
            ? [
                upsertDesireNote({
                  userId,
                  pairingId: null,
                  libraryItemId: item.id,
                  note: textToSave,
                  defaultRating: currentRating ?? 3,
                }),
              ]
            : []),
        ];
        const [saved] = await Promise.all(promises);

        if (!isMountedRef.current) return;

        if (saved) {
          setRating(saved.rating);
          onDesireUpdated?.(saved);
        }
        setNoteSaveState('saved');
      } catch (err) {
        if (!isMountedRef.current) return;
        setNoteSaveState('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Could not save encrypted note.',
        );
      }
    },
    [item.id, onDesireUpdated, pairingId, userId],
  );

  const handleRatingChange = useCallback(
    async (nextRating: number) => {
      if (!userId) return;
      const previousRating = rating;
      setRating(nextRating);
      setRatingSaving(true);
      setErrorMsg(null);

      try {
        const promises = [
          upsertDesireRating({
            userId,
            pairingId,
            libraryItemId: item.id,
            rating: nextRating,
            note: note.trim() ? note : undefined,
          }),
          ...(pairingId !== null
            ? [
                upsertDesireRating({
                  userId,
                  pairingId: null,
                  libraryItemId: item.id,
                  rating: nextRating,
                  note: note.trim() ? note : undefined,
                }),
              ]
            : []),
        ];
        const [saved] = await Promise.all(promises);

        if (!isMountedRef.current) return;
        onDesireUpdated?.(saved);
      } catch (err) {
        if (!isMountedRef.current) return;
        setRating(previousRating);
        setErrorMsg(
          err instanceof Error ? err.message : 'Failed to save rating.',
        );
      } finally {
        if (isMountedRef.current) {
          setRatingSaving(false);
        }
      }
    },
    [item.id, note, onDesireUpdated, pairingId, rating, userId],
  );

  const handleNoteChange = useCallback(
    (nextText: string) => {
      setNote(nextText);
      setNoteSaveState('saving');
      setErrorMsg(null);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void persistNote(nextText, rating);
      }, 800);
    },
    [persistNote, rating],
  );

  const flushPendingNote = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      void persistNote(noteRef.current, ratingRef.current);
    }
  }, [persistNote]);

  useEffect(() => {
    flushRef.current = flushPendingNote;
  }, [flushPendingNote]);

  const handleNoteBlur = useCallback(() => {
    flushPendingNote();
  }, [flushPendingNote]);

  const handleOpenDetail = useCallback(() => {
    router.push(`/(app)/library/${item.id}` as Href);
  }, [item.id]);

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const isRated = rating !== null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: isRated ? colors.accentWarm : colors.border,
        },
      ]}
    >
      {/* Top badge row + expand toggle */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${item.title}, ${item.tier} tier. ${
          expanded ? 'Collapse details' : 'Expand details and private note'
        }`}
        onPress={handleToggleExpand}
        style={({ pressed }) => [
          styles.headerPressable,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={styles.badgeRow}>
          <View
            style={[styles.tierBadge, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.tierBadgeText}>{item.tier.toUpperCase()}</Text>
          </View>

          {item.tone_tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.tonePill,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                },
              ]}
            >
              <Text style={[styles.tonePillText, { color: colors.secondary }]}>
                {tag}
              </Text>
            </View>
          ))}

          <View style={styles.spacer} />

          {isRated ? (
            <View style={styles.ratedBadge}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={colors.accentWarm}
              />
              <Text
                style={[styles.ratedBadgeText, { color: colors.accentWarm }]}
              >
                Rated
              </Text>
            </View>
          ) : null}

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.secondary}
          />
        </View>

        <Text style={[styles.title, { color: colors.primary }]}>
          {item.title}
        </Text>
      </Pressable>

      {/* Star Rating Row */}
      <View style={styles.ratingSection}>
        <StarRating
          value={rating}
          onChange={handleRatingChange}
          disabled={ratingSaving}
          showCaption={expanded}
        />
        <Text style={[styles.privacyLabel, { color: colors.secondary }]}>
          🔒 Only you see your ratings
        </Text>
      </View>

      {/* Expanded Section: Description + Encrypted Note + Detail Link */}
      {expanded ? (
        <View
          style={[
            styles.expandedContent,
            { borderTopColor: colors.border },
          ]}
        >
          {item.description ? (
            <Text style={[styles.description, { color: colors.primary }]}>
              {item.description}
            </Text>
          ) : null}

          <View style={styles.noteSection}>
            <View style={styles.noteHeaderRow}>
              <Text style={[styles.noteLabel, { color: colors.secondary }]}>
                Private note (encrypted before saving)
              </Text>
              {noteSaveState === 'saving' ? (
                <Text style={[styles.saveStatus, { color: colors.muted }]}>
                  Saving…
                </Text>
              ) : noteSaveState === 'saved' ? (
                <Text style={[styles.saveStatus, { color: colors.success }]}>
                  ✓ Encrypted & saved
                </Text>
              ) : null}
            </View>

            {desire && desire.noteState !== 'ok' ? (
              <Text
                style={[styles.saveStatus, { color: colors.error }]}
                accessibilityLiveRegion="polite"
              >
                {desire.noteState === 'locked'
                  ? 'You saved a note here, but this device cannot read it yet. Unlock with your recovery code in Settings.'
                  : 'You saved a note here, but it can no longer be decrypted. Anything you type now replaces it.'}
              </Text>
            ) : null}

            <TextInput
              value={note}
              onChangeText={handleNoteChange}
              onBlur={handleNoteBlur}
              placeholder="Write a personal thought, boundary, or context…"
              placeholderTextColor={colors.muted}
              multiline
              accessibilityLabel={`Private encrypted note for ${item.title}`}
              style={[
                styles.noteInput,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.primary,
                },
              ]}
            />
          </View>

          {errorMsg ? (
            <Text style={[styles.errorText, { color: colors.error }]}>
              {errorMsg}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open full screen detail for ${item.title}`}
            onPress={handleOpenDetail}
            style={({ pressed }) => [
              styles.detailLinkButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text
              style={[styles.detailLinkText, { color: colors.accentCool }]}
            >
              Open full view →
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: SPACING.sm + 2,
    marginBottom: SPACING.sm,
    ...SHADOWS.subtle,
  },
  headerPressable: {
    minHeight: 44,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: SPACING.xs,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.xs,
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tonePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  tonePillText: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  spacer: {
    flex: 1,
  },
  ratedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginRight: 4,
  },
  ratedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  title: {
    ...TYPOGRAPHY.h3,
    marginBottom: 4,
  },
  ratingSection: {
    marginTop: 4,
  },
  privacyLabel: {
    ...TYPOGRAPHY.caption,
    marginTop: 4,
  },
  expandedContent: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
  },
  description: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  noteSection: {
    marginBottom: SPACING.xs,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  noteLabel: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  saveStatus: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  noteInput: {
    minHeight: 76,
    borderRadius: RADII.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    ...TYPOGRAPHY.body,
    textAlignVertical: 'top',
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    marginTop: 4,
  },
  detailLinkButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  detailLinkText: {
    ...TYPOGRAPHY.button,
    fontSize: 14,
  },
});

export default LibraryItemCard;
