import { useColorScheme } from 'react-native';

import type { DesireTier, ToneLabel } from './database.types';

export const COLORS = {
  bg: '#FBF8F4',
  surface: '#FFFFFF',
  primary: '#2C3E50',
  secondary: '#5B6A7A',
  muted: '#9AA3AE',
  border: '#E1E5EA',
  accentWarm: '#C9856B',
  accentCool: '#4A90B8',
  error: '#B23A48',
  success: '#3A7D44',
} as const;

export const DARK_COLORS = {
  bg: '#1A1F26',
  surface: '#252B34',
  primary: '#ECF0F1',
  secondary: '#A0AAB4',
  muted: '#6C7A89',
  border: '#343D4B',
  accentWarm: '#C9856B',
  accentCool: '#4A90B8',
  error: '#D9534F',
  success: '#4CAE4C',
} as const;

export type ThemeColors = {
  [K in keyof typeof COLORS]: string;
};

export const SPACING = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

export const TYPOGRAPHY = {
  display: {
    fontSize: 36,
    fontWeight: '700' as const,
    lineHeight: 52,
  },
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 40,
  },
  h2: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 29,
  },
  h3: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 19,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
} as const;

export interface ToneOption {
  value: ToneLabel;
  label: string;
  description: string;
}

export const TONE_OPTIONS: ToneOption[] = [
  {
    value: 'romantic',
    label: 'Romantic',
    description: 'Soft, imagery-based',
  },
  {
    value: 'playful',
    label: 'Playful',
    description: 'Light and exploratory',
  },
  {
    value: 'direct',
    label: 'Direct',
    description: 'Clear and specific',
  },
];

export interface TierOption {
  value: DesireTier;
  label: string;
  description: string;
}

export const TIER_OPTIONS: TierOption[] = [
  {
    value: 'sensory',
    label: 'Sensory',
    description: 'Touch, warmth, physical closeness',
  },
  {
    value: 'suggestive',
    label: 'Suggestive',
    description: 'Intimate but not explicit (default)',
  },
  {
    value: 'explicit',
    label: 'Explicit',
    description: 'Fully frank content',
  },
];

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? DARK_COLORS : COLORS;
}
