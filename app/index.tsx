import { Redirect } from 'expo-router';

// Root redirect — the real auth gating happens in _layout.tsx. When signed
// in, this sends the user to the home tab; when signed out, _layout
// intercepts and routes to the sign-in screen first.
export default function Index() {
  return <Redirect href="/(app)/home" />;
}
