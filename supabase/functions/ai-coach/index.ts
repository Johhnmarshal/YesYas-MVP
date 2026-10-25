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

// Was pinned to claude-3-5-sonnet-20241022, two generations old. A retired
// model id does not fail loudly here — the non-ok branch used to be silent, so
// the coach would just serve canned prompts forever.
const ANTHROPIC_MODEL = 'claude-opus-5-5';
const OPENAI_MODEL = 'gpt-4o-mini';

// Three distinct non-model outcomes, kept apart because the client shows a
// different notice for each. 'builtin-reflective' means no provider answered,
// which is worth telling the user — the reply is a stock phrase, not a
// response to what they wrote. 'safety-redirect' is the opposite: a
// deliberate, rule-driven answer. Labelling both 'builtin-reflective' would
// make the app apologise for working correctly.
const BUILTIN_MODEL = 'builtin-reflective';
const SAFETY_REDIRECT_MODEL = 'safety-redirect';

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
  let modelUsed = BUILTIN_MODEL;
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
    modelUsed = SAFETY_REDIRECT_MODEL;
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
    modelUsed = SAFETY_REDIRECT_MODEL;
  } else {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');

    if (anthropicKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            // Thinking is always on and billed against max_tokens on current
            // models, so the old 300 ceiling truncated the reply before it
            // reached a single visible word. Effort 'low' keeps a short
            // reflective note short without starving it.
            max_tokens: 4096,
            output_config: { effort: 'low' },
            system: AI_COACH_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message }],
          }),
        });

        if (res.ok) {
          const aiData = await res.json();
          // Safety classifiers can decline (HTTP 200 + stop_reason 'refusal').
          // Journals in this app are explicitly intimate, so this is a live
          // path, not a theoretical one: fall through to the built-in prompt
          // rather than returning an empty bubble.
          if (aiData.stop_reason === 'refusal') {
            console.warn(
              'Anthropic declined the request:',
              aiData.stop_details?.category ?? 'unknown',
            );
          } else {
            // content[] is a mixed list of thinking and text blocks. Indexing
            // [0] reads the thinking block, whose .text is undefined.
            const textBlock = Array.isArray(aiData.content)
              ? aiData.content.find(
                  (b: { type?: string }) => b?.type === 'text',
                )
              : undefined;
            const text = textBlock?.text?.trim();
            if (text) {
              reply = text;
              modelUsed = ANTHROPIC_MODEL;
              promptTokens = aiData.usage?.input_tokens ?? promptTokens;
              completionTokens = aiData.usage?.output_tokens ?? 0;
            } else {
              console.warn(
                'Anthropic returned no text block; stop_reason:',
                aiData.stop_reason,
              );
            }
          }
        } else {
          // Without this, a revoked key or a 429 was indistinguishable from
          // the feature simply being switched off: callers got a canned
          // reflective prompt and the logs said nothing at all.
          console.error(
            `Anthropic API returned ${res.status}:`,
            (await res.text()).slice(0, 500),
          );
        }
      } catch (err) {
        console.warn('Anthropic API call failed, falling back:', err);
      }
    }

    // A real fallback. This was `else if (openAiKey)`, which meant OpenAI was
    // only ever reached when ANTHROPIC_API_KEY was absent — so a present but
    // broken Anthropic key disabled the configured backup provider too.
    if (!reply && openAiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            max_tokens: 300,
            messages: [
              { role: 'system', content: AI_COACH_SYSTEM_PROMPT },
              { role: 'user', content: message },
            ],
          }),
        });

        if (res.ok) {
          const aiData = await res.json();
          const text = aiData.choices?.[0]?.message?.content?.trim();
          if (text) {
            reply = text;
            modelUsed = OPENAI_MODEL;
            promptTokens = aiData.usage?.prompt_tokens ?? promptTokens;
            completionTokens = aiData.usage?.completion_tokens ?? 0;
          }
        } else {
          console.error(
            `OpenAI API returned ${res.status}:`,
            (await res.text()).slice(0, 500),
          );
        }
      } catch (err) {
        console.warn('OpenAI API call failed, falling back:', err);
      }
    }

    if (!reply) {
      modelUsed = BUILTIN_MODEL;
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
