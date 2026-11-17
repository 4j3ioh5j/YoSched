import { autoDue, autoFileName, planPrune, type AutoSettings, type AutoStatus } from "./auto";
import { BackupFileError, type PublicKeyInfo } from "./format";

// Card #315: the automatic backup job and its scheduler. Pure over injected dependencies
// (src/lib/backup/auto-service.ts wires them to the database and the backup folder).
//
// Order (state before side effect; nothing published that a restore would refuse):
//   take the gate exclusively → reread settings + status (the key comes ONLY from this read) →
//   not due: stop → record the attempt → build + validate → encode (restore limits) →
//   write the file whole → record the success → prune old automatic files.
// Any failure before the write leaves no file and prunes nothing.

export type AutoState = { settings: AutoSettings; status: AutoStatus };
export type JobDeps = {
  now(): Date;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  readState(): Promise<AutoState>;
  recordAttempt(at: Date): Promise<void>;
  buildPayload(): Promise<unknown>;
  encode(payload: unknown, key: PublicKeyInfo): Promise<Buffer>;
  write(name: string, bytes: Buffer): Promise<void>;
  recordSuccess(at: Date): Promise<void>;
  recordFailure(at: Date, error: string): Promise<void>;
  list(): Promise<string[]>;
  remove(names: string[]): Promise<void>;
  cleanPartials(): Promise<void>;
  log(msg: string): void;
};
export type RunResult = "ok" | "not-due" | "failed" | "busy";

function reason(e: unknown): string {
  if (e instanceof BackupFileError) return e.message;
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code && /^E[A-Z]+$/.test(code)) return `the backup folder can't be written (${code})`;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 300);
}

/** One run. Call only via autoTick (single flight) or a test. */
export async function runAutoBackup(deps: JobDeps): Promise<RunResult> {
  return deps.exclusive(async () => {
    const at = deps.now();
    const { settings, status } = await deps.readState();
    if (!autoDue(at, settings, status)) return "not-due";
    await deps.recordAttempt(at);
    try {
      const key: PublicKeyInfo = { publicKey: settings.publicKey!, keyId: settings.keyId!, keyCreatedAt: (settings.keyCreatedAt ?? at).toISOString() };
      const bytes = await deps.encode(await deps.buildPayload(), key);
      await deps.cleanPartials();
      await deps.write(autoFileName(at), bytes);
      await deps.recordSuccess(at);
    } catch (e) {
      const why = reason(e);
      deps.log(`[backup] automatic backup failed: ${why}`);
      await deps.recordFailure(at, why);
      return "failed";
    }
    try {
      const old = planPrune(await deps.list(), settings, autoFileName(at));
      if (old.length) await deps.remove(old);
    } catch (e) {
      const why = `the backup was made, but older automatic backups couldn't be removed (${reason(e)})`;
      deps.log(`[backup] ${why}`);
      await deps.recordFailure(at, why);
    }
    deps.log(`[backup] automatic backup written: ${autoFileName(at)}`);
    return "ok";
  });
}

// One scheduler per process: Next.js loads separate module copies for instrumentation and routes
// (card 266 lesson), so the state lives on globalThis.
type SchedulerState = { running: Promise<RunResult> | null; timers: ReturnType<typeof setTimeout>[]; started: boolean };
const KEY = Symbol.for("yosched.autoBackup");
export function schedulerState(): SchedulerState {
  const g = globalThis as unknown as Record<symbol, SchedulerState | undefined>;
  return (g[KEY] ??= { running: null, timers: [], started: false });
}

/** A cheap check outside the gate; only a due run takes it. One run at a time. */
export async function autoTick(deps: JobDeps): Promise<RunResult> {
  const st = schedulerState();
  if (st.running) return "busy";
  const run = (async (): Promise<RunResult> => {
    try {
      const { settings, status } = await deps.readState();
      if (!autoDue(deps.now(), settings, status)) return "not-due";
      return await runAutoBackup(deps);
    } catch (e) {
      // The gate was busy or the database unreachable: nothing could be recorded. The next tick tries again.
      deps.log(`[backup] automatic backup check failed: ${reason(e)}`);
      return "failed";
    }
  })();
  st.running = run;
  try { return await run; } finally { st.running = null; }
}

export const FIRST_TICK_MS = 60_000;
export const TICK_MS = 10 * 60_000;

/** Start the scheduler once per process. Returns false if it was already running. */
export function startAutoBackup(makeDeps: () => JobDeps, opts: { firstMs?: number; everyMs?: number } = {}): boolean {
  const st = schedulerState();
  if (st.started) return false;
  st.started = true;
  const tick = () => { void autoTick(makeDeps()); };
  const first = setTimeout(tick, opts.firstMs ?? FIRST_TICK_MS);
  const every = setInterval(tick, opts.everyMs ?? TICK_MS);
  first.unref?.(); every.unref?.();
  st.timers.push(first, every);
  return true;
}

/** Tests only. */
export function stopAutoBackup(): void {
  const st = schedulerState();
  for (const t of st.timers) { clearTimeout(t); clearInterval(t); }
  st.timers = []; st.started = false; st.running = null;
}
