import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

type AuthMode = 'magic_link' | 'password';

// Must match minimum_password_length in supabase/config.toml. Lower than the
// server floor just means the server rejects what the UI accepted.
const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Email sign-in screen supporting:
 * 1. Magic Link + emailed OTP code verification (`signInWithOtp` + `verifyOtp`).
 *
 *    The code input is length-agnostic on purpose (maxLength 10, only requires
 *    non-empty), so whatever length the project is configured for will work.
 *
 *    IMPORTANT: this path only works if the Magic Link email actually carries
 *    a code. Supabase's DEFAULT template does not — it contains only
 *    {{ .ConfirmationURL }}, so the "enter the code from your email" box asks
 *    for something that was never sent. Dashboard -> Authentication -> Email
 *    Templates -> Magic Link needs {{ .Token }} added, e.g.
 *
 *      <p>Your sign-in code: <strong>{{ .Token }}</strong></p>
 *      <p>Or follow this link: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
 *
 *    Worth adding {{ .TokenHash }} in the same edit — see the note at
 *    `flowType` in lib/supabase.ts for why that is what lets web go back to
 *    PKCE without breaking cross-browser links.
 * 2. Instant Email + Passphrase sign-in (`signInWithPassword` / `signUp`), which
 *    bypasses Supabase's built-in 2-emails/hour SMTP rate limit for beta testers.
 * Renders inline error banners so web users never hit silent `Alert.alert` no-ops.
 */
export default function SignInScreen() {
  const [mode, setMode] = useState<AuthMode>('magic_link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  // Shown only after a sign-in attempt fails. Account creation is never a
  // side effect of signing in — see onSubmitPassword.
  // Seconds until another email may be requested. Supabase's built-in mailer
  // allows very few sends per hour, and every tap of the send button spends
  // one whether or not the user needed it.
  const [cooldown, setCooldown] = useState(0);

  async function onSubmitMagicLink() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || cooldown > 0) return;
    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    // Native sends 'yesyasapp:///' with the trailing slash, not 'yesyasapp://'.
    // Measured against the hosted project's allowlist with an invalid-token
    // probe against /auth/v1/verify (no email sent, nothing created):
    //
    //   yesyasapp://              blocked, and mangled to "yesyasapp:"
    //   yesyasapp:///             allowed
    //   yesyasapp://sign-in       allowed
    //
    // The live list carries "yesyasapp://**", which needs something after the
    // slashes, so the bare scheme never matched and the link would not have
    // come back to the app at all.
    //
    // Note this is necessary but not sufficient for mobile: nothing in the app
    // reads a token out of a deep link yet. detectSessionInUrl is web-only,
    // consumeInitialUrlAuth returns early when there is no window.location, and
    // no file imports Linking. See docs/BETA_READINESS.md section 6.
    const emailRedirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'yesyasapp:///';

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });
    setLoading(false);

    if (error) {
      const lower = error.message.toLowerCase();
      if (
        lower.includes('rate limit') ||
        lower.includes('too many') ||
        lower.includes('not authorized') ||
        error.status === 429
      ) {
        // The quota is hourly, so a short retry will fail too. Hold the
        // button down for a while rather than letting the user spend attempts
        // discovering that.
        setCooldown(15 * 60);
        setMode('password');
        setInfoMessage(
          `Hourly email limit reached on the beta server — it allows 2 sign-in emails an hour. Enter a passphrase (${MIN_PASSPHRASE_LENGTH}+ characters) below to sign in, or create an account, without waiting for an email.`,
        );
        return;
      }
      setErrorMessage(error.message);
      return;
    }
    // A link and code were just sent and both stay valid for a while. Stop
    // further sends for a minute: an impatient second tap spends another of a
    // very small hourly allowance and delivers nothing new.
    setCooldown(60);
    setSent(true);
  }

  async function onVerifyOtpCode() {
    const trimmedEmail = email.trim().toLowerCase();
    const cleanedToken = otpCode.replace(/\s+/g, '');
    if (!trimmedEmail || !cleanedToken) return;

    setVerifyingOtp(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: cleanedToken,
      type: 'email',
    });

    setVerifyingOtp(false);

    if (error) {
      setErrorMessage(error.message);
    }
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSubmitPassword() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || password.length < MIN_PASSPHRASE_LENGTH) {
      setErrorMessage(
        `Please enter your email and a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters, mixing upper and lower case letters and digits.`,
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    // Sign in only. Creating an account is a separate, explicit action.
    //
    // This used to fall through to signUp when sign-in failed, which made
    // account creation a side effect of typing an email. The hosted project
    // runs enable_confirmations = false while the built-in SMTP cap is in
    // force, so that signUp produced a CONFIRMED account with a live session
    // and no proof the caller owned the address — open registration from the
    // public sign-in screen. Two probe requests on 2026-10-25 demonstrated it
    // by accident: both came back 400 email_address_invalid and still left
    // confirmed users with profiles behind.
    //
    // Splitting the two also removes most of the enumeration signal. A failed
    // sign-in now looks the same whether or not the address exists: same
    // message, same absence of email, same offer to create.
    const signInRes = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setLoading(false);

    if (!signInRes.error && signInRes.data.session) {
      return;
    }
    setErrorMessage(
      'That email and passphrase did not match an existing account. Check the passphrase, use Magic Link, or create a new account below.',
    );
  }

  async function onCreateAccount() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || password.length < MIN_PASSPHRASE_LENGTH) {
      setErrorMessage(
        `Please enter your email and a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters, mixing upper and lower case letters and digits.`,
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const signUpRes = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    setLoading(false);

    if (signUpRes.error) {
      // Still deliberately neutral: an "already registered" error here would
      // confirm the address exists to anyone who reached this button.
      setErrorMessage(
        'We could not create an account with those details. If you already have one, try signing in or use Magic Link.',
      );
      return;
    }
    if (!signUpRes.data.session) {
      setSent(true);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Text style={styles.title}>YesYas!</Text>
        <Text style={styles.subtitle}>
          A quieter way to say what you want — together.
        </Text>

        {!sent && (
          <View style={styles.modeTabs}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Sign in by email link or code"
              accessibilityState={{ selected: mode === 'magic_link' }}
              onPress={() => {
                setMode('magic_link');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              style={[
                styles.modeTab,
                mode === 'magic_link' && styles.modeTabActive,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  mode === 'magic_link' && styles.modeTabTextActive,
                ]}
              >
                Email Link / Code
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Sign in instantly with a passphrase"
              accessibilityState={{ selected: mode === 'password' }}
              onPress={() => {
                setMode('password');
                setErrorMessage(null);
              }}
              style={[
                styles.modeTab,
                mode === 'password' && styles.modeTabActive,
              ]}
            >
              <Text
                style={[
                  styles.modeTabText,
                  mode === 'password' && styles.modeTabTextActive,
                ]}
              >
                Instant Passphrase
              </Text>
            </Pressable>
          </View>
        )}

        {infoMessage ? (
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerText}>{infoMessage}</Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {sent ? (
          <View style={styles.sentCard}>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a sign-in link and an 8-digit code to {email.trim()}. Tap
              the link in your email or enter the 8-digit code below:
            </Text>

            <TextInput
              style={[styles.input, styles.otpInput]}
              placeholder="8-digit code from email"
              placeholderTextColor="#9AA3AE"
              keyboardType="number-pad"
              autoCapitalize="none"
              accessibilityLabel="Sign-in code from your email"
              accessibilityHint="Enter the code we emailed you"
              value={otpCode}
              onChangeText={setOtpCode}
              editable={!verifyingOtp}
              maxLength={10}
            />

            <Pressable
              style={[
                styles.button,
                (verifyingOtp || !otpCode.trim()) && styles.buttonDisabled,
              ]}
              disabled={verifyingOtp || !otpCode.trim()}
              onPress={() => void onVerifyOtpCode()}
              accessibilityRole="button"
              accessibilityLabel="Verify sign-in code"
              accessibilityState={{ disabled: verifyingOtp || !otpCode.trim() }}
            >
              {verifyingOtp ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify sign-in code</Text>
              )}
            </Pressable>

            <View style={styles.sentActionsRow}>
              <Pressable
                onPress={() => {
                  setSent(false);
                  setOtpCode('');
                  setErrorMessage(null);
                }}
                style={styles.linkBtn}
                accessibilityRole="button"
                accessibilityLabel="Use a different email address"
              >
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSent(false);
                  setMode('password');
                  setErrorMessage(null);
                }}
                style={styles.linkBtn}
                accessibilityRole="button"
                accessibilityLabel="Switch to instant passphrase sign-in"
              >
                <Text style={styles.linkText}>
                  Didn&apos;t get it? Use Instant Passphrase
                </Text>
              </Pressable>
            </View>
          </View>
        ) : mode === 'magic_link' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@domain.com"
              placeholderTextColor="#9AA3AE"
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <Pressable
              style={[
                styles.button,
                (loading || !email.trim() || cooldown > 0) &&
                  styles.buttonDisabled,
              ]}
              disabled={loading || !email.trim() || cooldown > 0}
              onPress={() => void onSubmitMagicLink()}
              accessibilityRole="button"
              accessibilityLabel={
                cooldown > 0
                  ? `Resend available in ${cooldown} seconds`
                  : 'Send me a sign-in link'
              }
              accessibilityState={{ disabled: loading || cooldown > 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : cooldown > 0 ? (
                <Text style={styles.buttonText}>
                  {cooldown >= 60
                    ? `Try again in ${Math.ceil(cooldown / 60)} min`
                    : `Resend in ${cooldown}s`}
                </Text>
              ) : (
                <Text style={styles.buttonText}>Send me a sign-in link</Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              We&apos;ll email you a one-tap link and an 8-digit code. Or switch
              to Instant Passphrase above to sign in immediately without email.
            </Text>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@domain.com"
              placeholderTextColor="#9AA3AE"
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder={`Passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)`}
              accessibilityLabel="Passphrase"
              accessibilityHint={`At least ${MIN_PASSPHRASE_LENGTH} characters, mixing upper and lower case letters and digits`}
              placeholderTextColor="#9AA3AE"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
            <Pressable
              style={[
                styles.button,
                (loading || !email.trim() || password.length < MIN_PASSPHRASE_LENGTH) &&
                  styles.buttonDisabled,
              ]}
              disabled={loading || !email.trim() || password.length < MIN_PASSPHRASE_LENGTH}
              onPress={() => void onSubmitPassword()}
              accessibilityRole="button"
              accessibilityLabel="Sign in with passphrase"
              accessibilityState={{
                disabled:
                  loading ||
                  !email.trim() ||
                  password.length < MIN_PASSPHRASE_LENGTH,
              }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              Signs you in straight away — no waiting on email. New here? Enter
              your email and a passphrase, then use Create account.
            </Text>
            <Pressable
              style={[
                styles.createAccountButton,
                (loading ||
                  !email.trim() ||
                  password.length < MIN_PASSPHRASE_LENGTH) &&
                  styles.buttonDisabled,
              ]}
              disabled={
                loading ||
                !email.trim() ||
                password.length < MIN_PASSPHRASE_LENGTH
              }
              onPress={() => void onCreateAccount()}
              accessibilityRole="button"
              accessibilityLabel="Create a new account with this email and passphrase"
            >
              <Text style={styles.createAccountButtonText}>
                Create account
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBF8F4' },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  title: { fontSize: 36, fontWeight: '700', color: '#2C3E50', marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    color: '#5B6A7A',
    marginBottom: 24,
    lineHeight: 22,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#EFECE6',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: '#FFFFFF',
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6C7A89',
  },
  modeTabTextActive: {
    color: '#2C3E50',
  },
  infoBanner: {
    backgroundColor: '#FDF3E7',
    borderColor: '#E5B87B',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  infoBannerText: {
    color: '#7A4F13',
    fontSize: 14,
    lineHeight: 20,
  },
  createAccountButton: {
    borderWidth: 1,
    borderColor: '#C86D51',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginBottom: 16,
  },
  createAccountButtonText: { color: '#C86D51', fontSize: 16, fontWeight: '600' },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderColor: '#E58B8B',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  errorBannerText: {
    color: '#8B1E1E',
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#fff',
    borderColor: '#D8DEE6',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#2C3E50',
    marginBottom: 12,
  },
  otpInput: {
    marginTop: 14,
    letterSpacing: 3,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#C86D51',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: {
    marginTop: 16,
    fontSize: 13,
    color: '#7A8794',
    textAlign: 'center',
    lineHeight: 18,
  },
  sentCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    borderColor: '#E2E7EE',
    borderWidth: 1,
  },
  sentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 8,
  },
  sentBody: { fontSize: 15, color: '#5B6A7A', lineHeight: 21 },
  sentActionsRow: {
    marginTop: 16,
    gap: 8,
  },
  linkBtn: { paddingVertical: 6 },
  linkText: { color: '#C86D51', fontSize: 14, fontWeight: '600' },
});
