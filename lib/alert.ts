import { Alert, Platform } from 'react-native';

/**
 * Cross-platform dialogs.
 *
 * react-native-web does not implement Alert. Not partially — at all. The whole
 * export, as of 0.21.2, is:
 *
 *     class Alert { static alert() {} }
 *
 * So on the web build every `Alert.alert(...)` call was a silent no-op: no
 * title, no message, no buttons, and for the two-button form, a confirmation
 * callback that could never fire. The web build is the beta channel, so that
 * covered every tester.
 *
 * It broke two different things. Error and success messages simply never
 * appeared — a tester whose tier update or export or consent action failed saw
 * nothing whatsoever and had no way to know. And confirmations could never be
 * completed: tapping "Sign Out" or "Delete entry" did nothing at all, which
 * reads as a dead button rather than a cancelled action.
 *
 * `window.confirm` and `window.alert` are synchronous and modal, which is
 * exactly the semantics these call sites were written against.
 */
export function showMessage(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the affirmative button on native. */
  confirmText?: string;
  /** Label for the dismissive button on native. */
  cancelText?: string;
  /** Renders the affirmative button in the platform's destructive style. */
  destructive?: boolean;
}

/**
 * Resolves true only if the user affirmatively confirmed.
 *
 * Every failure mode resolves false — a dismissed dialog, an environment with
 * no `window.confirm`. For the destructive actions these guard (deleting a
 * journal entry, deleting an account) false is the safe answer, so a dialog
 * that cannot be shown declines rather than proceeds.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmText = 'OK',
    cancelText = 'Cancel',
    destructive = false,
  } = options;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return Promise.resolve(false);
    }
    return Promise.resolve(
      window.confirm(message ? `${title}\n\n${message}` : title),
    );
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmText,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
