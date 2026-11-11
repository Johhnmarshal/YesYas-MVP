import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VoiceProvider } from '@/components/VoiceProvider';
import { COLORS, SPACING, useThemeColors } from '@/lib/theme';

// Bar height above the home indicator: icon, label and breathing room.
// react-navigation sets an explicit height of its own, so the old minHeight
// was ignored and the labels clipped in every browser.
const BOTTOM_BAR_HEIGHT = 64;

/**
 * Where the tab bar goes on web. A bottom bar suits a phone held upright, but
 * stretched across a desktop it is a phone pattern on a big screen, and in
 * phone landscape it takes a fifth of a 390px-tall viewport. Those two cases
 * get a side rail instead; tablets in portrait keep the bottom bar.
 */
function shouldUseSideRail(width: number, height: number): boolean {
  if (Platform.OS !== 'web') return false;
  return width >= 1024 || (width > height && height < 500);
}

/**
 * Authenticated `(app)` navigation shell.
 * Displays the 4 tabs (Home, Library, Journal, Settings) as a bottom bar, or
 * a side rail on wide or short web viewports, and hides
 * onboarding, detail, pairing, reveal, and settings sub-routes via `href: null`.
 */
export default function AppLayout() {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rail = shouldUseSideRail(width, height);

  return (
    <VoiceProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary || COLORS.primary,
          tabBarInactiveTintColor: colors.textMuted || COLORS.textMuted,
          tabBarPosition: rail ? 'left' : 'bottom',
          tabBarVariant: rail ? 'material' : 'uikit',
          tabBarStyle: rail
            ? {
                backgroundColor: colors.surface || COLORS.surface,
                borderRightColor: colors.border || COLORS.border,
                borderRightWidth: 1,
                width: 104,
                paddingTop: Math.max(insets.top, SPACING.sm),
                paddingLeft: insets.left,
              }
            : {
                backgroundColor: colors.surface || COLORS.surface,
                borderTopColor: colors.border || COLORS.border,
                borderTopWidth: 1,
                height: BOTTOM_BAR_HEIGHT + insets.bottom,
                paddingTop: 4,
                paddingBottom: Math.max(insets.bottom, 4),
              },
          tabBarLabelStyle: {
            fontSize: 12,
            lineHeight: 16,
            fontWeight: '600',
          },
          tabBarItemStyle: rail
            ? { minHeight: 64, paddingVertical: SPACING.xs }
            : { minHeight: 44 },
          // Every screen was designed for a phone; on a desktop browser they
          // stretched edge to edge. Cap the content column on web only.
          ...(Platform.OS === 'web'
            ? {
                sceneStyle: {
                  width: '100%',
                  maxWidth: 760,
                  alignSelf: 'center',
                  backgroundColor: colors.bg,
                },
              }
            : {}),
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarAccessibilityLabel: 'Home tab',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'home' : 'home-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="library/index"
          options={{
            title: 'Library',
            tabBarAccessibilityLabel: 'Library tab',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'book' : 'book-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="journal/index"
          options={{
            title: 'Journal',
            tabBarAccessibilityLabel: 'Journal tab',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'journal' : 'journal-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings/index"
          options={{
            title: 'Settings',
            tabBarAccessibilityLabel: 'Settings tab',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'settings' : 'settings-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />

        {/* Hidden onboarding flow routes */}
        <Tabs.Screen
          name="onboarding/consent"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="onboarding/tone"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="onboarding/tier"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="onboarding/mode"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />

        {/* Hidden detail & modal routes */}
        <Tabs.Screen
          name="library/[id]"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="pairing/invite"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="pairing/accept"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="reveal/index"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="journal/[id]"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="settings/consent"
          options={{
            href: null,
          }}
        />
        {/*
          Every route under (app) becomes a tab unless it is declared with
          href: null. This one was missing, so the bottom bar carried a fifth
          tab labelled "privacy-model" next to Home, Library, Journal and
          Settings. scripts/verify-domain-logic.ts now diffs the route files
          against this list so adding a screen cannot reintroduce it.
        */}
        <Tabs.Screen
          name="settings/privacy-model"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="settings/passphrase"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="settings/export"
          options={{
            href: null,
            tabBarStyle: { display: 'none' },
          }}
        />
      </Tabs>
    </VoiceProvider>
  );
}
