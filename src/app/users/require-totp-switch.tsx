"use client";

import { useEffect, useState } from "react";

// Card #319: "Require two-factor sign-in for every login". The state shown is always what the
// server last saved (read on load, replaced by each save's answer), never a guess.
export function RequireTotpSwitch({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<{ requireTotp: boolean; pendingLogins: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function read(): Promise<{ requireTotp: boolean; pendingLogins: number } | null> {
    const res = await fetch("/api/settings/require-totp");
    return res.ok ? res.json() : null;
  }
  useEffect(() => {
    let live = true;
    read().then((d) => { if (live && d) setSaved(d); }, () => {});
    return () => { live = false; };
  }, []);

  async function toggle() {
    if (!saved || saving) return;
    const next = !saved.requireTotp;
    if (next && !confirm(
      `Require two-factor sign-in for every login?\n\n` +
      (saved.pendingLogins > 0
        ? `${saved.pendingLogins} login${saved.pendingLogins === 1 ? " hasn't" : "s haven't"} set it up yet. They'll be asked to set it up the next time they sign in, and can't use YoSched until they do.`
        : "Every active login already has it set up."),
    )) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings/require-totp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireTotp: next }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Couldn't save");
    } finally {
      const d = await read().catch(() => null);
      if (d) setSaved(d);
      setSaving(false);
    }
  }

  if (!saved) return null;
  return (
    <div className="mb-4 px-3 py-2.5 bg-slate-800/40 border border-slate-700/50 rounded text-xs text-slate-500 space-y-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={saved.requireTotp}
          onChange={toggle}
          disabled={!canEdit || saving}
          className="accent-blue-500 disabled:opacity-50"
          data-require-totp
        />
        <span className="text-slate-300">Require two-factor sign-in for every login</span>
        {saved.requireTotp && saved.pendingLogins > 0 && (
          <span className="ml-auto text-amber-400">
            {saved.pendingLogins} login{saved.pendingLogins === 1 ? "" : "s"} still need{saved.pendingLogins === 1 ? "s" : ""} to set it up
          </span>
        )}
      </label>
      {error && <p className="text-red-400" role="alert">{error}</p>}
    </div>
  );
}
