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

function serializeJsonValue(value: Json, postgresSpacing: boolean): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const sep = postgresSpacing ? ', ' : ',';
    return `[${value.map((item) => serializeJsonValue(item, postgresSpacing)).join(sep)}]`;
  }
  const keys = Object.keys(value).sort();
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
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function logConsentEvent(
  userId: string,
  eventType: ConsentEventType,
  pairingId?: string | null,
  payload?: Json | null,
): Promise<ConsentEventRow> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('consent_events')
    .insert({
      user_id: userId,
      event_type: eventType,
      pairing_id: pairingId ?? null,
      payload: payload ?? {},
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }
  return data;
}
