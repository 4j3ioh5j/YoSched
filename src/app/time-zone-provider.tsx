"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

// Card #320: the Settings time zone for every page. It is read once a login is signed in, again
// whenever the tab comes back into view, and at once after Settings saves a new zone (the
// "yosched:time-zone" event), so an open tab never keeps showing times in the old zone.

export type TimeZoneState = { zone: string; storedZone: string | null; loaded: boolean; refresh: () => Promise<void> };
export const TIME_ZONE_EVENT = "yosched:time-zone";

// One provider per page (root layout): a later read always wins over an earlier one.
let readSeq = 0;

const Ctx = createContext<TimeZoneState>({ zone: "UTC", storedZone: null, loaded: false, refresh: async () => {} });

export function TimeZoneProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [st, setSt] = useState<{ zone: string; storedZone: string | null; loaded: boolean }>({ zone: "UTC", storedZone: null, loaded: false });
  const refresh = useCallback(async () => {
    const mine = ++readSeq;
    try {
      const res = await fetch("/api/settings/time-zone", { cache: "no-store" });
      if (!res.ok) return;
      const b = (await res.json()) as { zone?: unknown; storedZone?: unknown };
      if (mine !== readSeq || typeof b.zone !== "string") return; // a later read wins
      setSt({ zone: b.zone, storedZone: typeof b.storedZone === "string" ? b.storedZone : null, loaded: true });
    } catch { /* offline: keep the last zone; the next focus tries again */ }
  }, []);
  useEffect(() => {
    if (status !== "authenticated") return;
    void Promise.resolve().then(refresh);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    const onEvt = () => void refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(TIME_ZONE_EVENT, onEvt);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener(TIME_ZONE_EVENT, onEvt); };
  }, [status, refresh]);
  const value = useMemo(() => ({ ...st, refresh }), [st, refresh]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useTimeZone(): TimeZoneState {
  return useContext(Ctx);
}
