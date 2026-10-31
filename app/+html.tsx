import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import { COLORS } from '@/lib/theme';

/**
 * Static HTML shell for the web build.
 *
 * This exists because the exported pages had no title. `dist/index.html`
 * shipped `<title data-rh="true"></title>` — empty — so every browser tab,
 * bookmark and history entry on the beta channel showed a bare URL. The web
 * build is the beta channel, so that is the one place the name actually
 * needed to appear.
 *
 * The description is deliberately the app's own tagline rather than anything
 * about desires or intimacy: it is what appears in a link preview if a tester
 * pastes the URL into a chat, and it should not announce what the app is for
 * on someone else's screen.
 *
 * Note for launch: there is no robots directive here. A private beta arguably
 * wants `<meta name="robots" content="noindex" />` so the sign-in page does
 * not get indexed before launch, but whether this is discoverable is a
 * marketing decision rather than a correctness one, so it is left to you.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        {/*
          No <title> here. expo-router renders a helmet-managed
          <title data-rh="true"> into every page, and it comes first in the
          document, so a second static title is simply ignored — verified in a
          browser: document.title read "" with two title elements present. The
          title is set through <Head> in app/_layout.tsx instead, which fills
          the one the head manager owns.
        */}
        <meta
          name="description"
          content="A quieter way to say what you want — together."
        />
        {/* Matches COLORS.primary in lib/theme.ts. */}
        <meta name="theme-color" content={COLORS.primary} />

        {/*
          Disables body scrolling on web so ScrollView components behave as
          they do on native. Remove if a global scroll is ever wanted.
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
