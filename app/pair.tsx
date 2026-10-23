import { type Href, Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Deep link backward-compatibility redirect:
 * Routes incoming `yesyasapp://pair?code=XXXX` directly to `/(app)/pairing/accept?code=XXXX`.
 */
export default function PairDeepLinkRedirect() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;

  const targetHref = {
    pathname: '/(app)/pairing/accept',
    params: code ? { code } : {},
  } as unknown as Href;

  return <Redirect href={targetHref} />;
}

