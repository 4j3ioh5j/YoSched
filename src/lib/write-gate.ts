import { AsyncLocalStorage } from "node:async_hooks";

// Card #314: the write fence. YoSched runs as ONE Node process, so a readers–writer gate in
// memory is enough to keep a backup or restore from seeing — or being followed by — half of
// an application save. Every route handler holds the gate SHARED for its whole run (all its
// transactions and post-commit work); backup and restore hold it EXCLUSIVE, after every
// in-flight handler has finished. The Prisma client refuses any write made outside a holder
// (src/lib/prisma.ts), so a writer that skips the gate fails loudly instead of slipping past.

export class GateBusyError extends Error {
  constructor() { super("YoSched is busy with a backup or restore — try again in a minute"); this.name = "GateBusyError"; }
}
export class GateDrainTimeoutError extends Error {
  constructor() { super("Another long operation (for example an auto-schedule run) is still going — try again in a minute. Nothing was read or changed."); this.name = "GateDrainTimeoutError"; }
}
export class GateMissingError extends Error {
  constructor(what: string) { super(`Write outside the write gate: ${what}`); this.name = "GateMissingError"; }
}

type Mode = "shared" | "exclusive";
export type GateOptions = { sharedWaitMs?: number; drainMs?: number };

export function createWriteGate(opts: GateOptions = {}) {
  const sharedWaitMs = opts.sharedWaitMs ?? 120_000;
  const drainMs = opts.drainMs ?? 60_000;
  const als = new AsyncLocalStorage<Mode>();
  let active = 0; // shared holders running
  let exclusiveHeld = false;
  let pending = 0; // exclusives waiting (writer preference: new shared holders queue behind them)
  let exclusiveQueue: Promise<void> = Promise.resolve(); // serializes exclusives
  let waiters: Array<() => void> = [];

  const notify = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  /** Wait until `ready()` holds, re-checking on every state change; false on timeout. */
  function waitUntil(ready: () => boolean, ms: number): Promise<boolean> {
    if (ready()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
      const check = () => {
        if (done) return;
        if (ready()) { done = true; clearTimeout(timer); resolve(true); } else waiters.push(check);
      };
      waiters.push(check);
    });
  }

  async function shared<T>(fn: () => Promise<T>): Promise<T> {
    if (als.getStore()) return fn();
    const ok = await waitUntil(() => !exclusiveHeld && pending === 0, sharedWaitMs);
    if (!ok) throw new GateBusyError();
    active++;
    try {
      return await als.run("shared", fn);
    } finally {
      active--;
      notify();
    }
  }

  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const held = als.getStore();
    if (held === "exclusive") return fn();
    if (held === "shared") throw new GateMissingError("an exclusive operation requested inside a request that holds the gate");
    pending++;
    let release!: () => void;
    const prev = exclusiveQueue;
    exclusiveQueue = new Promise<void>((r) => { release = r; });
    try {
      await prev;
      const drained = await waitUntil(() => active === 0, drainMs);
      if (!drained) throw new GateDrainTimeoutError();
      exclusiveHeld = true;
    } catch (e) {
      pending--;
      release();
      notify();
      throw e;
    }
    pending--;
    try {
      return await als.run("exclusive", fn);
    } finally {
      exclusiveHeld = false;
      release();
      notify();
    }
  }

  function requireToken(what: string): void {
    if (!als.getStore()) throw new GateMissingError(what);
  }

  /** Wrap a route handler: it holds the gate shared for its whole run. */
  function gated<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
    return async (...args: A) => {
      try {
        return await shared(() => handler(...args));
      } catch (e) {
        if (e instanceof GateBusyError || e instanceof GateDrainTimeoutError) {
          return new Response(JSON.stringify({ error: e.message, busy: true }), { status: 503, headers: { "content-type": "application/json", "retry-after": "60" } });
        }
        throw e;
      }
    };
  }

  return { shared, exclusive, requireToken, gated, holding: () => als.getStore() ?? null };
}

// One gate per process. Next.js loads separate module copies for routes, pages and
// instrumentation, so the instance lives on globalThis (card 266 lesson).
const g = globalThis as unknown as { __yoschedWriteGate?: ReturnType<typeof createWriteGate> };
export const writeGate = g.__yoschedWriteGate ?? (g.__yoschedWriteGate = createWriteGate());
export const gated = writeGate.gated;

/** Backup and restore routes: the handler does NOT hold the gate shared (it takes it
 *  exclusively inside, via src/lib/backup/service.ts); a busy gate becomes a 503. */
export function exclusiveRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof GateBusyError || e instanceof GateDrainTimeoutError) {
        return new Response(JSON.stringify({ error: e.message, busy: true }), { status: 503, headers: { "content-type": "application/json", "retry-after": "60" } });
      }
      throw e;
    }
  };
}

/** NextAuth's { GET, POST } pair, each holding the gate. */
export function gatedHandlers<H extends { GET: (req: never) => Promise<Response>; POST: (req: never) => Promise<Response> }>(h: H): H {
  return { ...h, GET: gated(h.GET as (...a: unknown[]) => Promise<Response>), POST: gated(h.POST as (...a: unknown[]) => Promise<Response>) } as H;
}
