import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

type LibraryItem = Database['public']['Tables']['desire_library_items']['Row'];

/**
 * Placeholder home screen so the scaffold is navigable. In v1 this becomes
 * the "Today" surface — pairing status, next reveal card, solo journal entry
 * point. For now it fetches a few desire library items to prove the
 * Supabase connection works end-to-end.
 */
export default function HomeScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!cancelled) setEmail(userRes.user?.email ?? null);

      const { data, error } = await supabase
        .from('desire_library_items')
        .select('*')
        .eq('active', true)
        .order('tier', { ascending: true })
        .limit(5);

      if (cancelled) return;
      if (error) setErr(error.message);
      else setItems(data ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Welcome back</Text>
        {email && <Text style={styles.muted}>Signed in as {email}</Text>}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection check</Text>
          {err ? (
            <Text style={styles.error}>Error: {err}</Text>
          ) : items.length === 0 ? (
            <Text style={styles.muted}>Loading library…</Text>
          ) : (
            items.map((it) => (
              <View key={it.id} style={styles.row}>
                <Text style={styles.tier}>{it.tier}</Text>
                <Text style={styles.rowTitle}>{it.title}</Text>
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FBF8F4' },
  container: { padding: 24 },
  h1: { fontSize: 28, fontWeight: '700', color: '#2C3E50', marginBottom: 4 },
  muted: { color: '#5B6A7A', marginBottom: 16 },
  error: { color: '#B23A48' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E1E5EA',
    marginBottom: 24,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#2C3E50', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  tier: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#2C3E50',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    textTransform: 'uppercase',
    marginRight: 10,
  },
  rowTitle: { color: '#2C3E50', flex: 1 },
  signOut: { alignSelf: 'flex-start' },
  signOutText: { color: '#5B6A7A', textDecorationLine: 'underline' },
});
