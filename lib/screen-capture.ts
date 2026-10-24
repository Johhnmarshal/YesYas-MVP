import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Web-safe screen-capture protection helper (R-13).
 *
 * Prevents screen recording and screenshots on Android devices while viewing
 * sensitive intimate screens (Double-Blind Reveal matches and Private Journal).
 * On iOS, the OS does not allow third-party apps to block screenshots at the
 * window manager level; this limitation is documented in the Privacy Model (R-15).
 *
 * Every caller must pass its own `key`. expo-screen-capture tracks active
 * protection in a Set of keys and releases it the moment that Set empties, so
 * screens sharing one key unprotect each other: with a single shared key,
 * closing a journal entry drops protection while the journal list is still on
 * screen, and the list never remounts to re-apply it. Distinct keys let the
 * library reference-count properly — protection lifts only once the last
 * protected screen has unmounted.
 */

/** Keys are centralised so two screens cannot accidentally share one. */
export const SCREEN_CAPTURE_KEYS = {
  journalList: 'yesyas-journal-list',
  journalEntry: 'yesyas-journal-entry',
  reveal: 'yesyas-reveal',
} as const;

export type ScreenCaptureKey =
  (typeof SCREEN_CAPTURE_KEYS)[keyof typeof SCREEN_CAPTURE_KEYS];

export async function enableScreenCaptureProtection(
  key: ScreenCaptureKey,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ScreenCapture.preventScreenCaptureAsync(key);
  } catch (err) {
    console.warn('Unable to enable screen capture protection:', err);
  }
}

export async function disableScreenCaptureProtection(
  key: ScreenCaptureKey,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ScreenCapture.allowScreenCaptureAsync(key);
  } catch (err) {
    console.warn('Unable to disable screen capture protection:', err);
  }
}

/**
 * Hook to protect a screen on mount and release its own claim on unmount.
 *
 * @param key This screen's entry in {@link SCREEN_CAPTURE_KEYS}. Required, and
 * unique per screen — see the note above on why a shared key unprotects.
 */
export function useScreenCaptureProtection(
  key: ScreenCaptureKey,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    void enableScreenCaptureProtection(key);

    return () => {
      void disableScreenCaptureProtection(key);
    };
  }, [enabled, key]);
}
