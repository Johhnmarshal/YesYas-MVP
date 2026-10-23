// Hand-written types matching the v1 schema in supabase/migrations/20260420000001..0004.sql
// plus 20261023000001_key_recovery.sql.
// Compatible with @supabase/supabase-js v2 generic Database schema.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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

export interface RevealMatchItem {
  library_item_id: string;
  slug: string;
  title: string;
  description: string | null;
  tier: DesireTier;
}

export interface RevealMismatchItem {
  library_item_id: string;
  slug: string;
  title: string;
  tier: DesireTier;
}

export interface RevealSummary {
  match_count: number;
  mismatch_count?: number;
  expired_at?: string;
}

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
          onboarding_complete: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          tone_preference?: ToneLabel;
          content_tier_preference?: DesireTier;
          locale?: string;
          onboarding_complete?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          tone_preference?: ToneLabel;
          content_tier_preference?: DesireTier;
          locale?: string;
          onboarding_complete?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      pairings: {
        Row: {
          id: string;
          inviter_user_id: string;
          invitee_user_id: string | null;
          status: PairingStatus;
          invite_code: string | null;
          invite_expires_at: string | null;
          created_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          inviter_user_id: string;
          invitee_user_id?: string | null;
          status?: PairingStatus;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          created_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          inviter_user_id?: string;
          invitee_user_id?: string | null;
          status?: PairingStatus;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          created_at?: string;
          ended_at?: string | null;
        };
        Relationships: [];
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
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          description?: string | null;
          tier?: DesireTier;
          tone_tags?: string[];
          locale?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          pairing_id?: string | null;
          library_item_id?: string;
          rating?: number;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reveals: {
        Row: {
          id: string;
          pairing_id: string;
          status: RevealStatus;
          triggered_by: string | null;
          triggered_at: string;
          both_ready_at: string | null;
          revealed_at: string | null;
          expires_at: string | null;
          matches: RevealMatchItem[] | null;
          mismatches: RevealMismatchItem[] | null;
          summary: RevealSummary | null;
        };
        Insert: {
          id?: string;
          pairing_id: string;
          status?: RevealStatus;
          triggered_by?: string | null;
          triggered_at?: string;
          both_ready_at?: string | null;
          revealed_at?: string | null;
          expires_at?: string | null;
          matches?: RevealMatchItem[] | null;
          mismatches?: RevealMismatchItem[] | null;
          summary?: RevealSummary | null;
        };
        Update: {
          id?: string;
          pairing_id?: string;
          status?: RevealStatus;
          triggered_by?: string | null;
          triggered_at?: string;
          both_ready_at?: string | null;
          revealed_at?: string | null;
          expires_at?: string | null;
          matches?: RevealMatchItem[] | null;
          mismatches?: RevealMismatchItem[] | null;
          summary?: RevealSummary | null;
        };
        Relationships: [];
      };
      reveal_readiness: {
        Row: {
          pairing_id: string;
          user_id: string;
          ready_at: string;
          reveal_window_id: string;
        };
        Insert: {
          pairing_id: string;
          user_id: string;
          ready_at?: string;
          reveal_window_id?: string;
        };
        Update: {
          pairing_id?: string;
          user_id?: string;
          ready_at?: string;
          reveal_window_id?: string;
        };
        Relationships: [];
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
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          body?: string;
          ai_coach_thread_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      consent_events: {
        Row: {
          id: string;
          user_id: string;
          pairing_id: string | null;
          event_type: ConsentEventType;
          payload: Json | null;
          payload_hash: string;
          prev_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pairing_id?: string | null;
          event_type: ConsentEventType;
          payload?: Json | null;
          payload_hash?: string;
          prev_hash?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      ai_flags: {
        Row: {
          id: string;
          user_id: string;
          journal_entry_id: string | null;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          journal_entry_id?: string | null;
          reason?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          journal_entry_id?: string | null;
          reason?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_logs: {
        Row: {
          id: string;
          user_id_hash: string;
          thread_id: string | null;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id_hash: string;
          thread_id?: string | null;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id_hash?: string;
          thread_id?: string | null;
          model?: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      user_key_recovery: {
        Row: {
          user_id: string;
          wrapped_key: string;
          salt: string;
          iterations: number;
          kdf: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          wrapped_key: string;
          salt: string;
          iterations: number;
          kdf?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          wrapped_key?: string;
          salt?: string;
          iterations?: number;
          kdf?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: {
      create_pairing_invite: {
        Args: Record<PropertyKey, never>;
        Returns: {
          pairing_id: string;
          invite_code: string;
          expires_at: string;
        }[];
      };
      preview_pairing_invite: {
        Args: { p_invite_code: string };
        Returns: {
          pairing_id: string;
          inviter_display_name: string;
          expires_at: string;
        }[];
      };
      accept_pairing_invite: {
        Args: { p_invite_code: string };
        Returns: string;
      };
      update_pairing_status: {
        Args: { p_pairing_id: string; p_new_status: PairingStatus };
        Returns: undefined;
      };
      trigger_reveal: {
        Args: { p_pairing_id: string };
        Returns: {
          reveal_id: string;
          status: RevealStatus;
        }[];
      };
      withdraw_reveal: {
        Args: { p_pairing_id: string };
        Returns: undefined;
      };
      request_therapist_export: {
        Args: { p_pairing_id: string };
        Returns: {
          both_consented: boolean;
          export_event_id: string;
        }[];
      };
      expire_old_reveals: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      is_pairing_member: {
        Args: { p_pairing_id: string; p_user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      tone_label: ToneLabel;
      desire_tier: DesireTier;
      pairing_status: PairingStatus;
      reveal_status: RevealStatus;
      consent_event_type: ConsentEventType;
    };
    CompositeTypes: { [key: string]: never };
  };
}
