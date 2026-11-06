// In-memory Prisma stand-in for the assignment WRITE paths (src/lib/day-cap-db.ts
// callers). It models what the real database does for them:
//   - the per-date advisory lock (`$executeRaw` of pg_advisory_xact_lock) as a per-key
//     FIFO mutex held until the transaction settles, so two transactions on one date
//     really serialise here and two on different dates really overlap;
//   - every statement yields to the event loop, so an UNPROTECTED read-then-write
//     interleaves exactly as the production race did (set `lockEnabled = false` to
//     watch the overfill happen — the tests do, to prove they would catch it);
//   - rollback: writes inside a transaction are undone in reverse when it throws;
//   - `log`: every statement in order, tagged `t<txId>:`, so a test can assert the lock
//     is the FIRST statement and the reads and writes follow it in the same transaction.
// Not a general Prisma emulator: it supports the `where` shapes those routes use.

export type FakeRow = {
  id: string; staffId: string; date: Date; shiftTypeId: string; isLocked: boolean; source: string;
  autoMonth: string | null; autoShiftTypeId: string | null; notes: string | null; updatedBy: string | null;
  createdAt: Date; updatedAt: Date;
};
export type FakeShift = { id: string; code: string; color: string | null; isOffShift: boolean };
export type FakeRule = { shiftTypeId: string; dayKey: string; maxCount: number | null };
export type FakeVersion = {
  id: string; year: number; month: number; versionNumber: number; comment: string | null; snapshot: unknown;
  snapshotHash: string; isAutoBackup: boolean; isCurrent: boolean; createdAt: Date;
};
/** A schedule_requests row (the fields the approval paths read and write). */
export type FakeRequest = {
  id: string; staffId: string; startDate: Date; endDate: Date; kind: string; shiftTypeIds: string[];
  leaveShiftTypeId: string | null; offStrategyOrder: string[]; strength: string; status: string; autoApproved: boolean;
  source: string; receivedAt: Date; approvedAt: Date | null; approvedBy: string | null; notes: string | null;
  flaggedAt: Date | null; flaggedReason: string | null;
};
export type FakePayPeriod = { id: string; startDate: Date; endDate: Date; targetHours: number };
export type FakePrefs = Record<string, unknown> & { id: string };

export const ymd = (d: Date): string => d.toISOString().slice(0, 10);
export const at = (date: string): Date => new Date(date + "T00:00:00Z");
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export const db = {
  rows: [] as FakeRow[],
  shifts: [] as FakeShift[],
  rules: [] as FakeRule[],
  holidays: [] as string[],
  versions: [] as FakeVersion[],
  requests: [] as FakeRequest[],
  payPeriods: [] as FakePayPeriod[],
  prefs: null as FakePrefs | null,
  minTargets: [] as Record<string, unknown>[],
  deptTargets: [] as Record<string, unknown>[],
  users: [{ id: "u1", name: "Pat" }] as { id: string; name: string }[],
  seq: 0,
  txSeq: 0,
  log: [] as string[],
  txOpts: [] as unknown[],
  lockEnabled: true,
  failTxWith: null as unknown,
  afterLock: null as null | ((key: string, txId: number) => void),
  requestSyncThrows: false,
  reset() {
    this.rows = []; this.shifts = []; this.rules = []; this.holidays = []; this.versions = [];
    this.requests = []; this.payPeriods = []; this.prefs = null; this.minTargets = []; this.deptTargets = [];
    this.users = [{ id: "u1", name: "Pat" }];
    this.seq = 0; this.txSeq = 0; this.log = []; this.txOpts = [];
    this.lockEnabled = true; this.failTxWith = null; this.afterLock = null; this.requestSyncThrows = false;
    locks.clear();
  },
  /** The rows of one shift on one date, by staff, sorted — what the cap counts. */
  holders(shiftTypeId: string, date: string): string[] {
    return this.rows.filter((r) => r.shiftTypeId === shiftTypeId && ymd(r.date) === date).map((r) => r.staffId).sort();
  },
  seed(rows: { staffId: string; date: string; shiftTypeId: string; isLocked?: boolean; source?: string }[]) {
    for (const r of rows) this.rows.push(mkRow({ staffId: r.staffId, date: at(r.date), shiftTypeId: r.shiftTypeId, isLocked: r.isLocked ?? false, source: r.source ?? "manual" }));
  },
  seedRequest(r: Omit<Partial<FakeRequest>, "startDate" | "endDate"> & { id: string; staffId: string; startDate: string; endDate: string; kind: string }): FakeRequest {
    const row: FakeRequest = {
      shiftTypeIds: [], leaveShiftTypeId: null, offStrategyOrder: [], strength: "hard", status: "pending", autoApproved: false,
      source: "scheduler", receivedAt: new Date("2026-11-01T00:00:00Z"), approvedAt: null, approvedBy: null, notes: null,
      flaggedAt: null, flaggedReason: null,
      ...r, startDate: at(r.startDate), endDate: at(r.endDate),
    };
    this.requests.push(row);
    return row;
  },
};

function mkRow(data: Partial<FakeRow> & { staffId: string; date: Date; shiftTypeId: string }): FakeRow {
  const now = new Date();
  return {
    id: `a${++db.seq}`, isLocked: false, source: "manual", autoMonth: null, autoShiftTypeId: null, notes: null,
    updatedBy: null, createdAt: now, updatedAt: now, ...data,
  };
}

// ── where matching (the subset the routes use) ──
type Op = { in?: unknown[]; not?: unknown; notIn?: unknown[]; gte?: unknown; gt?: unknown; lt?: unknown; lte?: unknown };
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
function matchField(v: unknown, cond: unknown): boolean {
  if (cond === null || cond === undefined || typeof cond !== "object" || cond instanceof Date) return same(v, cond);
  const op = cond as Op;
  if ("in" in op && op.in) return op.in.some((x) => same(v, x));
  if ("notIn" in op && op.notIn) return !op.notIn.some((x) => same(v, x));
  if ("not" in op) return !same(v, op.not);
  let ok = true;
  const n = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
  if (op.gte !== undefined) ok &&= n(v) >= n(op.gte);
  if (op.gt !== undefined) ok &&= n(v) > n(op.gt);
  if (op.lt !== undefined) ok &&= n(v) < n(op.lt);
  if (op.lte !== undefined) ok &&= n(v) <= n(op.lte);
  return ok;
}
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") { if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(cond as Record<string, unknown>[]).every((w) => matches(row, w))) return false; continue; }
    if (k === "NOT") { if (matches(row, cond as Record<string, unknown>)) return false; continue; }
    if (!matchField(row[k], cond)) return false;
  }
  return true;
}
const byKey = (w: { staffId_date: { staffId: string; date: Date } }) =>
  db.rows.find((r) => r.staffId === w.staffId_date.staffId && same(r.date, w.staffId_date.date));
const withShift = (r: FakeRow, include?: { shiftType?: boolean }) =>
  include?.shiftType ? { ...r, shiftType: db.shifts.find((s) => s.id === r.shiftTypeId) ?? { id: r.shiftTypeId, code: "?", color: null, isOffShift: false } } : { ...r };

// ── per-key FIFO mutex = pg_advisory_xact_lock ──
const locks = new Map<string, Promise<void>>();
async function acquire(key: string): Promise<() => void> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  locks.set(key, prev.then(() => mine));
  await prev;
  return release;
}

type Undo = () => void;

function makeClient(tag: string, undo: Undo[] | null) {
  const log = (s: string) => db.log.push(`${tag}${s}`);
  const assignment = {
    findUnique: async (a: { where: { staffId_date: { staffId: string; date: Date } }; include?: { shiftType?: boolean } }) => {
      log("assignment.findUnique"); await tick();
      const r = byKey(a.where); return r ? withShift(r, a.include) : null;
    },
    findMany: async (a?: { where?: Record<string, unknown>; include?: { shiftType?: boolean } }) => {
      log("assignment.findMany"); await tick();
      return db.rows.filter((r) => matches(r as unknown as Record<string, unknown>, a?.where)).map((r) => withShift(r, a?.include));
    },
    count: async (a?: { where?: Record<string, unknown> }) => {
      log("assignment.count"); await tick();
      return db.rows.filter((r) => matches(r as unknown as Record<string, unknown>, a?.where)).length;
    },
    upsert: async (a: { where: { staffId_date: { staffId: string; date: Date } }; update: Partial<FakeRow>; create: Partial<FakeRow> & { staffId: string; date: Date; shiftTypeId: string }; include?: { shiftType?: boolean } }) => {
      log("assignment.upsert"); await tick();
      const r = byKey(a.where);
      if (r) {
        const before = { ...r };
        Object.assign(r, a.update, { updatedAt: new Date() });
        undo?.push(() => Object.assign(r, before));
        return withShift(r, a.include);
      }
      const created = mkRow(a.create);
      db.rows.push(created);
      undo?.push(() => { db.rows = db.rows.filter((x) => x !== created); });
      return withShift(created, a.include);
    },
    create: async (a: { data: Partial<FakeRow> & { staffId: string; date: Date; shiftTypeId: string }; include?: { shiftType?: boolean } }) => {
      log("assignment.create"); await tick();
      if (byKey({ staffId_date: { staffId: a.data.staffId, date: a.data.date } })) throw Object.assign(new Error("Unique constraint failed on staffId_date"), { code: "P2002" });
      const created = mkRow(a.data);
      db.rows.push(created);
      undo?.push(() => { db.rows = db.rows.filter((x) => x !== created); });
      return withShift(created, a.include);
    },
    createMany: async (a: { data: (Partial<FakeRow> & { staffId: string; date: Date; shiftTypeId: string })[] }) => {
      log("assignment.createMany"); await tick();
      const created = a.data.map((d) => mkRow(d));
      db.rows.push(...created);
      undo?.push(() => { db.rows = db.rows.filter((x) => !created.includes(x)); });
      return { count: created.length };
    },
    delete: async (a: { where: { id: string } }) => {
      log("assignment.delete"); await tick();
      const r = db.rows.find((x) => x.id === a.where.id);
      if (!r) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
      db.rows = db.rows.filter((x) => x !== r);
      undo?.push(() => { db.rows.push(r); });
      return { ...r };
    },
    deleteMany: async (a?: { where?: Record<string, unknown> }) => {
      log("assignment.deleteMany"); await tick();
      const gone = db.rows.filter((r) => matches(r as unknown as Record<string, unknown>, a?.where));
      db.rows = db.rows.filter((r) => !gone.includes(r));
      undo?.push(() => { db.rows.push(...gone); });
      return { count: gone.length };
    },
  };
  const shiftType = {
    findMany: async (a?: { where?: Record<string, unknown> }) => { log("shiftType.findMany"); return db.shifts.filter((s) => matches(s as unknown as Record<string, unknown>, a?.where)).map((s) => ({ ...s })); },
    findUnique: async (a: { where: { id: string } }) => { log("shiftType.findUnique"); const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    findFirst: async (a?: { where?: Record<string, unknown> }) => { log("shiftType.findFirst"); const s = db.shifts.find((x) => matches(x as unknown as Record<string, unknown>, a?.where)); return s ? { ...s } : null; },
  };
  const staffingRequirement = {
    findMany: async (a?: { where?: Record<string, unknown> }) => { log("staffingRequirement.findMany"); return db.rules.filter((r) => matches(r as unknown as Record<string, unknown>, a?.where)).map((r) => ({ ...r })); },
  };
  const holiday = {
    findMany: async (a?: { where?: { date?: { in: Date[] } } }) => {
      log("holiday.findMany");
      const wanted = a?.where?.date?.in?.map(ymd);
      return db.holidays.filter((h) => !wanted || wanted.includes(h)).map((h) => ({ date: at(h) }));
    },
  };
  const scheduleRequest = {
    findMany: async (a?: { where?: Record<string, unknown> }) => {
      log("scheduleRequest.findMany"); await tick();
      if (db.requestSyncThrows) throw new Error("request sync exploded");
      return db.requests.filter((r) => matches(r as unknown as Record<string, unknown>, a?.where)).map((r) => ({ ...r }));
    },
    findUnique: async (a: { where: { id: string } }) => { log("scheduleRequest.findUnique"); await tick(); const r = db.requests.find((x) => x.id === a.where.id); return r ? { ...r } : null; },
    update: async (a: { where: { id: string }; data: Partial<FakeRequest> }) => {
      log("scheduleRequest.update"); await tick();
      const r = db.requests.find((x) => x.id === a.where.id);
      if (!r) throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
      const before = { ...r };
      Object.assign(r, a.data);
      undo?.push(() => Object.assign(r, before));
      return { ...r };
    },
    create: async (a: { data: Partial<FakeRequest> & { id?: string; staffId: string; startDate: Date; endDate: Date; kind: string } }) => {
      log("scheduleRequest.create"); await tick();
      const row: FakeRequest = {
        id: a.data.id ?? `r${++db.seq}`, shiftTypeIds: [], leaveShiftTypeId: null, offStrategyOrder: [], strength: "hard", status: "pending",
        autoApproved: false, source: "scheduler", receivedAt: new Date(), approvedAt: null, approvedBy: null, notes: null, flaggedAt: null, flaggedReason: null,
        ...a.data,
      } as FakeRequest;
      db.requests.push(row);
      undo?.push(() => { db.requests = db.requests.filter((x) => x !== row); });
      return { ...row };
    },
    delete: async (a: { where: { id: string } }) => {
      log("scheduleRequest.delete"); await tick();
      const r = db.requests.find((x) => x.id === a.where.id);
      if (!r) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
      db.requests = db.requests.filter((x) => x !== r);
      undo?.push(() => { db.requests.push(r); });
      return { ...r };
    },
  };
  const payPeriod = {
    findMany: async () => { log("payPeriod.findMany"); await tick(); return [...db.payPeriods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime()).map((p) => ({ ...p })); },
    deleteMany: async () => { log("payPeriod.deleteMany"); await tick(); const n = db.payPeriods.length; db.payPeriods = []; return { count: n }; },
    createMany: async (a: { data: FakePayPeriod[] }) => { log("payPeriod.createMany"); await tick(); db.payPeriods.push(...a.data); return { count: a.data.length }; },
  };
  const schedulingPreferences = {
    findFirst: async () => { log("schedulingPreferences.findFirst"); await tick(); return db.prefs ? { ...db.prefs } : null; },
    create: async (a: { data: Record<string, unknown> & { id: string } }) => { log("schedulingPreferences.create"); db.prefs = { ...a.data }; return { ...db.prefs }; },
    upsert: async (a: { where: { id: string }; update: Record<string, unknown>; create: Record<string, unknown> & { id: string } }) => {
      log("schedulingPreferences.upsert"); await tick();
      db.prefs = db.prefs ? { ...db.prefs, ...a.update } : { ...a.create };
      return { ...db.prefs };
    },
  };
  const shiftMinimumTarget = { findMany: async () => { log("shiftMinimumTarget.findMany"); return db.minTargets.map((t) => ({ ...t })); } };
  const departmentShiftTarget = { findMany: async () => { log("departmentShiftTarget.findMany"); return db.deptTargets.map((t) => ({ ...t })); } };
  const user = { findMany: async () => { log("user.findMany"); return db.users.map((u) => ({ ...u })); } };
  const scheduleVersion = {
    findUnique: async (a: { where: { id: string } }) => { log("scheduleVersion.findUnique"); const v = db.versions.find((x) => x.id === a.where.id); return v ? { ...v } : null; },
    findMany: async (a?: { where?: Record<string, unknown> }) => { log("scheduleVersion.findMany"); await tick(); return db.versions.filter((v) => matches(v as unknown as Record<string, unknown>, a?.where)).map((v) => ({ ...v })); },
    create: async (a: { data: Omit<FakeVersion, "id" | "createdAt"> & { id?: string } }) => {
      log("scheduleVersion.create"); await tick();
      const v: FakeVersion = { id: a.data.id ?? `v${++db.seq}`, createdAt: new Date(), ...a.data } as FakeVersion;
      db.versions.push(v);
      undo?.push(() => { db.versions = db.versions.filter((x) => x !== v); });
      return { ...v };
    },
    updateMany: async (a: { where: Record<string, unknown>; data: Partial<FakeVersion> }) => {
      log("scheduleVersion.updateMany"); await tick();
      const hit = db.versions.filter((v) => matches(v as unknown as Record<string, unknown>, a.where));
      const befores = hit.map((v) => ({ v, before: { ...v } }));
      for (const v of hit) Object.assign(v, a.data);
      undo?.push(() => { for (const { v, before } of befores) Object.assign(v, before); });
      return { count: hit.length };
    },
    update: async (a: { where: { id: string }; data: Partial<FakeVersion> }) => {
      log("scheduleVersion.update"); await tick();
      const v = db.versions.find((x) => x.id === a.where.id)!;
      const before = { ...v };
      Object.assign(v, a.data);
      undo?.push(() => Object.assign(v, before));
      return { ...v };
    },
  };
  return { assignment, shiftType, staffingRequirement, holiday, scheduleRequest, payPeriod, schedulingPreferences, shiftMinimumTarget, departmentShiftTarget, user, scheduleVersion };
}

export type FakeClient = ReturnType<typeof makeClient>;
export type FakeTx = FakeClient & { $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number> };

/** The `prisma` export the routes import. */
export const prisma = {
  ...makeClient("", null),
  $transaction: async (fnOrOps: ((tx: FakeTx) => Promise<unknown>) | Promise<unknown>[], opts?: unknown) => {
    db.txOpts.push(opts);
    if (db.failTxWith) throw db.failTxWith;
    if (Array.isArray(fnOrOps)) return Promise.all(fnOrOps);
    const txId = ++db.txSeq;
    const undo: Undo[] = [];
    const held: (() => void)[] = [];
    const client = makeClient(`t${txId}:`, undo);
    const tx: FakeTx = {
      ...client,
      $executeRaw: async (strings, ...values) => {
        const sql = strings.join("?");
        if (!/pg_advisory_xact_lock/.test(sql)) throw new Error(`fake-prisma: unexpected raw SQL ${sql}`);
        const key = String(values[1]); // (namespace, hashtext(date)) → the date is the second value
        db.log.push(`t${txId}:lock:${key}`);
        if (db.lockEnabled) held.push(await acquire(key));
        else await tick();
        db.afterLock?.(key, txId);
        return 1;
      },
    };
    try {
      const out = await fnOrOps(tx);
      db.log.push(`t${txId}:commit`);
      return out;
    } catch (e) {
      for (const u of undo.reverse()) u();
      db.log.push(`t${txId}:rollback`);
      throw e;
    } finally {
      for (const release of held) release();
    }
  },
};

/** The statements of one transaction, in order, without the `t<id>:` tag. */
export function txLog(txId: number): string[] {
  const tag = `t${txId}:`;
  return db.log.filter((l) => l.startsWith(tag)).map((l) => l.slice(tag.length));
}
