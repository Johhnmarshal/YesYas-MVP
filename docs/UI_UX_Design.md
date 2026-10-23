# UI/UX Design Document — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active

---

## Design Principles

1. **Privacy is visible** — The UI should constantly signal that nothing is being shared without consent. Locks, "only you can see this" copy, and explicit confirmations before any reveal.
2. **Reduce anxiety, not clarity** — Soft visuals reduce pressure, but copy must be clear and specific. Never ambiguous about what a button does.
3. **Tone is configurable** — The app adapts its voice to the user's preference (Romantic / Playful / Direct), but the layout and structure are consistent.
4. **Mobile-first** — Every screen designed for a phone hand-held in portrait. Web is a secondary surface for therapist export only.
5. **Pause is always one tap away** — A user should never feel trapped. The pause/exit option is always reachable.

---

## Design System

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#FBF8F4` | App background (warm off-white) |
| `--color-surface` | `#FFFFFF` | Cards, modals, input fields |
| `--color-primary` | `#2C3E50` | Primary text, primary buttons, tier badges |
| `--color-secondary` | `#5B6A7A` | Secondary text, muted labels |
| `--color-muted` | `#9AA3AE` | Placeholders, disabled states |
| `--color-border` | `#E1E5EA` | Card borders, input borders |
| `--color-accent-warm` | `#C9856B` | Reveal moments, match highlights, CTAs |
| `--color-accent-cool` | `#4A90B8` | Info states, pairing status indicators |
| `--color-error` | `#B23A48` | Error messages, destructive actions |
| `--color-success` | `#3A7D44` | Confirm states, "sent" confirmations |

**Dark mode:** Background inverts to `#1A1F26`, surface to `#252B34`. All tokens have dark variants; the app respects `userInterfaceStyle: "automatic"` from `app.json`.

### Typography

| Role | Font | Size | Weight |
|------|------|------|--------|
| Display / App title | System default (SF Pro / Roboto) | 36sp | 700 |
| Screen title (H1) | System default | 28sp | 700 |
| Section heading (H2) | System default | 20sp | 600 |
| Card title (H3) | System default | 16sp | 600 |
| Body | System default | 15–16sp | 400 |
| Caption / hint | System default | 13sp | 400 |
| Button label | System default | 16sp | 600 |

Line height: 1.45× font size throughout. Minimum tap target: 44×44pt (WCAG AA).

### Spacing

Base unit: **8pt**. All spacing values are multiples of 8: 8, 16, 24, 32, 48.

Padding inside cards: 16pt. Screen edge padding: 24pt. Vertical gap between sections: 24–32pt.

### Component Patterns

**Primary button** — Full-width, 56pt height, 12pt border-radius, `--color-primary` fill, white label.  
**Secondary button / link button** — No fill, `--color-primary` text, underline optional.  
**Card** — White surface, 12pt radius, 1pt `--color-border` border, 16pt padding.  
**Input field** — White surface, 12pt radius, 1pt `--color-border`, 16pt padding, 16pt font.  
**Tier badge** — Pill shape, `--color-primary` fill, white uppercase label, 10pt font, 700 weight.  
**Rating stars** — 5 stars, 32pt tap target each, accent warm fill when selected.

---

## Screens & Wireframes

### 1. Sign-In Screen

```
┌─────────────────────────┐
│                         │
│                         │
│      YesYas!            │  ← 36pt, bold, #2C3E50
│  A quieter way to say   │  ← 16pt, #5B6A7A, 2 lines
│  what you want —        │
│  together.              │
│                         │
│  ┌───────────────────┐  │
│  │  you@domain.com   │  │  ← Email input
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Send me a sign-in │  │  ← Primary CTA button
│  │       link        │  │
│  └───────────────────┘  │
│                         │
│  No passwords. We'll    │  ← 13pt hint text
│  email you a one-tap    │
│  link.                  │
│                         │
└─────────────────────────┘

Post-send state:
┌─────────────────────────┐
│  Check your email       │  ← Card
│                         │
│  We sent a sign-in link │
│  to user@example.com.   │
│  Open it on this device │
│  to continue.           │
│                         │
│  Use a different email  │  ← Link button
└─────────────────────────┘
```

### 2. Onboarding / Preferences (first-launch, post-auth)

Three short screens in a swipe flow:

**Screen A — Tone Preference**
```
┌─────────────────────────┐
│  How do you like to     │
│  talk about this?       │
│                         │
│  ◉ Romantic             │  ← Radio-style selector
│    Soft, imagery-based  │
│                         │
│  ○ Playful              │
│    Light and exploratory│
│                         │
│  ○ Direct               │
│    Clear and specific   │
│                         │
│  [  Continue  ]         │
└─────────────────────────┘
```

**Screen B — Content Tier**
```
┌─────────────────────────┐
│  What kind of content   │
│  feels right for now?   │
│                         │
│  ○ Sensory              │
│    Touch, warmth,       │
│    physical closeness   │
│                         │
│  ◉ Suggestive           │
│    Intimate but not     │
│    explicit (default)   │
│                         │
│  ○ Explicit             │
│    Fully frank content  │
│                         │
│  You can change this    │  ← 13pt muted
│  any time in settings.  │
│                         │
│  [  Continue  ]         │
└─────────────────────────┘
```

**Screen C — Mode Selection**
```
┌─────────────────────────┐
│  How would you like     │
│  to start?              │
│                         │
│  ┌─────────────────┐    │
│  │  Explore solo   │    │  ← Card tap target
│  │  Journal your   │    │
│  │  desires first  │    │
│  └─────────────────┘    │
│                         │
│  ┌─────────────────┐    │
│  │  Invite my      │    │  ← Card tap target
│  │  partner now    │    │
│  └─────────────────┘    │
└─────────────────────────┘
```

### 3. Home Screen (signed-in)

```
┌─────────────────────────┐
│  Welcome back, [name]   │  ← H1
│                         │
│  ┌─────────────────────┐│
│  │ 💑 Paired with Amara ││  ← Pairing card
│  │ Status: Active       ││
│  │ Last reveal: 3 days  ││
│  │ [Start new reveal →] ││
│  └─────────────────────┘│
│                         │
│  ┌─────────────────────┐│
│  │ ✍️ Journal           ││  ← Solo mode card
│  │ Your private space   ││
│  │ [Write today →]      ││
│  └─────────────────────┘│
│                         │
│  ┌─────────────────────┐│
│  │ 📚 Desire Library    ││  ← Library shortcut
│  │ 12 unrated items     ││
│  │ [Rate now →]         ││
│  └─────────────────────┘│
└─────────────────────────┘

Bottom tab bar:
[ Home ] [ Library ] [ Journal ] [ Settings ]
```

### 4. Desire Library Screen

```
┌─────────────────────────┐
│  Desire Library         │  ← H1
│  ○──●──○ Tier filter    │  ← Sensory / Suggestive / Explicit
│                         │
│  ┌─────────────────────┐│
│  │ [SENSORY]            ││  ← Tier badge
│  │ A long back massage  ││  ← Title
│  │ with no agenda       ││
│  │ ★ ★ ★ ☆ ☆           ││  ← Rating row (tap to rate)
│  └─────────────────────┘│
│                         │
│  ┌─────────────────────┐│
│  │ [SUGGESTIVE]         ││
│  │ Falling asleep       ││
│  │ skin to skin         ││
│  │ ★ ☆ ☆ ☆ ☆           ││
│  └─────────────────────┘│
│  ...                    │
└─────────────────────────┘
```

Tapping a card expands it inline to show description + note field + star selector.  
A "🔒 Only you see your ratings" label appears below the stars on every item.

### 5. Reveal Flow

**Step 1 — Trigger**
```
┌─────────────────────────┐
│  Ready for a reveal?    │  ← H1
│                         │
│  You've rated 24 items. │
│  When your partner is   │
│  ready too, you'll see  │
│  what you share.        │
│                         │
│  Your ratings stay      │  ← Privacy reassurance card
│  private, always.       │
│  Only overlaps surface. │
│                         │
│  [ I'm ready ]          │  ← Primary CTA
│  [ Not yet ]            │  ← Secondary
└─────────────────────────┘
```

**Step 2 — Waiting**
```
┌─────────────────────────┐
│  Waiting for Amara…     │
│                         │
│  She has 72 hours to    │
│  tap ready.             │
│                         │
│  ⏳ 71h 42m remaining   │
│                         │
│  [Withdraw my reveal]   │  ← Destructive / link button
└─────────────────────────┘
```

**Step 3 — Reveal Moment**
```
┌─────────────────────────┐
│  ✨ You have 5 matches  │  ← Large, celebratory
│                         │
│  Things you both want:  │
│                         │
│  ● A long back massage  │
│    with no agenda       │
│                         │
│  ● Falling asleep       │
│    skin to skin         │
│                         │
│  ● [item 3]             │
│  ● [item 4]             │
│  ● [item 5]             │
│                         │
│  ┌─────────────────────┐│
│  │ 🌉 One mismatch     ││  ← Mismatch bridge card
│  │ bridge available    ││
│  │ [Explore together→] ││
│  └─────────────────────┘│
│                         │
│  This reveal disappears │  ← 13pt muted, countdown
│  in 23h 58m             │
└─────────────────────────┘
```

### 6. Solo Journal Screen

```
┌─────────────────────────┐
│  Your Journal           │  ← H1
│  🔒 Private to you      │  ← Always visible privacy label
│                         │
│  ┌─────────────────────┐│
│  │ AI Coach            ││
│  │                     ││
│  │ What feels          ││
│  │ interesting to you  ││
│  │ today?              ││
│  │                     ││
│  │ [Type a response…]  ││
│  │                     ││
│  │ [Send]              ││
│  └─────────────────────┘│
│                         │
│  Past entries ↓         │
│  May 28 · 3 min read    │
└─────────────────────────┘
```

---

## User Flow

### Onboarding Flow

```
App open
  └─ Not signed in?
       └─ Sign-In Screen
            └─ Enter email → magic link sent
                 └─ Open link on device → auth session established
                      └─ First time?
                           ├─ Onboarding: Tone Preference
                           ├─ Onboarding: Content Tier
                           └─ Onboarding: Mode Selection
                                ├─ Solo → Journal Home
                                └─ Invite partner → Pairing Invite Screen
```

### Core Paired Loop

```
Home
  ├─ Rate items → Library Screen
  │     └─ Expand card → Rate 1-5 → Optional note → Collapse
  │
  ├─ Start reveal → Reveal Trigger Screen
  │     └─ Tap "I'm ready" → Waiting Screen
  │           └─ Partner taps ready → Both see Reveal Moment
  │                 ├─ Matches listed
  │                 └─ Mismatch bridge (if applicable)
  │
  └─ Journal → Journal Screen
        └─ Chat with AI coach
              └─ Tap "Invite partner" → Pairing Invite Screen
```

### Pairing Invite Flow

```
Invite Partner Screen
  └─ Share invite code / deep link to partner
       └─ Partner opens link → signs in (or creates account)
            └─ Accepts pairing → both see paired Home
```

### Therapist Export Flow

```
Settings → Therapist Export
  └─ "Generate summary" tapped
       └─ Confirmation modal: "This requires your partner's consent"
            └─ Partner receives in-app nudge → taps "I consent"
                 └─ PDF generated → signed URL shown to both users
                      └─ "Share with therapist" → system share sheet
```

---

## Accessibility

- Minimum 4.5:1 contrast ratio on all body text (WCAG AA)
- All interactive elements have accessible labels for VoiceOver / TalkBack
- Minimum 44×44pt touch targets throughout
- No color-only information indicators (always paired with text or icon)
- Dynamic type support: all font sizes respond to system text-size settings
- `FLAG_SECURE` on Android reveal screens; blur-on-backgrounding on iOS
