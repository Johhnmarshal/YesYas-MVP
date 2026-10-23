import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

/**
 * Minimal email magic-link sign-in for v1 foundation work.
 * Swap in passkeys via supabase.auth.signInWithIdToken + a passkey provider
 * once the device flow is wired up. Passkeys are roadmap week 9-10.
 */
export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    if (!email.trim()) return;
    setLoading(true);

    // Web: send users back to the current origin (e.g. http://localhost:8081)
    // so the magic link actually opens the app in a browser tab.
    // Native: use the yesyasapp:// deep link that the Expo build registers.
    const emailRedirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'yesyasapp://';

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });
    setLoading(false);

    if (error) {
      Alert.alert('Could not send link', error.message);
      return;
    }
    setSent(true);
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

        {sent ? (
          <View style={styles.sentCard}>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a sign-in link to {email.trim()}. Open it on this device
              to continue.
            </Text>
            <Pressable onPress={() => setSent(false)} style={styles.linkBtn}>
              <Text style={styles.linkText}>Use a different email</Text>
            </Pressable>
          </View>
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
            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              disabled={loading || !email.trim()}
              onPress={onSubmit}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send me a sign-in link</Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              {"No passwords. We'll email you a one-tap link. Your partner gets their own invite later."}
            </Text>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBF8F4' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 36, fontWeight: '700', color: '#2C3E50', marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    color: '#5B6A7A',
    marginBottom: 32,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E1E5EA',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 16,
    fontSize: 16,
    color: '#2C3E50',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2C3E50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: {
    marginTop: 20,
    fontSize: 13,
    color: '#7A8796',
    lineHeight: 18,
  },
  sentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E1E5EA',
  },
  sentTitle: { fontSize: 20, fontWeight: '600', color: '#2C3E50', marginBottom: 8 },
  sentBody: { fontSize: 15, color: '#5B6A7A', lineHeight: 21 },
  linkBtn: { marginTop: 16 },
  linkText: { color: '#2C3E50', fontWeight: '600' },
});
