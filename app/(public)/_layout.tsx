import { Stack } from 'expo-router';

/**
 * Pages anyone can open, signed in or not: the Privacy Policy and Terms.
 * app/_layout.tsx leaves this group alone when routing by auth state.
 */
export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
