import { Platform, Share } from 'react-native';

/**
 * What actually happened, so the caller can say so.
 *
 * `unavailable` is not an error to swallow — it means the content did not
 * leave the app and the user has nothing. Callers must surface it.
 */
export type ShareOutcome = 'shared' | 'copied' | 'unavailable';

/**
 * Share text, falling back to the clipboard on the web.
 *
 * react-native-web's Share is implemented, but only as a thin wrapper over the
 * Web Share API: when `navigator.share` is undefined it rejects with
 * "Share is not supported in this browser". Every call site here wrapped that
 * in a try/catch commented "user dismissed share sheet", so on any browser
 * without Web Share the four share buttons in this app did nothing at all and
 * said nothing — the same failure shape as react-native-web's no-op Alert.
 *
 * Web Share is not niche-missing. It is absent from Firefox on desktop and
 * from embedded Chromium builds; measured in one such build while writing
 * this, `typeof navigator.share` was "undefined" while
 * `navigator.clipboard.writeText` was a function. The clipboard is the right
 * fallback: for an invite code or a clinical summary, "it's on your clipboard"
 * is as useful as a share sheet.
 */
export async function shareText(options: {
  title?: string;
  message: string;
}): Promise<ShareOutcome> {
  const { title, message } = options;

  if (Platform.OS !== 'web') {
    try {
      await Share.share(title ? { title, message } : { message });
      return 'shared';
    } catch {
      return 'unavailable';
    }
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, text: message });
      return 'shared';
    } catch (err) {
      // A deliberate cancel is not a failure, and must not silently copy
      // something the user just chose not to send.
      if (err instanceof Error && err.name === 'AbortError') {
        return 'shared';
      }
      // Anything else: fall through to the clipboard.
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(message);
      return 'copied';
    } catch {
      // Clipboard can be blocked outside a secure context or without a user
      // gesture. Report honestly rather than claim a copy that did not happen.
      return 'unavailable';
    }
  }

  return 'unavailable';
}
