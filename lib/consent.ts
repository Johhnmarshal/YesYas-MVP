import type { ConsentEventType, Database, Json } from './database.types';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { sha256Hex } from './crypto.ts';

export type ConsentEventRow = Database['public']['Tables']['consent_events']['Row'];

export const CONSENT_EVENT_LABELS: Record<ConsentEventType, string> = {
  pairing_accepted: 'Pairing Accepted',
  pairing_ended: 'Pairing Ended',
  reveal_triggered: 'Reveal Readiness Marked',
  reveal_revealed: 'Mutual Reveal Computed',
  therapist_export: 'Therapist Summary Export Consented',
};

function formatPayloadJson(value: Json | null | undefined, postgresSpacing: boolean): string {
  if (value === null || value === undefined) {
    return '';
  }
  return serializeJsonValue(value, postgresSpacing);
}

/**
 * Orders object keys the way `jsonb` stores them: by UTF-8 byte length first,
 * then bytewise.
 *
 * This is the whole bug. The chain hash is computed by consent_events_chain()
 * from `new.payload::text`, and jsonb does not preserve insertion order — it
 * sorts keys by (length, bytes). This serialiser used Object.keys().sort(),
 * which is alphabetical, so the two agreed only when the two orderings
 * happened to coincide.
 *
 * They do not coincide for either reveal_triggered payload:
 *
 *   {reveal_id, state}             -> jsonb: state, reveal_id
 *   {reveal_id, window_id, role}   -> jsonb: role, reveal_id, window_id
 *
 * so verifyConsentChain returned { valid: false } for every couple that had
 * triggered a reveal, and the consent screen told them their audit trail had
 * been tampered with. Measured against a real trigger-written row: the stored
 * hash matched sha256 of the Postgres text exactly, and the value this module
 * computed shared not one character with it.
 *
 * That is the same failure 20261025000003 was written to prevent — the screen
 * accusing the system of altering the log — reached by a different route. The
 * ordering fix there was in SQL; this one is the client half nobody had
 * checked against real output.
 */
function compareJsonbKeys(a: string, b: string): number {
  const encoder = new TextEncoder();
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.length !== bb.length) {
    return ba.length - bb.length;
  }
  for (let i = 0; i < ba.length; i += 1) {
    if (ba[i] !== bb[i]) {
      return ba[i] - bb[i];
    }
  }
  return 0;
}

function serializeJsonValue(value: Json, postgresSpacing: boolean): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const sep = postgresSpacing ? ', ' : ',';
    return `[${value.map((item) => serializeJsonValue(item, postgresSpacing)).join(sep)}]`;
  }
  const keys = Object.keys(value).sort(compareJsonbKeys);
  const colon = postgresSpacing ? ': ' : ':';
  const comma = postgresSpacing ? ', ' : ',';
  const entries: string[] = [];
  for (const k of keys) {
    const v = value[k];
    if (v !== undefined) {
      entries.push(`${JSON.stringify(k)}${colon}${serializeJsonValue(v, postgresSpacing)}`);
    }
  }
  return `{${entries.join(comma)}}`;
}

export function computeConsentPayloadHash(
  event: Pick<ConsentEventRow, 'id' | 'event_type' | 'payload' | 'prev_hash'>,
): string {
  const payloadStr = formatPayloadJson(event.payload, true);
  const raw = `${event.id ?? ''}|${event.event_type}|${payloadStr}|${event.prev_hash ?? ''}`;
  return sha256Hex(raw);
}

function computeCompactConsentPayloadHash(
  event: Pick<ConsentEventRow, 'id' | 'event_type' | 'payload' | 'prev_hash'>,
): string {
  const payloadStr = formatPayloadJson(event.payload, false);
  const raw = `${event.id ?? ''}|${event.event_type}|${payloadStr}|${event.prev_hash ?? ''}`;
  return sha256Hex(raw);
}

export function verifyConsentChain(events: ConsentEventRow[]): {
  valid: boolean;
  brokenAtId: string | null;
} {
  for (let i = 0; i < events.length; i += 1) {
    const current = events[i];
    const expectedPrevHash = i === 0 ? null : events[i - 1].payload_hash;

    if ((current.prev_hash ?? null) !== expectedPrevHash) {
      return { valid: false, brokenAtId: current.id };
    }

    const expectedHashPg = computeConsentPayloadHash(current);
    const expectedHashCompact = computeCompactConsentPayloadHash(current);
    if (current.payload_hash !== expectedHashPg && current.payload_hash !== expectedHashCompact) {
      return { valid: false, brokenAtId: current.id };
    }
  }

  return { valid: true, brokenAtId: null };
}

export async function fetchConsentEvents(userId: string): Promise<ConsentEventRow[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('consent_events')
    .select('*')
    .eq('user_id', userId)
    // Must match the order consent_events_chain() builds the chain in. seq is
    // monotonic insertion order; created_at is the transaction timestamp and
    // ties for every row a single statement writes, which made the verifier
    // report valid logs as tampered.
    .order('seq', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

