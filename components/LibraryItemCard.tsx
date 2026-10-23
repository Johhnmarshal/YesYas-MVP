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
  type DesireRow,
  upsertDesireNote,
  upsertDesireRating,
} from '@/lib/desires';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export interface LibraryItemCardProps {
  item: DesireLibraryItem;
  userId: string;
  pairingId: string | null;
  desire?: DesireRow;
  onDesireUpdated?: (updated: DesireRow) => void;
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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
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

        const saved = await upsertDesireNote({
          userId,
          pairingId,
          libraryItemId: item.id,
          note: textToSave,
          defaultRating: currentRating ?? 3,
        });

        if (pairingId !== null) {
          await upsertDesireNote({
            userId,
            pairingId: null,
            libraryItemId: item.id,
            note: textToSave,
            defaultRating: currentRating ?? 3,
          });
        }

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
        const saved = await upsertDesireRating({
          userId,
          pairingId,
          libraryItemId: item.id,
          rating: nextRating,
          note: note.trim() ? note : undefined,
        });

        if (pairingId !== null) {
          await upsertDesireRating({
            userId,
            pairingId: null,
            libraryItemId: item.id,
            rating: nextRating,
            note: note.trim() ? note : undefined,
          });
        }

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

  const handleNoteBlur = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      void persistNote(note, rating);
    }
  }, [note, persistNote, rating]);

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
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
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
    borderRadius: 6,
  },
  tierBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tonePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
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
    borderRadius: 10,
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
