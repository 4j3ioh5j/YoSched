"use client";

import { useTimeZone } from "@/app/time-zone-provider";
import { formatClock, wallClock } from "@/lib/time-zone";
import { useEffect, useState } from "react";
import { CONFIRM_WORD } from "@/lib/backup/reminder";
import { AutoBackupSection } from "./auto-backup-section";
import { KeyFilePicker } from "./key-file-picker";

// Card #314: Settings › Backup and Restore. Shown only to logins holding
// "Back Up and Restore All Data".

const MIN_PASS = 12;
const BTN = "px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white";
const BTN_DANGER = "px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded text-white";
const INPUT = "bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50";

type Status = { lastBackupAt: string | null; reminderDays: number; due: boolean };
type Summary = { createdAt: string; appVersion: string; counts: Record<string, number> };

// Card #320: in the Settings time zone, with its label. Card #334: "today" / "N days ago"
// counts calendar days in that zone (yesterday 19:21 is 1 day ago, even under 24 hours).
export function lastBackupLabel(iso: string | null, zone: string, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const dayNo = (t: Date) => {
    const w = wallClock(t, zone);
    return Date.UTC(w.year, w.month - 1, w.day) / 86_400_000;
  };
  const days = Math.max(0, dayNo(now) - dayNo(d));
  const stamp = `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: zone })} ${formatClock(d, zone)}`;
  return `${stamp} (${days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`})`;
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `The server answered ${res.status}`;
}

export function BackupPanel({ onError }: { onError: (e: string | undefined) => void }) {
  const { zone } = useTimeZone();
  const [status, setStatus] = useState<Status | null>(null);
  const [days, setDays] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState<null | "download" | "check" | "restore" | "days">(null);
  const [note, setNote] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null); // card #315: automatic backups need their key file
  const [rpass, setRpass] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState("");

  const load = async () => {
    const res = await fetch("/api/backup/status", { cache: "no-store" });
    if (!res.ok) { onError(await errorOf(res)); return; }
    const s = (await res.json()) as Status & { allowed: boolean };
    if (s.allowed) { setStatus(s); setDays(String(s.reminderDays)); }
  };
  useEffect(() => {
    let alive = true;
    fetch("/api/backup/status", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Status & { allowed: boolean }) : Promise.reject(await errorOf(res))))
      .then((s) => { if (alive && s.allowed) { setStatus(s); setDays(String(s.reminderDays)); } })
      .catch((e: unknown) => { if (alive) onError(typeof e === "string" ? e : "Could not reach the server"); });
    return () => { alive = false; };
  }, [onError]);

  const fail = (e: string) => { onError(e); setNote(null); };

  async function download() {
    setBusy("download"); onError(undefined); setNote(null);
    try {
      const res = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: pass }) });
      if (!res.ok) return fail(await errorOf(res));
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "YoSched backup.yosched-backup";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPass(""); setPass2("");
      setNote(`Saved as "${name}". Keep it somewhere safe, away from this server, and keep the passphrase separately.`);
      await load();
    } finally { setBusy(null); }
  }

  function form(): FormData {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (keyFile) fd.set("keyfile", keyFile);
    fd.set("passphrase", rpass);
    return fd;
  }

  async function check() {
    setBusy("check"); onError(undefined); setNote(null); setSummary(null);
    try {
      const res = await fetch("/api/backup/check", { method: "POST", body: form() });
      if (!res.ok) return fail(await errorOf(res));
      setSummary((await res.json()) as Summary);
    } finally { setBusy(null); }
  }

  async function restore() {
    setBusy("restore"); onError(undefined); setNote(null);
    try {
      const fd = form();
      fd.set("confirm", confirm);
      const res = await fetch("/api/backup/restore", { method: "POST", body: fd });
      if (!res.ok) return fail(await errorOf(res));
      const out = (await res.json()) as { safetyFile: string | null };
      setNote(`Restored. The data it replaced was saved on the server as "${out.safetyFile}". Reloading…`);
      setTimeout(() => window.location.reload(), 2500);
    } finally { setBusy(null); }
  }

  async function saveDays() {
    setBusy("days"); onError(undefined);
    try {
      const res = await fetch("/api/backup/status", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reminderDays: Number(days) }) });
      if (!res.ok) return fail(await errorOf(res));
      await load();
    } finally { setBusy(null); }
  }

  if (!status) return <p className="text-sm text-slate-500">Loading…</p>;
  const passOk = pass.length >= MIN_PASS && pass === pass2;
  const total = summary ? Object.values(summary.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6 text-sm text-slate-300">
      <div>
        <p>Last backup: <span className={status.due ? "text-amber-400" : "text-slate-200"}>{lastBackupLabel(status.lastBackupAt, zone)}</span></p>
        <label className="mt-2 flex items-center gap-2">
          Remind me after
          <input className={`${INPUT} w-16`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy !== null} />
          days without a backup (0 = never)
          <button type="button" className={BTN} disabled={busy !== null || days === String(status.reminderDays)} onClick={saveDays}>Save</button>
        </label>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-slate-200">Download a backup</h4>
        <p className="text-xs text-slate-500">Choose a passphrase of at least {MIN_PASS} characters. Without it the file can&apos;t be restored, and nobody, including YoSched, can recover a forgotten one.</p>
        <div className="flex flex-wrap gap-2">
          <input type="password" autoComplete="new-password" placeholder="Passphrase" className={INPUT} value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy !== null} />
          <input type="password" autoComplete="new-password" placeholder="Passphrase again" className={INPUT} value={pass2} onChange={(e) => setPass2(e.target.value)} disabled={busy !== null} />
          <button type="button" className={BTN} disabled={busy !== null || !passOk} onClick={download}>{busy === "download" ? "Preparing…" : "Download backup"}</button>
        </div>
        {pass2 && pass !== pass2 && <p className="text-xs text-amber-400">The two passphrases differ.</p>}
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-slate-200">Restore from a backup</h4>
        <p className="text-xs text-slate-500">This replaces ALL of YoSched&apos;s data and settings, including logins, with the file&apos;s contents. What is here now is saved on the server first. For an automatic backup, also choose its key file and enter the key&apos;s passphrase.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="file" accept=".yosched-backup" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); }} disabled={busy !== null} />
          <div className="flex items-center gap-1 text-xs text-slate-400">Key file (automatic backups only):
            <KeyFilePicker file={keyFile} onChange={(f) => { setKeyFile(f); setSummary(null); }} disabled={busy !== null} />
          </div>
          <input type="password" autoComplete="off" placeholder="The file's passphrase" className={INPUT} value={rpass} onChange={(e) => { setRpass(e.target.value); setSummary(null); }} disabled={busy !== null} />
          <button type="button" className={BTN} disabled={busy !== null || !file || !rpass} onClick={check}>{busy === "check" ? "Checking…" : "Check file"}</button>
        </div>
        {summary && (
          <div className="rounded border border-slate-700 p-3 space-y-2">
            <p>Backup made {lastBackupLabel(summary.createdAt, zone)}{summary.appVersion ? ` by YoSched ${summary.appVersion}` : ""}: {total.toLocaleString()} records, including {summary.counts.staff ?? 0} staff, {summary.counts.users ?? 0} logins and {(summary.counts.assignments ?? 0).toLocaleString()} schedule cells.</p>
            <label className="flex flex-wrap items-center gap-2">
              Type {CONFIRM_WORD} to replace everything:
              <input className={`${INPUT} w-28`} value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy !== null} />
              <button type="button" className={BTN_DANGER} disabled={busy !== null || confirm !== CONFIRM_WORD} onClick={restore}>{busy === "restore" ? "Restoring…" : "Restore"}</button>
            </label>
          </div>
        )}
      </div>

      {note && <p className="text-xs text-emerald-400">{note}</p>}

      <div className="border-t border-slate-700 pt-4">
        <AutoBackupSection onError={onError} />
      </div>
    </div>
  );
}
