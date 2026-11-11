import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StarRating } from '@/components/StarRating';
import { useVoice } from '@/components/VoiceProvider';
import { type DesireLibraryItem, upsertDesireRating } from '@/lib/desires';
import { friendlyError } from '@/lib/errors';
import { RADII, SHADOWS, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

interface TonightPackProps {
  userId: string;
  /** Active or paused pairing; ratings are saved to it and to solo, like the library. */
  pairingId: string | null;
  items: DesireLibraryItem[];
  /** Ratings already given to these items (today's), by item id. */
  ratings: Record<string, number>;
  onRated?: () => void;
}

/**
 * "3 for tonight": the daily pack (lib/packs.ts) rated right on Home, so a
 * session is one minute rather than a trip into a 200-item list.
 */
export function TonightPack({ userId, pairingId, items, ratings, onRated }: TonightPackProps) {
  const colors = useThemeColors();
  const { voice } = useVoice();
  const [local, setLocal] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valueFor = (id: string): number | null => local[id] ?? ratings[id] ?? null;
  const doneCount = items.filter((it) => valueFor(it.id)).length;
  const allDone = items.length > 0 && doneCount === items.length;

  const rate = useCallback(
    async (itemId: string, rating: number) => {
      if (!userId || rating < 1) return;
      const before = local[itemId];
      setLocal((m) => ({ ...m, [itemId]: rating }));
      setSaving(itemId);
      setError(null);
      try {
        await Promise.all([
          upsertDesireRating({ userId, pairingId, libraryItemId: itemId, rating }),
          ...(pairingId
            ? [upsertDesireRating({ userId, pairingId: null, libraryItemId: itemId, rating })]
            : []),
        ]);
        onRated?.();
      } catch (err) {
        setLocal((m) => {
          const next = { ...m };
          if (before) next[itemId] = before;
          else delete next[itemId];
          return next;
        });
        setError(friendlyError(err, 'Could not save that rating.'));
      } finally {
        setSaving(null);
      }
    },
    [local, onRated, pairingId, userId],
  );

  if (items.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.primary }]}>{voice.tonightTitle}</Text>
        <Text
          style={[styles.count, { color: allDone ? colors.success : colors.secondary }]}
          accessibilityLabel={`${doneCount} of ${items.length} rated`}
        >
          {doneCount}/{items.length}
        </Text>
      </View>
      <Text style={[styles.subtitle, { color: colors.secondary }]}>
        {allDone ? voice.tonightDone : voice.tonightSubtitle}
      </Text>

      {items.map((item, i) => (
        <View
          key={item.id}
          style={[
            styles.item,
            i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
          ]}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.title}`}
            onPress={() => router.push(`/(app)/library/${item.id}` as Href)}
            style={styles.itemText}
          >
            <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
            {item.description ? (
              <Text numberOfLines={2} style={[styles.itemBody, { color: colors.secondary }]}>
                {item.description}
              </Text>
            ) : null}
          </Pressable>
          <StarRating
            value={valueFor(item.id)}
            onChange={(r) => void rate(item.id, r)}
            disabled={saving === item.id}
            showCaption
            size={24}
          />
        </View>
      ))}

      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}

      {allDone ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(app)/library' as Href)}
          style={styles.more}
        >
          <Text style={[styles.moreText, { color: colors.accentWarm }]}>Keep going in the library</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.accentWarm} />
        </Pressable>
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
    gap: SPACING.xs,
    ...SHADOWS.elevated,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...TYPOGRAPHY.h2 },
  count: { ...TYPOGRAPHY.h3 },
  subtitle: { ...TYPOGRAPHY.caption },
  item: { paddingTop: SPACING.sm, gap: SPACING.xs },
  itemText: { gap: 2 },
  itemTitle: { ...TYPOGRAPHY.h3 },
  itemBody: { ...TYPOGRAPHY.caption },
  error: { ...TYPOGRAPHY.caption },
  more: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: SPACING.xs, minHeight: 44 },
  moreText: { ...TYPOGRAPHY.button },
});
