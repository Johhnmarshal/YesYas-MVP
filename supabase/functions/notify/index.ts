// Delivers the discreet reveal nudges queued in public.notification_outbox.
//
// The database decides what to send (see migration 20261103000001); this
// function only delivers it. The app calls it after tapping "I'm ready" and
// when Home loads, with the signed-in user's token. It sends whatever is
// queued for that user's pairings, which is always mail for their partner or
// for them, never for anyone else.
//
// Email goes through one of two providers, chosen by which secrets exist:
//   Gmail:   GMAIL_USER + GMAIL_APP_PASSWORD   (SMTP over TLS on port 465;
//            Supabase blocks outgoing 25 and 587, and Gmail needs an App
//            Password, not the account password)
//   Resend:  RESEND_API_KEY + NOTIFY_FROM      (HTTPS API)
// With neither set, nothing is sent and the queue simply waits.
//
// Content is deliberately bland: a subject line on a lock screen or a shared
// inbox should not say what the app is for.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { withCors } from '../_shared/cors.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://yesyas.vercel.app';
const MAX_ATTEMPTS = 5;
// A nudge older than this is no longer true (the readiness window is 72h).
const MAX_AGE_HOURS = 72;

type Kind = 'partner_ready' | 'matches_ready';

interface OutboxRow {
  id: string;
  recipient_id: string;
  pairing_id: string | null;
  kind: Kind;
  attempts: number;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function compose(kind: Kind, to: string, partnerName: string | null): Mail {
  const who = partnerName?.trim() || 'Your partner';
  const lines =
    kind === 'partner_ready'
      ? {
          subject: `${who} is ready when you are`,
          body: `${who} is ready on YesYas!. When you are ready too, open the app to continue together. Nothing is shared until you both choose.`,
          cta: 'Open YesYas!',
        }
      : {
          subject: 'Something is waiting for you on YesYas!',
          body: 'You are both ready, so there is something new for the two of you in the app. It stays available for 24 hours.',
          cta: 'Open YesYas!',
        };
  const link = `${APP_URL}/home`;
  const footer =
    'You can switch these emails off any time in Settings.';
  return {
    to,
    subject: lines.subject,
    text: `${lines.body}\n\n${lines.cta}: ${link}\n\n${footer}`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1E293B;max-width:480px;margin:0 auto;padding:24px">` +
      `<p style="font-size:16px;line-height:24px">${escapeHtml(lines.body)}</p>` +
      `<p><a href="${link}" style="display:inline-block;background:#1E293B;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">${lines.cta}</a></p>` +
      `<p style="font-size:13px;color:#64748B">${footer}</p></div>`,
  };
}

async function sendMail(mail: Mail): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (gmailUser && gmailPass) {
    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });
    try {
      await client.send({
        from: `YesYas! <${gmailUser}>`,
        to: mail.to,
        subject: mail.subject,
        content: mail.text,
        html: mail.html,
      });
    } finally {
      await client.close();
    }
    return;
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFY_FROM');
  if (resendKey && from) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) {
      throw new Error(`Resend responded ${res.status}`);
    }
    return;
  }

  throw new NoProviderError();
}

class NoProviderError extends Error {
  constructor() {
    super('no email provider configured');
  }
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'server misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'not signed in' }, 401);
  }
  const caller = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Only the caller's own active pairing: a paused pairing has put reveals on
  // hold, so nudging about one would be wrong.
  const { data: pairings, error: pairingError } = await admin
    .from('pairings')
    .select('id, inviter_user_id, invitee_user_id')
    .or(`inviter_user_id.eq.${caller},invitee_user_id.eq.${caller}`)
    .eq('status', 'active');
  if (pairingError) {
    return json({ error: 'could not load pairing' }, 500);
  }
  const pairingIds = (pairings ?? []).map((p) => p.id);
  if (pairingIds.length === 0) {
    return json({ sent: 0 });
  }

  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const { data: rows, error: rowsError } = await admin
    .from('notification_outbox')
    .select('id, recipient_id, pairing_id, kind, attempts')
    .in('pairing_id', pairingIds)
    .is('sent_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .gt('created_at', cutoff)
    .limit(10);
  if (rowsError) {
    return json({ error: 'could not load queue' }, 500);
  }

  let sent = 0;
  for (const row of (rows ?? []) as OutboxRow[]) {
    const pairing = (pairings ?? []).find((p) => p.id === row.pairing_id);
    if (!pairing) continue;
    const partnerOfRecipient =
      pairing.inviter_user_id === row.recipient_id
        ? pairing.invitee_user_id
        : pairing.inviter_user_id;

    try {
      // Opt-out is checked again at send time: it may have changed since the
      // nudge was queued.
      const { data: prefs } = await admin
        .from('profiles')
        .select('email_notifications')
        .eq('id', row.recipient_id)
        .maybeSingle();
      if (!prefs?.email_notifications) {
        await admin.from('notification_outbox').delete().eq('id', row.id);
        continue;
      }

      const { data: recipient } = await admin.auth.admin.getUserById(row.recipient_id);
      const email = recipient?.user?.email;
      if (!email) {
        throw new Error('recipient has no email');
      }
      const { data: partner } = partnerOfRecipient
        ? await admin.from('profiles').select('display_name').eq('id', partnerOfRecipient).maybeSingle()
        : { data: null };

      await sendMail(compose(row.kind, email, partner?.display_name ?? null));
      await admin
        .from('notification_outbox')
        .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null })
        .eq('id', row.id);
      sent += 1;
    } catch (err) {
      if (err instanceof NoProviderError) {
        // Leave the queue untouched so it goes out once a provider is set.
        return json({ sent, reason: 'no_provider' });
      }
      const message = err instanceof Error ? err.message : 'send failed';
      await admin
        .from('notification_outbox')
        .update({ attempts: row.attempts + 1, last_error: message.slice(0, 500) })
        .eq('id', row.id);
    }
  }

  return json({ sent });
}

Deno.serve(withCors(handle));
