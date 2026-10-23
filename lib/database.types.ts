// Hand-written types matching the v1 schema in supabase/migrations/.
// Once you have the Supabase CLI set up, regenerate this file with:
//   supabase gen types typescript --local > lib/database.types.ts

export type ToneLabel = 'romantic' | 'playful' | 'direct';
export type DesireTier = 'sensory' | 'suggestive' | 'explicit';
export type PairingStatus = 'pending' | 'active' | 'paused' | 'ended';
export type RevealStatus = 'pending' | 'both_ready' | 'computed' | 'expired';
export type ConsentEventType =
  | 'pairing_accepted'
  | 'pairing_ended'
  | 'reveal_triggered'
  | 'reveal_revealed'
  | 'therapist_export';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          tone_preference: ToneLabel;
          content_tier_preference: DesireTier;
          locale: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          tone_preference?: ToneLabel;
          content_tier_preference?: DesireTier;
          locale?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      pairings: {
        Row: {
          id: string;
          inviter_user_id: string;
          invitee_user_id: string | null;
          status: PairingStatus;
          invite_code: string | null;
          created_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          inviter_user_id: string;
          invitee_user_id?: string | null;
          status?: PairingStatus;
          invite_code?: string | null;
        };
        Update: Partial<Database['public']['Tables']['pairings']['Insert']>;
      };
      desire_library_items: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          tier: DesireTier;
          tone_tags: string[];
          locale: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          description?: string | null;
          tier: DesireTier;
          tone_tags?: string[];
          locale?: string;
          active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['desire_library_items']['Insert']>;
      };
      desires: {
        Row: {
          id: string;
          user_id: string;
          pairing_id: string | null;
          library_item_id: string;
          rating: number;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pairing_id?: string | null;
          library_item_id: string;
          rating: number;
          note?: string | null;
        };
        Update: Partial<Database['public']['Tables']['desires']['Insert']>;
      };
      reveals: {
        Row: {
          id: string;
          pairing_id: string;
          status: RevealStatus;
          triggered_at: string;
          both_ready_at: string | null;
          revealed_at: string | null;
          expires_at: string | null;
          matches: unknown | null;
          mismatches: unknown | null;
          summary: unknown | null;
        };
        Insert: {
          id?: string;
          pairing_id: string;
          status?: RevealStatus;
        };
        Update: Partial<Database['public']['Tables']['reveals']['Insert']>;
      };
      journal_entries: {
        Row: {
          id: string;
          user_id: string;
          body: string;
          ai_coach_thread_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          body: string;
          ai_coach_thread_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['journal_entries']['Insert']>;
      };
      consent_events: {
        Row: {
          id: string;
          user_id: string;
          pairing_id: string | null;
          event_type: ConsentEventType;
          payload: unknown | null;
          payload_hash: string;
          prev_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pairing_id?: string | null;
          event_type: ConsentEventType;
          payload?: unknown | null;
        };
        Update: never;
      };
    };
    Views: { [key: string]: never };
    Functions: {
      trigger_reveal: {
        Args: { p_pairing_id: string };
        Returns: { reveal_id: string; status: RevealStatus };
      };
    };
    Enums: {
      tone_label: ToneLabel;
      desire_tier: DesireTier;
      pairing_status: PairingStatus;
      reveal_status: RevealStatus;
      consent_event_type: ConsentEventType;
    };
  };
}
