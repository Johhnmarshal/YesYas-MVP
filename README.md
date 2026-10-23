<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7ce8cce1-5789-4a2a-94c7-7e949d174a78

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Firestore security rules

The rules in `firestore.rules` are the privacy model for Yes Yas!, not just
access plumbing. They are covered by a test suite that is written attacks-first:

```
npm run test:rules
```

This boots the Firestore emulator (needs Java) and runs 40 assertions, including
regression tests for a pairing hole that previously let any signed-in user force
a pairing with any other user and then read that user's journal.

To check a test actually bites, point it at an older rules file:

```
RULES_FILE=/path/to/old-firestore.rules npm run test:rules
```

### Pairing model

Pairing is a two-sided handshake. **No user can ever write another user's
profile.** Each side adds the other to its own `partnerUids`:

1. The inviter resolves the partner's code via `/pairing_codes/{CODE}` — a
   direct document `get`, and `list` is denied, so codes and the user base
   cannot be enumerated. Knowing a code is the proof of consent.
2. The inviter files `/pair_requests/{fromUid}_{toUid}`.
3. The invitee accepts, which writes only the invitee's own profile.
4. The inviter's client sees the acceptance and writes only its own profile.

Pair-scoped data (`/pairs/{pairId}/...`) stays locked until both profiles list
each other, so a half-finished handshake exposes nothing.

### Deploying this change

Rules and client must ship together, **rules first**:

```
firebase deploy --only firestore:rules   # then deploy the app
```

Deploying the rules first leaves anyone on a stale cached client temporarily
unable to pair, which is the safe failure. Deploying the client first is worse:
it would try to claim `/pairing_codes` documents the old rules reject, and
profile provisioning would error.

Existing accounts migrate themselves on next sign-in: `FirebaseProvider`
back-fills `/pairing_codes/{existingCode}` and rewrites `/public_profiles`
without the `connectionCode` field. No manual data migration is needed.
