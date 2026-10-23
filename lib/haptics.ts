import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

/**
 * Safe, cross-platform haptic feedback utilities.
 * Automatically no-ops on web/SSR so calls never throw.
 */
export async function hapticLight(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticMedium(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticHeavy(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticSelection(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticSuccess(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticWarning(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Unsupported device or haptics disabled
  }
}

export async function hapticError(): Promise<void> {
  if (isWeb) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Unsupported device or haptics disabled
  }
}
