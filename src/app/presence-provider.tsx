"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { HEARTBEAT_INTERVAL_MS, type ActiveEditor } from "@/lib/presence";

// App-wide presence. Mounted once near the root (inside the SessionProvider) so it runs
// on EVERY authenticated page — that is what makes "logged in is enough": an editor
// sitting on the Staff or Settings page still heartbeats and still counts toward the
// banner on someone else's schedule page. It deliberately does NOT know or report which
// page anyone is on.
//
// Strictly read-only w.r.t. the schedule. It pings POST /api/presence/heartbeat and
// stores the returned list of other active editors in its own React state. The schedule
// grid does not consume this context, so presence updates can never re-render the grid
// or disturb an in-flight edit — the failure mode that forced the earlier rollback.

const PresenceContext = createContext<ActiveEditor[]>([]);

/** Other schedule editors currently active (excludes the viewer). Empty unless the
 *  viewer is an editor and at least one other editor is active. */
export function useActiveEditors(): ActiveEditor[] {
  return useContext(PresenceContext);
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
  const canEdit = permissions.includes("schedule:edit");

  const [editors, setEditors] = useState<ActiveEditor[]>([]);
  // Guards against a late response landing after we've stopped (logout / lost edit
  // rights) and resurrecting a banner.
  const activeRef = useRef(false);

  useEffect(() => {
    // Only editors heartbeat. Non-editors are irrelevant to the banner and the endpoint
    // would 403 them anyway, so we simply never start the interval for them. (We don't
    // clear state here — the provided value below is masked to [] when !canEdit, which
    // avoids a synchronous setState inside this effect.)
    if (!canEdit) return;

    activeRef.current = true;

    async function beat() {
      try {
        const res = await fetch("/api/presence/heartbeat", { method: "POST" });
        if (!res.ok) return; // transient/403 — leave the last known state, try again next tick
        const data = (await res.json()) as { activeEditors?: ActiveEditor[] };
        if (activeRef.current) setEditors(data.activeEditors ?? []);
      } catch {
        // network blip — ignore; the next interval will retry
      }
    }

    beat(); // announce presence immediately on mount
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      clearInterval(timer);
    };
  }, [canEdit]);

  // Mask to [] for non-editors so a stale list from a prior editor session can never
  // surface after a downgrade/logout, without clearing state inside the effect above.
  return (
    <PresenceContext.Provider value={canEdit ? editors : []}>{children}</PresenceContext.Provider>
  );
}
