"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Card #314: an amber "Backup due" note in the header for logins that may back up, once the
// last backup is older than Settings › Backup and Restore's reminder days. The server decides
// (from the database, not the sign-in token) whether this login may see it.
export function BackupDuePill() {
  const [due, setDue] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/backup/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { allowed?: boolean; due?: boolean } | null) => { if (alive) setDue(!!(s?.allowed && s.due)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!due) return null;
  return (
    <Link href="/settings#backup-restore" title="It's been a while since the last backup. Open Settings › Backup and Restore to download one." className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30">
      Backup due
    </Link>
  );
}
