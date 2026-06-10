// Pure planner for the one-time "give every active staff member a login" backfill.
// Kept free of Prisma so the selection rules are unit-tested; the script
// (prisma/backfill-staff-logins.ts) does the thin DB I/O around it.

export type StaffForBackfill = { id: string; name: string; isActive: boolean };

/** The shell User to create for a staff member with no login yet: disabled, no
 *  credential, default to the Staff group. The admin completes email+password and
 *  activates later (see docs/staff-users-linking-plan.md). */
export type ShellUserSpec = {
  staffId: string;
  name: string;
  email: null;
  passwordHash: null;
  isActive: false;
  groupId: string;
};

/** Decide which staff need a shell login. Idempotent: a staff already backing a login
 *  (its id in `linkedStaffIds`) is skipped, so re-running creates nothing new. Inactive
 *  staff are excluded — only active staff get provisioned. Every shell is placed in the
 *  Staff group (groupId is required — the caller must resolve it first). */
export function planStaffLoginShells(
  staff: StaffForBackfill[],
  linkedStaffIds: Set<string>,
  staffGroupId: string,
): ShellUserSpec[] {
  return staff
    .filter((s) => s.isActive && !linkedStaffIds.has(s.id))
    .map((s) => ({
      staffId: s.id,
      name: s.name,
      email: null,
      passwordHash: null,
      isActive: false,
      groupId: staffGroupId,
    }));
}
