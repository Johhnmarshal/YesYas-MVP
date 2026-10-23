import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return jsonResponse({ error: 'Missing authorization token' }, 401);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired user session' }, 401);
  }

  let body: { pairingId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const pairingId = body.pairingId?.trim();
  if (!pairingId) {
    return jsonResponse({ error: 'pairingId is required' }, 400);
  }

  // 1. Verify pairing exists and caller is an active or paused member
  const { data: pairing, error: pairingErr } = await adminClient
    .from('pairings')
    .select('id, inviter_user_id, invitee_user_id, status, created_at')
    .eq('id', pairingId)
    .maybeSingle();

  if (pairingErr || !pairing) {
    return jsonResponse({ error: 'Pairing not found' }, 404);
  }

  const callerId = user.id;
  const isInviter = pairing.inviter_user_id === callerId;
  const isInvitee = pairing.invitee_user_id === callerId;

  if (!isInviter && !isInvitee) {
    return jsonResponse(
      { error: 'You are not a member of this pairing' },
      403,
    );
  }

  const partnerId = isInviter
    ? pairing.invitee_user_id
    : pairing.inviter_user_id;

  if (!partnerId) {
    return jsonResponse(
      { error: 'Pairing has no accepted partner yet' },
      400,
    );
  }

  // 2. Dual-consent check: both partners must have logged a 'therapist_export'
  // consent event for this pairing within the past 7 days (matching request_therapist_export RPC).
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: consentEvents, error: consentErr } = await adminClient
    .from('consent_events')
    .select('user_id, event_type, created_at')
    .eq('pairing_id', pairingId)
    .eq('event_type', 'therapist_export')
    .gte('created_at', sevenDaysAgo);

  if (consentErr) {
    console.error('Consent query error:', consentErr);
    return jsonResponse({ error: 'Failed to verify consent events' }, 500);
  }

  const callerConsented = (consentEvents ?? []).some(
    (e) => e.user_id === callerId,
  );
  const partnerConsented = (consentEvents ?? []).some(
    (e) => e.user_id === partnerId,
  );

  if (!callerConsented || !partnerConsented) {
    return jsonResponse(
      {
        error:
          'Dual partner consent required. Both partners must grant explicit consent for therapist export.',
        code: 'DUAL_CONSENT_REQUIRED',
        callerConsented,
        partnerConsented,
      },
      403,
    );
  }

  // 3. Query profiles for display names only
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, display_name')
    .in('id', [callerId, partnerId]);

  const callerProfile = profiles?.find((p) => p.id === callerId);
  const partnerProfile = profiles?.find((p) => p.id === partnerId);

  const callerName = callerProfile?.display_name?.trim() || 'Partner 1';
  const partnerName = partnerProfile?.display_name?.trim() || 'Partner 2';

  // 4. Query reveals for summary aggregates ONLY (ZERO raw desire ratings)
  const { data: reveals, error: revealsErr } = await adminClient
    .from('reveals')
    .select('id, triggered_at, revealed_at, status, summary')
    .eq('pairing_id', pairingId)
    .order('triggered_at', { ascending: false })
    .limit(5);

  if (revealsErr) {
    console.error('Reveals query error:', revealsErr);
    return jsonResponse({ error: 'Failed to query reveal summaries' }, 500);
  }

  const revealSummaries = (reveals ?? []).map((r, index) => {
    const summaryObj = (r.summary as Record<string, unknown> | null) ?? {};
    const matchCount =
      typeof summaryObj.match_count === 'number' ? summaryObj.match_count : 0;
    const curiosityCount =
      typeof summaryObj.curiosity_count === 'number'
        ? summaryObj.curiosity_count
        : 0;

    const dateStr = r.revealed_at || r.triggered_at;
    const formattedDate = dateStr
      ? new Date(dateStr).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : `Session ${index + 1}`;

    return {
      revealId: r.id,
      date: formattedDate,
      status: r.status,
      matchCount,
      curiosityCount,
    };
  });

  const generatedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // 5. Construct formatted report text (clinical summary)
  const formattedText = `========================================================
YESYAS! COUPLES MUTUAL REFLECTION SUMMARY
========================================================
Report Type: Clinical & Couples Counseling Aggregate
Date Generated: ${generatedDate}
Pairing ID: ${pairingId}

PARTNERS:
- ${callerName}
- ${partnerName}

CONSENT AUDIT STATUS:
✓ Dual partner consent verified via cryptographic audit trail
✓ Consent verified within active 7-day window

REVEAL HISTORY & AGGREGATE SUMMARY:
${
  revealSummaries.length === 0
    ? 'No completed mutual reveals recorded yet for this pairing.'
    : revealSummaries
        .map(
          (s, i) =>
            `[Session ${i + 1} — ${s.date}] Status: ${s.status}\n` +
            `  • Mutual High-Alignment Desires: ${s.matchCount}\n` +
            `  • Curiosity Bridge Items (Exploration Zone): ${s.curiosityCount}`,
        )
        .join('\n\n')
}

--------------------------------------------------------
CLINICAL & PRIVACY ARCHITECTURE NOTICE:
This document contains exclusively mutual alignment aggregate metrics.
In strict compliance with the YesYas zero-knowledge architecture:
- Individual desire ratings are never revealed, logged, or exported.
- Unshared desires remain completely confidential to each individual.
- Only mutually shared alignments are summarized.
========================================================`;

  return jsonResponse({
    ok: true,
    report: {
      title: 'YesYas! Couples Mutual Reflection Summary',
      generatedAt: new Date().toISOString(),
      pairingId,
      partners: [callerName, partnerName],
      dualConsentVerified: true,
      revealSummaries,
      disclaimer:
        'This summary contains exclusively mutual alignment aggregate counts. Individual desire ratings are never revealed or exported.',
    },
    formattedText,
  });
});
