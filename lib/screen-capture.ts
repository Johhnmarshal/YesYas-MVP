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
 */
export async function enableScreenCaptureProtection(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ScreenCapture.preventScreenCaptureAsync();
  } catch (err) {
    console.warn('Unable to enable screen capture protection:', err);
  }
}

export async function disableScreenCaptureProtection(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await ScreenCapture.allowScreenCaptureAsync();
  } catch (err) {
    console.warn('Unable to disable screen capture protection:', err);
  }
}

/**
 * Hook to automatically protect a screen on mount and release protection on unmount.
 */
export function useScreenCaptureProtection(enabled = true): void {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    void enableScreenCaptureProtection();

    return () => {
      void disableScreenCaptureProtection();
    };
  }, [enabled]);
}
