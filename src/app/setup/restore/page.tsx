"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyFilePicker } from "@/app/settings/key-file-picker";

// Card #314: first-run restore on an empty install. Needs the one-time setup code that
// YoSched wrote on the server; the person doing the reinstall passes it on.
const INPUT = "w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100";

export default function FirstRunRestorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState("");
  const [keyFile, setKeyFile] = useState<File | null>(null); // card #315
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    // The code goes in a request header, which only carries plain characters; the real one is letters, digits, - and _.
    if (!/^[A-Za-z0-9_-]+$/.test(code.trim())) { setError("That setup code isn't right"); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file); fd.set("passphrase", pass);
      if (keyFile) fd.set("keyfile", keyFile);
      const res = await fetch("/api/backup/initial", { method: "POST", body: fd, headers: { "x-setup-code": code.trim() } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(res.status === 404 ? "This YoSched already has accounts. Sign in and use Settings › Backup and Restore." : body?.error ?? `The server answered ${res.status}`);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-950 text-slate-200">
      <div className="w-full max-w-md mx-4 space-y-4">
        <h1 className="text-2xl font-bold">Restore YoSched from a backup</h1>
        {done ? (
          <p className="text-emerald-400">Restored. <Link href="/login" className="underline">Sign in</Link> with an account from the backup.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3 text-sm">
            <p className="text-slate-400">This YoSched has no data yet. Choose a backup file, enter its passphrase and the setup code from the server.</p>
            <input type="file" accept=".yosched-backup" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
            <div className="space-y-1 text-slate-400">Key file (only for an automatic backup):
              <KeyFilePicker file={keyFile} onChange={setKeyFile} disabled={busy} />
            </div>
            <input type="password" autoComplete="off" placeholder="The file's passphrase (or the key's, for an automatic backup)" className={INPUT} value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
            <input autoComplete="off" placeholder="Setup code" className={INPUT} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
            {error && <p className="text-red-400">{error}</p>}
            <button type="submit" disabled={busy || !file || !pass || !code} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white">{busy ? "Restoring…" : "Restore"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
