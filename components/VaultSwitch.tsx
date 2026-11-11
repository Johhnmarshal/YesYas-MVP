import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RADII, SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

/**
 * The Vault holds two things: the private journal (with the reflection
 * coach) and fantasies. This switches between them.
 */
export function VaultSwitch({ current }: { current: 'journal' | 'fantasies' }) {
  const colors = useThemeColors();
  const tabs: { key: 'journal' | 'fantasies'; label: string; href: Href }[] = [
    { key: 'fantasies', label: 'Fantasies', href: '/(app)/journal/fantasies' as Href },
    { key: 'journal', label: 'Private journal', href: '/(app)/journal' as Href },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { backgroundColor: colors.surfaceHighlight }]}
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) router.replace(t.href);
            }}
            style={[
              styles.tab,
              active ? { backgroundColor: colors.surface, borderColor: colors.border } : null,
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.text : colors.secondary }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: RADII.pill, padding: 4, gap: 4, alignSelf: 'stretch' },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: SPACING.sm,
  },
  label: { ...TYPOGRAPHY.caption, fontWeight: '600' },
});
