import { Ionicons } from '@expo/vector-icons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StarRating } from '@/components/StarRating';
import {
  type DesireLibraryItem,
  fetchLibraryItemById,
  fetchUserDesires,
  upsertDesireNote,
  upsertDesireRating,
} from '@/lib/desires';
import type { EncryptedFieldState } from '@/lib/crypto';
import { isTierWithinCeiling } from '@/lib/library-filter';
import { getActiveOrPendingPairing } from '@/lib/pairing';
import { supabase } from '@/lib/supabase';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

type NoteSaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Full-screen Desire Library item detail & private encrypted rating screen
 * (`/(app)/library/[id]`).
 */
export default function DesireLibraryItemDetailScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const itemId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [userId, setUserId] = useState<string>('');
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [item, setItem] = useState<DesireLibraryItem | null>(null);

  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  // 'ok' unless a note exists that this device could not decrypt.
  const [noteState, setNoteState] = useState<EncryptedFieldState>('ok');

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingSaving, setRatingSaving] = useState<boolean>(false);
  const [noteSaveState, setNoteSaveState] = useState<NoteSaveState>('idle');
  const [clearingRating, setClearingRating] = useState<boolean>(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const noteRef = useRef<string>('');
  const ratingRef = useRef<number | null>(null);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    ratingRef.current = rating;
  }, [rating]);

  // Holds the latest flushPendingNote, which is defined further down. The
  // cleanup cannot reference it directly without closing over the first render.
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Clearing the flag first makes persistNote skip its setState calls
      // while the encrypted write still goes out.
      isMountedRef.current = false;
      // Flush rather than discard. handleBack and the input's onBlur already
      // flushed, so the common paths were safe — but every other way out of
      // this screen (Android hardware back, the iOS back gesture, a tab
      // switch) went through this cleanup and silently dropped up to 800ms of
      // typing.
      flushRef.current();
    };
  }, []);

  const loadItemDetail = useCallback(async () => {
    if (!itemId) {
      setLoadError('Missing desire item ID.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const currentUser = authData.user;
      if (!currentUser) {
        throw new Error('Please sign in to view this item.');
      }
      setUserId(currentUser.id);

      const [fetchedItem, pairingRes, profileRes] = await Promise.all([
        fetchLibraryItemById(itemId),
        getActiveOrPendingPairing(currentUser.id),
        supabase
          .from('profiles')
          .select('content_tier_preference')
          .eq('id', currentUser.id)
          .maybeSingle(),
      ]);

      if (!fetchedItem) {
        throw new Error('This desire item could not be found.');
      }

      // The content tier ceiling has to hold here too, not just in the list.
      // This screen fetched by id and never looked at the user's preference,
      // so an above-ceiling item rendered in full — title, description and a
      // working star rating. It did not even need a hand-typed URL: browse
      // explicit items, lower the tier in Settings, press Back, and the
      // detail screen re-renders the item you just opted out of.
      //
      // Checked before setItem so the content never reaches state, let alone
      // the screen.
      const ceiling = profileRes.data?.content_tier_preference ?? 'suggestive';
      if (!isTierWithinCeiling(fetchedItem.tier, ceiling)) {
        throw new Error(
          `This item is in the ${fetchedItem.tier} tier, which is above your current content setting. Raise your content tier in Settings if you want to see it.`,
        );
      }

      const activePairingId =
        pairingRes &&
        (pairingRes.status === 'active' || pairingRes.status === 'paused')
          ? pairingRes.id
          : null;

      setPairingId(activePairingId);
      setPartnerName(
        activePairingId ? pairingRes?.partner_display_name ?? 'Partner' : null,
      );

      const [soloDesires, pairedDesires] = await Promise.all([
        fetchUserDesires(currentUser.id, null),
        activePairingId
          ? fetchUserDesires(currentUser.id, activePairingId)
          : Promise.resolve([]),
      ]);

      const matchingPaired = pairedDesires.find(
        (d) => d.library_item_id === fetchedItem.id,
      );
      const matchingSolo = soloDesires.find(
        (d) => d.library_item_id === fetchedItem.id,
      );
      const chosenDesire = matchingPaired ?? matchingSolo ?? null;

      if (!isMountedRef.current) return;

      setItem(fetchedItem);
      setRating(chosenDesire?.rating ?? null);
      setNote(chosenDesire?.note ?? '');
      setNoteState(chosenDesire?.noteState ?? 'ok');
      setNoteSaveState(chosenDesire?.note ? 'saved' : 'idle');
    } catch (err) {
      if (!isMountedRef.current) return;
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load desire details.',
      );
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [itemId]);

  useEffect(() => {
    void loadItemDetail();
  }, [loadItemDetail]);

  const persistNote = useCallback(
    async (textToSave: string, currentRating: number | null) => {
      if (!userId || !item) return;
      try {
        if (isMountedRef.current) {
          setNoteSaveState('saving');
          setActionError(null);
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
        }
        setNoteSaveState('saved');
      } catch (err) {
        if (!isMountedRef.current) return;
        setNoteSaveState('error');
        setActionError(
          err instanceof Error ? err.message : 'Could not save encrypted note.',
        );
      }
    },
    [item, pairingId, userId],
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

  const handleBack = useCallback(() => {
    flushPendingNote();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/library' as Href);
    }
  }, [flushPendingNote]);

  const handleRatingChange = useCallback(
    async (nextRating: number) => {
      if (!userId || !item) return;
      const previousRating = rating;
      setRating(nextRating);
      ratingRef.current = nextRating;
      setRatingSaving(true);
      setActionError(null);

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
        await Promise.all(promises);
      } catch (err) {
        if (!isMountedRef.current) return;
        setRating(previousRating);
        ratingRef.current = previousRating;
        setActionError(
          err instanceof Error ? err.message : 'Failed to save rating.',
        );
      } finally {
        if (isMountedRef.current) {
          setRatingSaving(false);
        }
      }
    },
    [item, note, pairingId, rating, userId],
  );

  const handleNoteChange = useCallback(
    (nextText: string) => {
      setNote(nextText);
      noteRef.current = nextText;
      setNoteSaveState('saving');
      setActionError(null);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void persistNote(nextText, ratingRef.current);
      }, 800);
    },
    [persistNote],
  );

  const handleSavePrivatelyNow = useCallback(async () => {
    if (!userId || !item) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const effectiveRating = rating ?? 3;
    setRatingSaving(true);
    setNoteSaveState('saving');
    setActionError(null);

    try {
      const promises = [
        upsertDesireRating({
          userId,
          pairingId,
          libraryItemId: item.id,
          rating: effectiveRating,
          note,
        }),
        ...(pairingId !== null
          ? [
              upsertDesireRating({
                userId,
                pairingId: null,
                libraryItemId: item.id,
                rating: effectiveRating,
                note,
              }),
            ]
          : []),
      ];
      const [saved] = await Promise.all(promises);

      if (!isMountedRef.current) return;
      setRating(saved.rating);
      setNoteSaveState('saved');
    } catch (err) {
      if (!isMountedRef.current) return;
      setNoteSaveState('error');
      setActionError(
        err instanceof Error ? err.message : 'Could not save your desire.',
      );
    } finally {
      if (isMountedRef.current) {
        setRatingSaving(false);
      }
    }
  }, [item, note, pairingId, rating, userId]);

  const handleClearRating = useCallback(async () => {
    if (!userId || !item) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setClearingRating(true);
    setActionError(null);

    try {
      const { error } = await supabase
        .from('desires')
        .delete()
        .eq('user_id', userId)
        .eq('library_item_id', item.id);

      if (error) throw error;

      if (!isMountedRef.current) return;
      setRating(null);
      setNote('');
      setNoteSaveState('idle');
    } catch (err) {
      if (!isMountedRef.current) return;
      setActionError(
        err instanceof Error ? err.message : 'Could not clear rating.',
      );
    } finally {
      if (isMountedRef.current) {
        setClearingRating(false);
      }
    }
  }, [item, userId]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Navigation Row */}
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Desire Library"
            onPress={handleBack}
            style={({ pressed }) => [
              styles.backButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backButtonText, { color: colors.primary }]}>
              Back to Library
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.secondary }]}>
              Loading desire item…
            </Text>
          </View>
        ) : loadError || !item ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
              },
            ]}
          >
            <Text style={[styles.errorHeading, { color: colors.error }]}>
              Unable to load item
            </Text>
            <Text style={[styles.bodyText, { color: colors.secondary }]}>
              {loadError ?? 'Item not found.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading desire item"
              onPress={() => void loadItemDetail()}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Item Header Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.tierBadge,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.tierBadgeText}>
                    {item.tier.toUpperCase()}
                  </Text>
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
                    <Text
                      style={[
                        styles.tonePillText,
                        { color: colors.secondary },
                      ]}
                    >
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.title, { color: colors.primary }]}>
                {item.title}
              </Text>

              {item.description ? (
                <Text style={[styles.description, { color: colors.secondary }]}>
                  {item.description}
                </Text>
              ) : null}
            </View>

            {/* Rating Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor:
                    rating !== null ? colors.accentWarm : colors.border,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                How does this feel to you?
              </Text>

              <StarRating
                value={rating}
                onChange={handleRatingChange}
                disabled={ratingSaving || clearingRating}
                showCaption
                size={30}
              />

              <View
                style={[
                  styles.privacyBanner,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.privacyTitle, { color: colors.primary }]}
                >
                  🔒 Only you see your ratings
                </Text>
                <Text
                  style={[
                    styles.privacyDescription,
                    { color: colors.secondary },
                  ]}
                >
                  {pairingId
                    ? `Paired with ${partnerName ?? 'your partner'}. Rejections (1–2★) are a hard veto and never surface. Only mutual matches (4–5★) or Curiosity Bridges (one 4–5★, one 3★) appear in a couple reveal.`
                    : 'Your solo ratings are stored privately and will automatically carry over if you invite a partner later.'}
                </Text>
              </View>
            </View>

            {/* Encrypted Private Note Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.noteHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                  Private note (encrypted — never shared in reveals)
                </Text>
                {noteSaveState === 'saving' ? (
                  <Text style={[styles.saveStatus, { color: colors.muted }]}>
                    Saving…
                  </Text>
                ) : noteSaveState === 'saved' ? (
                  <Text style={[styles.saveStatus, { color: colors.success }]}>
                    Encrypted & saved
                  </Text>
                ) : null}
              </View>

              <Text style={[styles.noteSubtitle, { color: colors.secondary }]}>
                Encrypted on your device (`enc:v1:`) before reaching the
                database. Your partner never sees this note.
              </Text>

              {noteState !== 'ok' ? (
                <Text
                  style={[styles.saveStatus, { color: colors.error }]}
                  accessibilityLiveRegion="polite"
                >
                  {noteState === 'locked'
                    ? 'You saved a note here, but this device cannot read it yet. Unlock with your recovery code in Settings to see it again.'
                    : 'You saved a note here, but it can no longer be decrypted. Anything you type now replaces it.'}
                </Text>
              ) : null}

              <TextInput
                value={note}
                onChangeText={handleNoteChange}
                onBlur={flushPendingNote}
                placeholder="Write a boundary, memory, or what would make this feel safe and exciting…"
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

              {actionError ? (
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {actionError}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save rating and encrypted note privately"
                disabled={ratingSaving || clearingRating}
                onPress={() => void handleSavePrivatelyNow()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || ratingSaving ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {ratingSaving ? 'Saving privately…' : 'Save Privately'}
                </Text>
              </Pressable>

              {rating !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear rating and private note for this item"
                  disabled={clearingRating || ratingSaving}
                  onPress={() => void handleClearRating()}
                  style={({ pressed }) => [
                    styles.clearButton,
                    { opacity: pressed || clearingRating ? 0.6 : 1 },
                  ]}
                >
                  <Text
                    style={[styles.clearButtonText, { color: colors.error }]}
                  >
                    {clearingRating ? 'Clearing…' : 'Clear Rating'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  topBar: {
    marginBottom: SPACING.sm,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xs,
    paddingVertical: 4,
  },
  backButtonText: {
    ...TYPOGRAPHY.button,
  },
  centerBox: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
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
  title: {
    ...TYPOGRAPHY.h1,
    marginBottom: SPACING.xs,
  },
  description: {
    ...TYPOGRAPHY.body,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.xs,
    flexShrink: 1,
  },
  privacyBanner: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: 10,
    borderWidth: 1,
  },
  privacyTitle: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    marginBottom: 4,
  },
  privacyDescription: {
    ...TYPOGRAPHY.caption,
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: 4,
  },
  saveStatus: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  noteSubtitle: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.sm,
  },
  noteInput: {
    minHeight: 110,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    ...TYPOGRAPHY.body,
    textAlignVertical: 'top',
    marginBottom: SPACING.sm,
  },
  errorHeading: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.xs,
  },
  bodyText: {
    ...TYPOGRAPHY.body,
    marginBottom: SPACING.sm,
  },
  errorText: {
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.sm,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
    color: '#FFFFFF',
  },
  clearButton: {
    minHeight: 44,
    marginTop: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    ...TYPOGRAPHY.button,
  },
});
