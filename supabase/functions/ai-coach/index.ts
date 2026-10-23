import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { AI_COACH_SYSTEM_PROMPT } from './system-prompt.ts';

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

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFLECTIVE_PROMPTS = [
  'What part of that reflection feels most grounding or energizing to you right now?',
  'When you notice that feeling, what helps you feel most at ease and unhurried with yourself?',
  'If there were zero pressure to act on or explain this, how would you describe what matters most to you about it?',
  'What would make exploring this thought feel a little safer or more comfortable over the next week?',
];

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

  // Verify JWT and authenticate user
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired user session' }, 401);
  }

  let body: { message?: string; threadId?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return jsonResponse({ error: 'Message cannot be empty' }, 400);
  }

  const threadId =
    body.threadId && UUID_REGEX.test(body.threadId)
      ? body.threadId
      : crypto.randomUUID();

  // Compute hashed user ID for privacy-preserving rate-limiting and logging
  const userIdHash = await sha256Hex(`ai_logs:${user.id.toLowerCase()}`);

  // Rate Limiting Rule 1: 20 messages per session
  const { count: sessionCount, error: sessionErr } = await adminClient
    .from('ai_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id_hash', userIdHash)
    .eq('thread_id', threadId);

  if (sessionErr) {
    console.error('Session count check error:', sessionErr);
  } else if ((sessionCount ?? 0) >= 20) {
    return jsonResponse(
      {
        error:
          'Session message limit reached (20 messages/session). Please start a new session or take time to reflect on your notes.',
        code: 'RATE_LIMIT_SESSION_EXCEEDED',
      },
      429,
    );
  }

  // Rate Limiting Rule 2: 100 messages per day (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount, error: dailyErr } = await adminClient
    .from('ai_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id_hash', userIdHash)
    .gte('created_at', oneDayAgo);

  if (dailyErr) {
    console.error('Daily count check error:', dailyErr);
  } else if ((dailyCount ?? 0) >= 100) {
    return jsonResponse(
      {
        error:
          'Daily message limit reached (100 messages/day). Please continue journaling tomorrow.',
        code: 'RATE_LIMIT_DAILY_EXCEEDED',
      },
      429,
    );
  }

  // Check 6 mandatory safety rules locally for guaranteed compliance
  const lowerMsg = message.toLowerCase();
  let reply = '';
  let modelUsed = 'builtin-reflective';
  let promptTokens = Math.ceil(message.length / 4);
  let completionTokens = 0;

  // Rule 4: Consent questions redirect
  if (
    lowerMsg.includes('consent') ||
    lowerMsg.includes('coerc') ||
    lowerMsg.includes('force') ||
    lowerMsg.includes('legal age') ||
    lowerMsg.includes('assault')
  ) {
    reply =
      'This is worth discussing with a professional. Your safety and boundaries are essential, and a licensed professional can provide tailored guidance.';
  }
  // Rule 5: Specific sex act or approaching partner advice
  else if (
    lowerMsg.includes('how do i tell my partner to') ||
    lowerMsg.includes('how do i convince') ||
    lowerMsg.includes('how to make my partner') ||
    lowerMsg.includes('should i ask them to')
  ) {
    reply =
      "I can help you explore this privately in your journal, but I won't advise on how to approach a partner about it. Remember that I am an AI journaling companion and not a therapist.";
  } else {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');

    if (anthropicKey) {
      try {
        modelUsed = 'claude-3-5-sonnet-20241022';
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 300,
            system: AI_COACH_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message }],
          }),
        });

        if (res.ok) {
          const aiData = await res.json();
          reply =
            aiData.content?.[0]?.text?.trim() ||
            'Thank you for sharing your thoughts.';
          promptTokens = aiData.usage?.input_tokens ?? promptTokens;
          completionTokens = aiData.usage?.output_tokens ?? 0;
        }
      } catch (err) {
        console.warn('Anthropic API call failed, falling back:', err);
      }
    } else if (openAiKey) {
      try {
        modelUsed = 'gpt-4o-mini';
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            messages: [
              { role: 'system', content: AI_COACH_SYSTEM_PROMPT },
              { role: 'user', content: message },
            ],
          }),
        });

        if (res.ok) {
          const aiData = await res.json();
          reply =
            aiData.choices?.[0]?.message?.content?.trim() ||
            'Thank you for sharing your reflection.';
          promptTokens = aiData.usage?.prompt_tokens ?? promptTokens;
          completionTokens = aiData.usage?.completion_tokens ?? 0;
        }
      } catch (err) {
        console.warn('OpenAI API call failed, falling back:', err);
      }
    }

    if (!reply) {
      modelUsed = 'builtin-reflective';
      const promptIndex = Math.abs(message.length) % REFLECTIVE_PROMPTS.length;
      reply = `Thank you for taking time to explore this in your private journal. As a reminder, I am an AI self-reflection companion and not a licensed therapist. ${REFLECTIVE_PROMPTS[promptIndex]}`;
      completionTokens = Math.ceil(reply.length / 4);
    }
  }

  if (completionTokens === 0) {
    completionTokens = Math.ceil(reply.length / 4);
  }

  // Log anonymized invocation into public.ai_logs (zero plaintext logged)
  const { error: logErr } = await adminClient.from('ai_logs').insert({
    user_id_hash: userIdHash,
    thread_id: threadId,
    model: modelUsed,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  });

  if (logErr) {
    console.error('Failed to log AI call:', logErr);
  }

  return jsonResponse({
    reply,
    threadId,
    model: modelUsed,
  });
});
