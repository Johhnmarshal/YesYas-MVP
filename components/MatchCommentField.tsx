import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { MATCH_COMMENT_MAX_LENGTH, saveMatchComment } from '@/lib/desires';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 900;

interface MatchCommentFieldProps {
  userId: string;
  pairingId: string | null;
  libraryItemId: string;
  itemTitle: string;
  /** The user's current rating for this item, or null when unrated. */
  rating: number | null;
  /** The comment as last loaded from the server. */
  initialComment: string | null;
  onSaved?: (comment: string | null) => void;
}

/**
 * The partner-visible comment on a desire.
 *
 * It only ever reaches the partner through a reveal, and only when the item is
 * a mutual match (both rated 4 or 5), so the field appears once the user has
 * rated the item 4 or 5. It is plain text on the server, unlike the private
 * note above it, and the hint says so: see migration 20261031000003.
 */
export function MatchCommentField({
  userId,
  pairingId,
  libraryItemId,
  itemTitle,
  rating,
  initialComment,
  onSaved,
}: MatchCommentFieldProps) {
  const colors = useThemeColors();
  const [text, setText] = useState<string>(initialComment ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Mirrors lastSavedRef for rendering; the ref is what persist() compares
  // against so a save in flight never races a re-render.
  const [savedText, setSavedText] = useState<string>((initialComment ?? '').trim());

  const lastSavedRef = useRef<string>((initialComment ?? '').trim());
  const textRef = useRef<string>(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    setText(initialComment ?? '');
    lastSavedRef.current = (initialComment ?? '').trim();
    setSavedText((initialComment ?? '').trim());
  }, [initialComment]);

  const persist = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === lastSavedRef.current) {
        if (mountedRef.current) setSaveState('idle');
        return;
      }
      if (mountedRef.current) {
        setSaveState('saving');
        setErrorMessage(null);
      }
      try {
        const saved = await saveMatchComment({
          userId,
          pairingId,
          libraryItemId,
          comment: trimmed,
        });
        lastSavedRef.current = (saved ?? '').trim();
        onSaved?.(saved);
        if (mountedRef.current) {
          setSavedText(lastSavedRef.current);
          setSaveState('saved');
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setSaveState('error');
          setErrorMessage(
            err instanceof Error ? err.message : 'Could not save your comment.',
          );
        }
      }
    },
    [libraryItemId, onSaved, pairingId, userId],
  );

  // Save anything still pending when the card collapses or the screen closes.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void persist(textRef.current);
      }
    };
  }, [persist]);

  const handleChange = useCallback(
    (next: string) => {
      setText(next);
      setSaveState('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void persist(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  const handleBlur = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist(textRef.current);
  }, [persist]);

  const ratedHighly = rating !== null && rating >= 4;
  const hasSavedComment = savedText.length > 0;
  // No rating means no row to hold a comment (clearing a rating deletes the
  // row, comment included). Below 4 the field only stays to show a comment
  // that is already saved, because it can no longer reach the partner.
  if (rating === null || (!ratedHighly && !hasSavedComment)) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.secondary }]}>
          Comment for your partner
        </Text>
        {saveState === 'saving' ? (
          <Text style={[styles.status, { color: colors.textMuted }]}>Saving…</Text>
        ) : saveState === 'saved' ? (
          <Text style={[styles.status, { color: colors.success }]}>Saved</Text>
        ) : null}
      </View>

      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {ratedHighly
          ? pairingId
            ? 'Your partner sees this only if you both rate this 4 or 5. Unlike your private note, it is not end to end encrypted.'
            : 'If you pair and you both rate this 4 or 5, your partner will see this. Unlike your private note, it is not end to end encrypted.'
          : 'Your comment is kept, but it only appears when you both rate this 4 or 5.'}
      </Text>

      <TextInput
        value={text}
        onChangeText={handleChange}
        onBlur={handleBlur}
        maxLength={MATCH_COMMENT_MAX_LENGTH}
        multiline
        placeholder="Why this appeals to you, or how you would like to try it"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={`Comment your partner sees if ${itemTitle} is a mutual match`}
        style={[
          styles.input,
          {
            backgroundColor: colors.bg,
            borderColor: colors.border,
            color: colors.primary,
          },
        ]}
      />

      <View style={styles.footerRow}>
        {saveState === 'error' && errorMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.status, styles.footerError, { color: colors.error }]}
          >
            {errorMessage}
          </Text>
        ) : (
          <View style={styles.footerError} />
        )}
        <Text style={[styles.status, { color: colors.textMuted }]}>
          {text.length}/{MATCH_COMMENT_MAX_LENGTH}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  hint: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.xs,
  },
  input: {
    ...TYPOGRAPHY.body,
    minHeight: 72,
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: SPACING.xs,
  },
  footerError: {
    flex: 1,
  },
  status: {
    ...TYPOGRAPHY.caption,
  },
});

export default MatchCommentField;
