import type { RealtimeChannel } from '@supabase/supabase-js';
import { usePathname } from 'expo-router';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { getActiveOrPendingPairing } from '@/lib/pairing';
import {
  type PresenceWhere,
  partnerPresenceFrom,
  presenceTopic,
  presenceWhere,
} from '@/lib/presence-state';
import { supabase } from '@/lib/supabase';

interface PartnerInfo {
  avatar: string | null;
  heat: string | null;
  sharesPresence: boolean;
}

interface PresenceContextValue {
  /** Where the partner is right now, or null (offline, or not shared both ways). */
  partnerWhere: PresenceWhere | null;
  /** True while both of you share presence and the channel is joined. */
  live: boolean;
  iShare: boolean;
  partner: PartnerInfo | null;
  /** Re-read settings (after a toggle in Settings). */
  refresh: () => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  partnerWhere: null,
  live: false,
  iShare: false,
  partner: null,
  refresh: () => undefined,
});

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

/**
 * Opt-in presence (migration 20261113000001). Joins the private Realtime
 * channel for the pairing only when both partners share presence; the
 * channel's RLS refuses it otherwise anyway. Publishes only 'library' or
 * 'app', never the screen or item.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const where = presenceWhere(pathname);
  const whereRef = useRef(where);
  whereRef.current = where;

  const [setup, setSetup] = useState<{ userId: string; partnerId: string; pairingId: string } | null>(null);
  const [iShare, setIShare] = useState(false);
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [partnerWhere, setPartnerWhere] = useState<PresenceWhere | null>(null);
  const [live, setLive] = useState(false);
  const [version, setVersion] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Settings and partner info.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) return;
        const pairing = await getActiveOrPendingPairing(user.id);
        const partnerId =
          pairing && pairing.status !== 'pending'
            ? pairing.inviter_user_id === user.id
              ? pairing.invitee_user_id
              : pairing.inviter_user_id
            : null;
        const [{ data: me }, partnerRes] = await Promise.all([
          supabase.from('profiles').select('share_presence').eq('id', user.id).maybeSingle(),
          partnerId
            ? supabase.rpc('get_partner_profile', { p_partner_id: partnerId })
            : Promise.resolve({ data: null }),
        ]);
        if (cancelled) return;
        setIShare(me?.share_presence === true);
        const row = Array.isArray(partnerRes.data) ? partnerRes.data[0] : null;
        setPartner(row ? { avatar: row.avatar, heat: row.heat, sharesPresence: row.shares_presence } : null);
        setSetup(
          pairing && pairing.status === 'active' && partnerId
            ? { userId: user.id, partnerId, pairingId: pairing.id }
            : null,
        );
      } catch {
        // Presence is a nicety; never block the app on it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const both = iShare && partner?.sharesPresence === true && setup !== null;

  // The channel itself.
  useEffect(() => {
    if (!both || !setup) {
      setLive(false);
      setPartnerWhere(null);
      return;
    }
    const channel = supabase.channel(presenceTopic(setup.pairingId), {
      config: { private: true, presence: { key: setup.userId } },
    });
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        setPartnerWhere(partnerPresenceFrom(channel.presenceState(), setup.partnerId));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLive(true);
          void channel.track({ user_id: setup.userId, where: whereRef.current });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLive(false);
          setPartnerWhere(null);
        }
      });
    return () => {
      channelRef.current = null;
      void channel.untrack().catch(() => undefined);
      void supabase.removeChannel(channel);
    };
  }, [both, setup]);

  // Keep 'library' or 'app' current. Presence is fine for slow-changing
  // state like this (one update per screen change).
  useEffect(() => {
    if (!live || !setup || !channelRef.current) return;
    void channelRef.current.track({ user_id: setup.userId, where }).catch(() => undefined);
  }, [live, setup, where]);

  return (
    <PresenceContext.Provider value={{ partnerWhere, live, iShare, partner, refresh }}>
      {children}
    </PresenceContext.Provider>
  );
}
