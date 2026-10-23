import { useColorScheme } from 'react-native';

import type { DesireTier, ToneLabel } from './database.types';

export const COLORS = {
  bg: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFDFB',
  primary: '#1E293B',
  secondary: '#5A6878',
  muted: '#94A3B8',
  border: '#E8E2D9',
  accentWarm: '#C9856B',
  accentWarmSubtle: '#F6ECE7',
  accentGold: '#D4AF37',
  accentCool: '#4A85A3',
  error: '#B23A48',
  success: '#2E7D4E',
  text: '#1E293B',
} as const;

export const DARK_COLORS = {
  bg: '#0F1318',
  surface: '#181E26',
  surfaceElevated: '#212934',
  primary: '#F1EDE6',
  secondary: '#9BA7B6',
  muted: '#5F6D7E',
  border: '#28323E',
  accentWarm: '#D99880',
  accentWarmSubtle: '#2E221E',
  accentGold: '#E6C665',
  accentCool: '#5A96B4',
  error: '#D9534F',
  success: '#3FB950',
  text: '#F1EDE6',
} as const;

export type ThemeColors = {
  [K in keyof typeof COLORS]: string;
};

export const SHADOWS = {
  subtle: {
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  goldGlow: {
    shadowColor: '#D4AF37',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  terracottaGlow: {
    shadowColor: '#C9856B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 3,
  },
} as const;

export const RADII = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 9999,
} as const;

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
