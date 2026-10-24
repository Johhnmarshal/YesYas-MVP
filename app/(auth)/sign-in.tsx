import { useState } from 'react';
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

/**
 * Email sign-in screen supporting:
 * 1. Magic Link + 8-digit OTP code verification (`signInWithOtp` + `verifyOtp`)
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

  async function onSubmitMagicLink() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;
    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const emailRedirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'yesyasapp://';

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
        setMode('password');
        setInfoMessage(
          'Hourly email limit reached on the beta server. Choose a passphrase (6+ characters) below to sign in immediately without waiting for an email.',
        );
        return;
      }
      setErrorMessage(error.message);
      return;
    }
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

  async function onSubmitPassword() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || password.length < 6) {
      setErrorMessage('Please enter your email and a passphrase of at least 6 characters.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    // 1. Try signing in existing user
    const signInRes = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (!signInRes.error && signInRes.data.session) {
      setLoading(false);
      return;
    }

    // 2. If account doesn't exist yet (or had no password), attempt signUp
    const signUpRes = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    setLoading(false);

    if (signUpRes.error) {
      // If user already exists with a different password or magic-link-only account
      if (
        signUpRes.error.message.toLowerCase().includes('already registered')
      ) {
        setErrorMessage(
          'This email is already registered with a different passphrase. Please enter your original passphrase or use Magic Link.',
        );
        return;
      }
      setErrorMessage(signUpRes.error.message);
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
                (loading || !email.trim()) && styles.buttonDisabled,
              ]}
              disabled={loading || !email.trim()}
              onPress={() => void onSubmitMagicLink()}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
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
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder="Passphrase (6+ characters)"
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
                (loading || !email.trim() || password.length < 6) &&
                  styles.buttonDisabled,
              ]}
              disabled={loading || !email.trim() || password.length < 6}
              onPress={() => void onSubmitPassword()}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  Sign in / Create beta account
                </Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              Instant sign-in creates your account or signs you in right away —
              no waiting on magic-link email delivery.
            </Text>
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
