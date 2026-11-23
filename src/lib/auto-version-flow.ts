import { monthsNeedingVersion, type AutoVersionMode, type EnsureMonth, type YearMonth } from "@/lib/auto-version";

// Card #312: the browser side of "Print / Export save a version first". Everything the
// output depends on is FROZEN at the click (month, cells' hash, export input); the
// server call then checks those exact cells; and Print re-checks, after the wait, that
// the screen still shows the frozen month and cells (Codex, card 312 plan: navigating or
// editing during the wait must never print other cells under the returned number).

export type VersionMeta = { year: number; month: number; versionNumber: number; comment: string | null; snapshotHash: string; savedAt: string };
export type EnsureOutcome = { ok: true; versions: VersionMeta[] } | { ok: false; message: string | null };

const key = (y: number, m: number) => `${y}-${m}`;

export const STALE_MESSAGE = "The schedule changed on the server (another user, or an edit still saving). Reload and try again.";
export const MOVED_MESSAGE = "The schedule on screen changed while its version was being saved, so nothing was printed. Press Print again.";

/** POST /api/versions/ensure for the months that need it. message null = nothing to say. */
export async function postEnsure(
  fetchFn: typeof fetch,
  url: string,
  kind: "print" | "export",
  comment: string,
  months: EnsureMonth[],
): Promise<EnsureOutcome> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, comment, months }) });
  } catch {
    return { ok: false, message: "Could not reach the server to save the version. Nothing was printed or exported." };
  }
  const body = (await res.json().catch(() => null)) as { versions?: { year: number; month: number; versionNumber: number; comment: string | null; snapshotHash: string; createdAt: string }[]; reason?: string; error?: string } | null;
  if (res.ok && Array.isArray(body?.versions)) {
    return {
      ok: true,
      versions: body.versions.map((v) => ({ year: v.year, month: v.month, versionNumber: v.versionNumber, comment: v.comment, snapshotHash: v.snapshotHash, savedAt: v.createdAt })),
    };
  }
  if (res.status === 409 && body?.reason === "stale") return { ok: false, message: STALE_MESSAGE };
  return { ok: false, message: body?.error ?? "Could not save the version. Nothing was printed or exported." };
}

export type PrintFlowEnv = {
  mode: AutoVersionMode;
  /** Frozen at the click: the month on screen and its cells' hash. */
  frozen: { year: number; month: number; hash: string };
  currentOf: (y: number, m: number) => { snapshotHash: string; versionNumber: number } | null;
  confirm: (text: string) => boolean;
  ensure: (months: EnsureMonth[]) => Promise<EnsureOutcome>;
  /** Read AFTER the wait: what the screen shows now; null once the grid is gone (another page). */
  showing: () => { year: number; month: number; hash: string; live: boolean } | null;
  adopt: (versions: VersionMeta[]) => void;
  stamp: (versionNumber: number) => void;
  /** Card #476: may be async (build and print the month's PDF); the flow waits for it. */
  print: () => unknown;
  alert: (text: string) => void;
};

/** Print with a version that holds exactly the printed cells. Returns what happened. */
export async function runPrintFlow(env: PrintFlowEnv): Promise<"printed" | "cancelled" | "failed" | "moved" | "gone"> {
  const { year, month, hash } = env.frozen;
  const need = monthsNeedingVersion([{ year, month }], () => hash, env.currentOf);
  if (need.length > 0) {
    if (env.mode === "ask" && !env.confirm("This month has changes that are not in a saved version. Save a new version and print?")) return "cancelled";
    const out = await env.ensure(need);
    if (!out.ok) {
      if (out.message) env.alert(out.message);
      return "failed";
    }
    env.adopt(out.versions);
  }
  const now = env.showing();
  // Codex r1: the grid unmounted (user went to another page) → print nothing, say nothing;
  // a Live sandbox shows other cells under the same saved hash → never print it.
  if (!now) return "gone";
  if (now.live || now.year !== year || now.month !== month || now.hash !== hash) {
    env.alert(MOVED_MESSAGE);
    return "moved";
  }
  const v = env.currentOf(year, month);
  if (!v || v.snapshotHash !== hash) {
    env.alert(MOVED_MESSAGE);
    return "moved";
  }
  env.stamp(v.versionNumber);
  await env.print();
  return "printed";
}

export type ExportPrep<T> = { ok: true; input: T } | { ok: false; message: string | null };

/**
 * Year export: `months` carries the hashes of the SAME frozen cells as `input` (both
 * taken at the click, before any wait). Versions from the server are applied to that
 * frozen input only; later edits on screen cannot reach the file.
 */
export async function prepareYearExport<T extends { versions: readonly { year: number; month: number; versionNumber: number }[] }>(env: {
  mode: AutoVersionMode;
  input: T;
  months: (YearMonth & { hash: string })[];
  currentOf: (y: number, m: number) => { snapshotHash: string } | null;
  confirm: (text: string) => boolean;
  ensure: (months: EnsureMonth[]) => Promise<EnsureOutcome>;
}): Promise<ExportPrep<T>> {
  const hashes = new Map(env.months.map((m) => [key(m.year, m.month), m.hash]));
  const need = monthsNeedingVersion(env.months, (y, m) => hashes.get(key(y, m))!, env.currentOf);
  if (need.length === 0) return { ok: true, input: env.input };
  const n = need.length;
  if (env.mode === "ask" && !env.confirm(`${n} month${n === 1 ? " has" : "s have"} changes that are not in a saved version. Save new versions and export?`)) {
    return { ok: false, message: null };
  }
  const out = await env.ensure(need);
  if (!out.ok) return { ok: false, message: out.message ?? "Could not save the versions. Nothing was exported." };
  const byMonth = new Map(env.input.versions.map((v) => [key(v.year, v.month), v]));
  for (const v of out.versions) byMonth.set(key(v.year, v.month), { year: v.year, month: v.month, versionNumber: v.versionNumber });
  return { ok: true, input: { ...env.input, versions: [...byMonth.values()] } };
}

/** Wrap an async action so a second call while one is running is ignored (returns null). */
export function exclusive<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R | null> {
  let running = false;
  return async (...a: A) => {
    if (running) return null;
    running = true;
    try {
      return await fn(...a);
    } finally {
      running = false;
    }
  };
}
