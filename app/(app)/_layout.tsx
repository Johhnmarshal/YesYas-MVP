import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { COLORS, TYPOGRAPHY, useThemeColors } from '@/lib/theme';

/**
 * Authenticated `(app)` navigation shell.
 * Displays a 4-tab bottom bar (Home, Library, Journal, Settings) and hides
 * onboarding, detail, pairing, reveal, and settings sub-routes via `href: null`.
 */
export default function AppLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary || COLORS.primary,
        tabBarInactiveTintColor: colors.muted || COLORS.muted,
        tabBarStyle: {
          backgroundColor: colors.surface || COLORS.surface,
          borderTopColor: colors.border || COLORS.border,
          borderTopWidth: 1,
          minHeight: 60,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: {
          fontSize: TYPOGRAPHY.caption.fontSize,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          minHeight: 44,
        },
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
        name="settings/export"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
