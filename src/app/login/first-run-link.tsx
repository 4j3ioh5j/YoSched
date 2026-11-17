"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Card #314: on an empty install (no logins at all) the sign-in page offers the first-run restore.
export function FirstRunRestoreLink() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/backup/initial", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { available?: boolean } | null) => { if (alive) setAvailable(!!s?.available); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!available) return null;
  return (
    <div className="mb-6 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
      No accounts yet. <Link href="/setup/restore" className="underline hover:text-white">Restore from a backup file</Link>
    </div>
  );
}
