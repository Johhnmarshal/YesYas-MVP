import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { usePresence } from '@/components/PresenceProvider';
import { showMessage } from '@/lib/alert';
import { friendlyError } from '@/lib/errors';
import { AVATARS } from '@/lib/presence-state';
import { supabase } from '@/lib/supabase';
import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

interface TogetherSettingsProps {
  userId: string;
  initial: { share_presence: boolean; share_heat: boolean; avatar: string | null };
}

type Field = 'share_presence' | 'share_heat' | 'avatar';

/**
 * Settings > Together: the opt-in presence controls (20261113000001).
 * Everything here is off until switched on.
 */
export function TogetherSettings({ userId, initial }: TogetherSettingsProps) {
  const colors = useThemeColors();
  const { refresh, partner } = usePresence();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState<Field | null>(null);

  const save = useCallback(
    async <K extends Field>(field: K, value: (typeof initial)[K]) => {
      const previous = values[field];
      setValues((v) => ({ ...v, [field]: value }));
      setSaving(field);
      try {
        const patch: Partial<typeof initial> = { [field]: value };
        const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
        if (error) throw error;
        refresh();
      } catch (err) {
        setValues((v) => ({ ...v, [field]: previous }));
        showMessage('Update Error', friendlyError(err, 'Could not save that setting.'));
      } finally {
        setSaving(null);
      }
    },
    [refresh, userId, values],
  );

  const partnerShares = partner?.sharesPresence === true;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Together</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Small signals for your partner. All off until you switch them on.
      </Text>

      <Pressable
        style={styles.row}
        onPress={() => void save('share_presence', !values.share_presence)}
        accessible={false}
      >
        <View style={styles.text}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>Show when I am in the app</Text>
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>
            While the app is open, your partner sees that you are here, and whether you are in the
            library. Never what you look at or rate. It only works if you both switch it on
            {values.share_presence && partner
              ? partnerShares
                ? '. Your partner has it on.'
                : '. Your partner has not switched it on yet.'
              : '.'}
          </Text>
        </View>
        <Switch
          value={values.share_presence}
          onValueChange={(v) => void save('share_presence', v)}
          disabled={saving === 'share_presence'}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
          accessibilityLabel="Show my partner when I am in the app"
        />
      </Pressable>

      <Pressable
        style={styles.row}
        onPress={() => void save('share_heat', !values.share_heat)}
        accessible={false}
      >
        <View style={styles.text}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>Share my heat limit</Text>
          <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>
            Your partner sees how hot you have set it (sensory, suggestive or explicit), so they
            know where you are comfortable. Never your ratings.
          </Text>
        </View>
        <Switch
          value={values.share_heat}
          onValueChange={(v) => void save('share_heat', v)}
          disabled={saving === 'share_heat'}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
          accessibilityLabel="Share my heat limit with my partner"
        />
      </Pressable>

      <Text style={[styles.rowTitle, styles.avatarTitle, { color: colors.text }]}>Your avatar</Text>
      <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Your partner sees it next to your name.</Text>
      <View style={styles.avatars} accessibilityRole="radiogroup">
        {AVATARS.map((a) => {
          const selected = values.avatar === a;
          return (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Avatar ${a}`}
              onPress={() => void save('avatar', selected ? null : a)}
              style={[
                styles.avatar,
                {
                  borderColor: selected ? colors.accentWarm : colors.border,
                  backgroundColor: selected ? colors.accentWarmSubtle : colors.bg,
                },
              ]}
            >
              <Text style={styles.avatarText}>{a}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: SPACING.md, borderRadius: 16, borderWidth: 1 },
  title: { fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '700', marginBottom: 2 },
  subtitle: { fontSize: TYPOGRAPHY.caption.fontSize, marginBottom: SPACING.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: SPACING.xs,
    gap: SPACING.sm,
  },
  text: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  avatarTitle: { marginTop: SPACING.sm },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: RADII.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22 },
});
