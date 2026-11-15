// Card #220: a hard staff remove keeps a snapshot of everything it deletes, and Undo restores the
// same person from it (same id, every cascaded row with its id, other people's "when X works"
// rules that named them, their real login's link).
//
// Why the locks (Codex #1017): a snapshot is only complete if nothing else can add or change the
// person's rows between the read and the delete. In ONE transaction, in this order:
//   1. the eligibility lock and the per-person rules lock (the writers that take them);
//   2. the staff row FOR UPDATE — every insert of a row pointing at this person, and every update
//      that re-points a row to them, takes FOR KEY SHARE on it and so waits for us (and then fails
//      its foreign key once the delete commits);
//   3. the assignment check, after that lock (a person with shifts is deactivated instead);
//   4. every child row FOR UPDATE — an update already underway finishes first and we read its
//      result; one that starts later waits and then finds the row gone.
// Only then the snapshot is written and the row deleted.
import { Prisma } from "@/generated/prisma/client";
import { lockEligibility } from "@/lib/eligibility-write";
import { lockStaffRules } from "@/lib/staff-rule-versions";
import { detachLoginForStaff } from "@/lib/user-lifecycle";

type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

/** The tables the staff delete cascades to: snapshot key → table, Prisma delegate. */
const CHILDREN = [
  { key: "eligibleShifts", table: "staff_eligible_shifts", delegate: "staffEligibleShift" },
  { key: "availabilityRules", table: "availability_rules", delegate: "availabilityRule" },
  { key: "shiftEligibilityRules", table: "shift_eligibility_rules", delegate: "shiftEligibilityRule" },
  { key: "shiftMinimumTargets", table: "shift_minimum_targets", delegate: "shiftMinimumTarget" },
  { key: "standingCommitments", table: "standing_commitments", delegate: "standingCommitment" },
  { key: "shiftOverrides", table: "staff_shift_overrides", delegate: "staffShiftOverride" },
  { key: "dayPreferences", table: "staff_day_preferences", delegate: "staffDayPreference" },
  { key: "scheduleRequests", table: "schedule_requests", delegate: "scheduleRequest" },
] as const;

type ChildKey = (typeof CHILDREN)[number]["key"];
export type RemovalSnapshot = {
  version: 1;
  /** Absent on rows written before card #223: those are removes. */
  kind?: "removed";
  staff: Row;
  conditionedRuleIds: string[];
  loginUserId: string | null;
} & Record<ChildKey, Row[]>;

type Delegate = { findMany(a: { where: Row }): Promise<Row[]>; createMany(a: { data: Row[] }): Promise<unknown> };
const delegateOf = (tx: Tx, name: string) => (tx as unknown as Record<string, Delegate>)[name];

/** Explicit bounds for the remove/restore transaction (it waits on other writers' locks). */
export const REMOVAL_TX = { maxWait: 10_000, timeout: 30_000 } as const;

async function lockRows(tx: Tx, table: string, column: string, value: string): Promise<Row[]> {
  return tx.$queryRaw<Row[]>(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE ${Prisma.raw(`"${column}"`)} = ${value} FOR UPDATE`);
}

/** Dates become ISO strings, as they will be stored in the JSON column. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export type RemoveResult = { kind: "missing" } | { kind: "deactivated"; deactivationId: string | null } | { kind: "deleted"; removalId: string };

/** Card #223: what a deactivation unlinked — the one real login Undo may link back, once. */
export type DeactivationSnapshot = { version: 1; kind: "deactivated"; loginUserId: string };

/**
 * Card #223: unlink the person's login as a deactivation does (a shell login is deleted, a real
 * one only unlinked) and, for a real login, record it so Undo can link exactly it back. Call
 * inside the deactivating transaction, after its locks. Returns the record's id, or null.
 */
export async function detachForDeactivation(tx: Tx, id: string): Promise<string | null> {
  const logins = await lockRows(tx, "users", "staffId", id);
  await detachLoginForStaff(id, tx);
  const loginId = logins[0]?.id as string | undefined;
  if (!loginId || !(await tx.user.findUnique({ where: { id: loginId }, select: { id: true } }))) return null;
  const snapshot: DeactivationSnapshot = { version: 1, kind: "deactivated", loginUserId: loginId };
  const r = await tx.staffRemoval.create({ data: { staffId: id, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
  return r.id;
}

export async function removeStaff(tx: Tx, id: string): Promise<RemoveResult> {
  await lockEligibility(tx);
  await lockStaffRules(tx, id);
  if ((await lockRows(tx, "staff", "id", id)).length === 0) return { kind: "missing" };

  if ((await tx.assignment.count({ where: { staffId: id } })) > 0) {
    // History exists: deactivate + remove the login link, as before (now under the lock).
    await tx.staff.update({ where: { id }, data: { isActive: false } });
    return { kind: "deactivated", deactivationId: await detachForDeactivation(tx, id) };
  }

  for (const c of CHILDREN) await lockRows(tx, c.table, "staffId", id);
  const conditioned = await lockRows(tx, "availability_rules", "conditionStaffId", id);
  const logins = await lockRows(tx, "users", "staffId", id);

  const staff = await tx.staff.findUnique({ where: { id } });
  const snapshot = { version: 1, kind: "removed", staff: plain(staff) as Row, conditionedRuleIds: conditioned.map((r) => String(r.id)), loginUserId: null } as RemovalSnapshot;
  for (const c of CHILDREN) snapshot[c.key] = plain(await delegateOf(tx, c.delegate).findMany({ where: { staffId: id } }));

  // A shell login (never completed) is deleted, a real one only unlinked (logins are created on
  // demand, so only a real login is re-linked on restore).
  await detachLoginForStaff(id, tx);
  const loginId = logins[0]?.id as string | undefined;
  if (loginId && (await tx.user.findUnique({ where: { id: loginId }, select: { id: true } }))) snapshot.loginUserId = loginId;

  const removal = await tx.staffRemoval.create({ data: { staffId: id, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
  await tx.staff.delete({ where: { id } });
  return { kind: "deleted", removalId: removal.id };
}

export class RestoreRefused extends Error {}

/**
 * Undo a remove (bring the person back from their snapshot) or a deactivation (card #223:
 * re-activate, and link back the real login it unlinked where that is still free). Returns the
 * person's id. Throws RestoreRefused.
 */
export async function restoreStaff(tx: Tx, removalId: string): Promise<string> {
  const first = await tx.staffRemoval.findUnique({ where: { id: removalId } });
  if (!first) throw new RestoreRefused("This can't be undone any more: there is nothing saved to bring back.");
  await lockEligibility(tx);
  await lockStaffRules(tx, first.staffId);
  const present = (await lockRows(tx, "staff", "id", first.staffId)).length > 0;
  await lockRows(tx, "staff_removals", "id", removalId);
  const removal = await tx.staffRemoval.findUnique({ where: { id: removalId } });
  if (!removal || removal.restoredAt) throw new RestoreRefused("This has already been undone.");
  const id = removal.staffId;
  const kind = (removal.snapshot as { kind?: unknown } | null)?.kind;
  if (kind === "deactivated") {
    if (!present) throw new RestoreRefused("This can't be undone any more: the person has been removed since.");
    const d = removal.snapshot as unknown as DeactivationSnapshot;
    await tx.staff.update({ where: { id }, data: { isActive: true } });
    // Their login only if it still exists, is still unlinked, and they have no other login.
    if (!(await tx.user.findUnique({ where: { staffId: id }, select: { id: true } }))) {
      await tx.user.updateMany({ where: { id: d.loginUserId, staffId: null }, data: { staffId: id } });
    }
    await tx.staffRemoval.update({ where: { id: removalId }, data: { restoredAt: new Date() } });
    return id;
  }
  const snap = removal.snapshot as unknown as RemovalSnapshot;
  if (present) throw new RestoreRefused("This can't be undone any more: the person is already back.");
  const initials = String(snap.staff.initials);
  if (await tx.staff.findUnique({ where: { initials } })) throw new RestoreRefused(`This can't be undone any more: the initials ${initials} are now used by someone else.`);

  await tx.staff.create({ data: snap.staff as Prisma.StaffUncheckedCreateInput });
  for (const c of CHILDREN) {
    const rows = snap[c.key] ?? [];
    if (rows.length > 0) await delegateOf(tx, c.delegate).createMany({ data: rows });
  }
  // Other people's rules that named them: only where the rule still exists and still names nobody.
  if (snap.conditionedRuleIds.length > 0) {
    await tx.availabilityRule.updateMany({ where: { id: { in: snap.conditionedRuleIds }, conditionStaffId: null }, data: { conditionStaffId: id } });
  }
  // Their real login: only if it still exists and nobody else has it.
  if (snap.loginUserId) await tx.user.updateMany({ where: { id: snap.loginUserId, staffId: null }, data: { staffId: id } });
  await tx.staffRemoval.update({ where: { id: removalId }, data: { restoredAt: new Date() } });
  return id;
}

/** A Prisma foreign-key (P2003) or unique (P2002) failure: something the restore needs is gone or taken. */
export function isRestoreConflict(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "P2003" || code === "P2002";
}
