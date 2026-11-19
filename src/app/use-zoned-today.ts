"use client";

import { useEffect, useState } from "react";
import { dateInZone } from "@/lib/request-lines";

// Card #348: today's date ("YYYY-MM-DD") in the Settings time zone, for the grid's today ring.
// null until the zone is loaded and the page is in the browser: the server draws the page in
// UTC and the browser keeps the server's markup, so a date computed during the render would
// ring the wrong row. It is checked again every minute and when the tab comes back into view,
// so the ring moves at midnight in the zone.

export function zonedToday(now: Date, zone: string, loaded: boolean): string | null {
  return loaded ? dateInZone(now, zone) : null;
}

export function useZonedToday(zone: string, loaded: boolean): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setToday(zonedToday(new Date(), zone, loaded));
    tick();
    const id = window.setInterval(tick, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [zone, loaded]);
  return today;
}
