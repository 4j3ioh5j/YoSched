"use client";

import { formatClock, zoneLabel } from "@/lib/time-zone";
import { useEffect, useRef, useState } from "react";
import { KeyFilePicker } from "./key-file-picker";
import { TIME_ZONE_EVENT } from "@/app/time-zone-provider";

// Card #315: Settings › Backup and Restore › Automatic backups. A daily backup written to a
// folder on the server, locked with a key whose key file the admin keeps elsewhere.

const MIN_PASS = 12;
const BTN = "px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white";
const BTN_QUIET = "px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-white";
const INPUT = "bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 disabled:opacity-50";

export type AutoView = {
  enabled: boolean;
  autoTime: string;
  /** Card #320: the stored zone (sent back as zoneAtLoad) and the zone in use (UTC while none is chosen). */
  storedZone: string | null;
  zone: string;
  keepDaily: number; keepWeekly: number; keepMonthly: number; keepSafety: number;
  key: { keyId: string; createdAt: string | null; verifiedAt: string | null } | null;
  pendingKey: { keyId: string; createdAt: string | null } | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  health: string | null;
  folder: string;
  autoFiles: number;
  keyFilesInFolder: string[];
  folderError: string | null;
};

type Form = { autoTime: string; keepDaily: string; keepWeekly: string; keepMonthly: string; keepSafety: string };
const formOf = (v: AutoView): Form => ({ autoTime: v.autoTime, keepDaily: String(v.keepDaily), keepWeekly: String(v.keepWeekly), keepMonthly: String(v.keepMonthly), keepSafety: String(v.keepSafety) });

// Card #320: in the Settings time zone, with its label.
function stamp(iso: string | null, zone: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: zone })} ${formatClock(d, zone)}`;
}
const day = (iso: string | null, zone: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: zone }) : "");

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `The server answered ${res.status}`;
}

export function AutoBackupSection({ onError }: { onError: (e: string | undefined) => void }) {
  const [view, setView] = useState<AutoView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<null | "save" | "toggle" | "key" | "verify">(null);
  const [note, setNote] = useState<string | null>(null);
  const [kpass, setKpass] = useState("");
  const [kpass2, setKpass2] = useState("");
  const [vfile, setVfile] = useState<File | null>(null);
  const [vpass, setVpass] = useState("");
  const alive = useRef(true);

  const adopt = (v: AutoView) => { if (!alive.current) return; setView(v); setForm(formOf(v)); };
  useEffect(() => {
    alive.current = true;
    fetch("/api/backup/auto", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as AutoView) : Promise.reject(await errorOf(res))))
      .then(adopt)
      .catch((e: unknown) => { if (alive.current) onError(typeof e === "string" ? e : "Could not reach the server"); });
    return () => { alive.current = false; };
  }, [onError]);

  const fail = (e: string) => { onError(e); setNote(null); };
  const reload = async () => {
    const res = await fetch("/api/backup/auto", { cache: "no-store" });
    if (res.ok) adopt((await res.json()) as AutoView);
  };

  // Card #320: a zone saved elsewhere in Settings converts the backup time; show the new one.
  useEffect(() => {
    const on = () => { void reload(); };
    window.addEventListener(TIME_ZONE_EVENT, on);
    return () => window.removeEventListener(TIME_ZONE_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function put(body: unknown, kind: "save" | "toggle") {
    setBusy(kind); onError(undefined); setNote(null);
    try {
      const res = await fetch("/api/backup/auto", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { fail(await errorOf(res)); if (res.status === 409) await reload(); return; }
      adopt((await res.json()) as AutoView);
    } finally { if (alive.current) setBusy(null); }
  }

  async function makeKey() {
    setBusy("key"); onError(undefined); setNote(null);
    try {
      const res = await fetch("/api/backup/auto/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: kpass }) });
      if (!res.ok) return fail(await errorOf(res));
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "YoSched key.yosched-key";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setKpass(""); setKpass2("");
      setNote(`The key file "${name}" was downloaded. Now check it below: choose that file and enter its passphrase.`);
      await reload();
    } finally { if (alive.current) setBusy(null); }
  }

  async function verify() {
    if (!vfile) return;
    setBusy("verify"); onError(undefined); setNote(null);
    try {
      const fd = new FormData();
      fd.set("keyfile", vfile); fd.set("passphrase", vpass);
      const res = await fetch("/api/backup/auto/verify", { method: "POST", body: fd });
      if (!res.ok) { fail(await errorOf(res)); if (res.status === 409) await reload(); return; }
      adopt((await res.json()) as AutoView);
      setVfile(null); setVpass("");
      setNote("The key file works. Automatic backups are on.");
    } finally { if (alive.current) setBusy(null); }
  }

  if (!view || !form) return <p className="text-sm text-slate-500">Loading…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(view));
  const kpassOk = kpass.length >= MIN_PASS && kpass === kpass2;
  const canEnable = !!view.key?.verifiedAt;
  const field = (k: keyof Form, label: string, w = "w-16") => (
    <label className="flex items-center gap-2">
      <input className={`${INPUT} ${w}`} inputMode="numeric" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} disabled={busy !== null} />
      {label}
    </label>
  );

  return (
    <div className="space-y-3 text-sm text-slate-300">
      <h4 className="font-medium text-slate-200">Automatic backups</h4>
      <p className="text-xs text-slate-500">
        Once a day YoSched saves a backup of everything into a folder on this server. Each one is locked with a key: it can only be
        opened with the key file and its passphrase, which you keep. Copy the backup folder to another computer or drive regularly,
        so a broken server doesn&apos;t take the backups with it.
      </p>

      {view.keyFilesInFolder.length > 0 && (
        <p className="rounded border border-red-600 bg-red-950/40 p-2 text-red-300">
          A key file is in the backup folder ({view.keyFilesInFolder.join(", ")}). Anyone with that folder and the passphrase could open every
          backup. Move the key file somewhere else, away from this server.
        </p>
      )}
      {view.health && <p className="text-amber-400">{view.health}.</p>}
      {view.folderError && <p className="text-amber-400">{view.folderError}.</p>}

      <div className="space-y-1">
        <p>Automatic backups are <span className={view.enabled ? "text-emerald-400" : "text-slate-200"}>{view.enabled ? "on" : "off"}</span>
          {view.enabled ? `, every day at ${view.autoTime} ${zoneLabel(new Date(), view.zone)}.` : "."}</p>
        <p>Last automatic backup: {stamp(view.lastSuccessAt, view.zone)}{view.lastError && view.lastAttemptAt ? `; last try ${stamp(view.lastAttemptAt, view.zone)} failed` : ""}.</p>
        <p>Folder on the server: <span className="font-mono text-xs text-slate-200">{view.folder}</span> ({view.autoFiles} automatic {view.autoFiles === 1 ? "backup" : "backups"} kept).</p>
        <p>Key: {view.key ? `made ${day(view.key.createdAt, view.zone)} (${view.key.keyId})` : "none yet"}.</p>
        <div className="flex gap-2 pt-1">
          {view.enabled
            ? <button type="button" className={BTN_QUIET} disabled={busy !== null} onClick={() => put({ enabled: false }, "toggle")}>Switch off</button>
            : <button type="button" className={BTN} disabled={busy !== null || !canEnable} onClick={() => put({ enabled: true }, "toggle")}>Switch on</button>}
        </div>
      </div>

      <div className="space-y-2">
        <h5 className="font-medium text-slate-200">{view.key ? "Make a new key" : "Make the key"}</h5>
        <p className="text-xs text-slate-500">
          You get a key file to download. Keep it, and its passphrase, away from this server and never in the backup folder. Also save a
          copy of the key file and the passphrase in your password manager. Without both, the automatic backups can&apos;t be opened, and
          nobody, including YoSched, can recover them.
          {view.key ? " Keep the old key file too, until the automatic backups made with it have been removed (they are kept for up to " + view.keepMonthly + " months)." : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <input type="password" autoComplete="new-password" placeholder="Key passphrase" className={INPUT} value={kpass} onChange={(e) => setKpass(e.target.value)} disabled={busy !== null} />
          <input type="password" autoComplete="new-password" placeholder="Key passphrase again" className={INPUT} value={kpass2} onChange={(e) => setKpass2(e.target.value)} disabled={busy !== null} />
          <button type="button" className={BTN} disabled={busy !== null || !kpassOk} onClick={makeKey}>{busy === "key" ? "Making…" : "Make key file"}</button>
        </div>
        {kpass2 && kpass !== kpass2 && <p className="text-xs text-amber-400">The two passphrases differ.</p>}
        {kpass && kpass.length < MIN_PASS && <p className="text-xs text-slate-500">At least {MIN_PASS} characters.</p>}
      </div>

      {view.pendingKey && (
        <div className="space-y-2 rounded border border-slate-700 p-3">
          <h5 className="font-medium text-slate-200">Check the new key ({view.pendingKey.keyId})</h5>
          <p className="text-xs text-slate-500">
            Choose the key file you just downloaded and enter its passphrase. YoSched locks a test backup with the new key and opens it
            with your file. Only then does the new key take over{view.key ? "" : " and automatic backups switch on"}. The file is not kept on the server.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <KeyFilePicker file={vfile} onChange={setVfile} disabled={busy !== null} />
            <input type="password" autoComplete="off" placeholder="Key passphrase" className={INPUT} value={vpass} onChange={(e) => setVpass(e.target.value)} disabled={busy !== null} />
            <button type="button" className={BTN} disabled={busy !== null || !vfile || !vpass} onClick={verify}>{busy === "verify" ? "Checking…" : "Check key file"}</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h5 className="font-medium text-slate-200">When, and how many to keep</h5>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex items-center gap-2">Every day at
            <input className={`${INPUT} w-20`} placeholder="01:00" value={form.autoTime} onChange={(e) => setForm({ ...form, autoTime: e.target.value })} disabled={busy !== null} />
            <span data-zone-label>{zoneLabel(new Date(), view.zone)}</span> (24-hour clock)
          </label>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {field("keepDaily", "daily")}
          {field("keepWeekly", "weekly")}
          {field("keepMonthly", "monthly")}
          {field("keepSafety", "copies made before a restore")}
        </div>
        <p className="text-xs text-slate-500">The newest backup is always kept. Backups you download yourself are never removed.</p>
        <button
          type="button" className={BTN} disabled={busy !== null || !dirty}
          onClick={() => put({ zoneAtLoad: view.storedZone, autoTime: form.autoTime.trim(), keepDaily: Number(form.keepDaily), keepWeekly: Number(form.keepWeekly), keepMonthly: Number(form.keepMonthly), keepSafety: Number(form.keepSafety) }, "save")}
        >{busy === "save" ? "Saving…" : "Save"}</button>
      </div>

      {note && <p className="text-xs text-emerald-400">{note}</p>}
    </div>
  );
}
