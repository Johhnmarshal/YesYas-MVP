import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hapticLight, hapticMedium } from '@/lib/haptics';
import { SPACING, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

export const RATING_LABELS: Record<number, string> = {
  1: 'Hard no — not for me',
  2: 'Pass for now',
  3: 'Curious — open to talking',
  4: 'Would love this',
  5: 'Yes — deeply want this',
};

export interface StarRatingProps {
  value: number | null;
  onChange: (rating: number) => void;
  disabled?: boolean;
  showCaption?: boolean;
  size?: number;
  allowClear?: boolean;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Accessible 1–5 star selector with 44x44pt minimum touch targets, sensory
 * haptic feedback, and warm terracotta highlight (`colors.accentWarm`) for selected stars.
 */
export function StarRating({
  value,
  onChange,
  disabled = false,
  showCaption = false,
  size = 26,
  allowClear = false,
}: StarRatingProps) {
  const colors = useThemeColors();

  const handlePress = (star: number) => {
    if (disabled) return;
    if (allowClear && value === star) {
      void hapticLight();
      onChange(0);
      return;
    }
    if (star >= 4) {
      void hapticMedium();
    } else {
      void hapticLight();
    }
    onChange(star);
  };

  return (
    <View style={styles.container}>
      <View
        style={styles.starsRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Desire rating from 1 to 5 stars"
      >
        {STARS.map((star) => {
          const isFilled = value !== null && star <= value;
          const isSelected = value === star;
          const label = RATING_LABELS[star] ?? `${star} stars`;

          return (
            <Pressable
              key={star}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{
                checked: isSelected,
                disabled,
              }}
              accessibilityLabel={`Rate ${star} out of 5 stars: ${label}`}
              onPress={() => handlePress(star)}
              style={({ pressed }) => [
                styles.starButton,
                {
                  opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
                  transform: [{ scale: pressed ? 0.88 : 1 }],
                },
              ]}
            >
              <Ionicons
                name={isFilled ? 'star' : 'star-outline'}
                size={size}
                color={isFilled ? colors.accentWarm : colors.muted}
              />
            </Pressable>
          );
        })}
      </View>

      {showCaption ? (
        <Text
          style={[
            styles.caption,
            { color: value !== null ? colors.secondary : colors.textMuted },
          ]}
        >
          {value !== null
            ? `${value}/5 — ${RATING_LABELS[value]}`
            : 'Tap a star to rate privately (1 = No, 3 = Curious, 5 = Yes!)'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  caption: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs / 2,
  },
});

export default StarRating;
