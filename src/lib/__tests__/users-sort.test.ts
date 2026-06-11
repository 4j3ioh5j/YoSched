import { describe, it, expect } from "vitest";
import {
  parseUserSort,
  sortUsers,
  SORTABLE_COLUMNS,
  type SortableUser,
  type UserSort,
} from "../users-sort";

function u(p: Partial<SortableUser> & { id: string }): SortableUser {
  return {
    name: p.id,
    email: null,
    group: null,
    staff: null,
    isActive: true,
    loginComplete: true,
    totpEnabled: false,
    ...p,
  };
}

const ids = (rows: SortableUser[]) => rows.map((r) => r.id);

describe("parseUserSort", () => {
  it("accepts every sortable column with both directions", () => {
    for (const column of SORTABLE_COLUMNS) {
      expect(parseUserSort({ column, dir: "asc" })).toEqual({ column, dir: "asc" });
      expect(parseUserSort({ column, dir: "desc" })).toEqual({ column, dir: "desc" });
    }
  });

  it("rejects unknown columns, bad directions, and non-objects", () => {
    expect(parseUserSort({ column: "actions", dir: "asc" })).toBeNull();
    expect(parseUserSort({ column: "name", dir: "sideways" })).toBeNull();
    expect(parseUserSort({ column: "name" })).toBeNull();
    expect(parseUserSort(null)).toBeNull();
    expect(parseUserSort("name")).toBeNull();
    expect(parseUserSort(42)).toBeNull();
    expect(parseUserSort([])).toBeNull();
  });
});

describe("sortUsers — basics", () => {
  it("does not mutate the input array", () => {
    const rows = [u({ id: "b" }), u({ id: "a" })];
    const copy = [...rows];
    sortUsers(rows, { column: "name", dir: "asc" });
    expect(rows).toEqual(copy);
  });

  it("sorts by name asc and desc", () => {
    const rows = [u({ id: "1", name: "Carol" }), u({ id: "2", name: "alice" }), u({ id: "3", name: "Bob" })];
    expect(ids(sortUsers(rows, { column: "name", dir: "asc" }))).toEqual(["2", "3", "1"]);
    expect(ids(sortUsers(rows, { column: "name", dir: "desc" }))).toEqual(["1", "3", "2"]);
  });
});

describe("sortUsers — email (nulls to the end ascending)", () => {
  it("groups missing emails last ascending, first descending", () => {
    const rows = [
      u({ id: "none", email: null }),
      u({ id: "z", email: "zed@x.com" }),
      u({ id: "a", email: "ann@x.com" }),
    ];
    expect(ids(sortUsers(rows, { column: "email", dir: "asc" }))).toEqual(["a", "z", "none"]);
    expect(ids(sortUsers(rows, { column: "email", dir: "desc" }))).toEqual(["none", "z", "a"]);
  });
});

describe("sortUsers — group by hierarchy (level), not name", () => {
  it("orders by group.level, ignoring alphabetical group name", () => {
    const rows = [
      u({ id: "staff", group: { name: "Staff", level: 1 } }),
      u({ id: "admin", group: { name: "Admin", level: 4 } }),
      u({ id: "sched", group: { name: "Scheduler", level: 2 } }),
    ];
    // Ascending level: Staff(1) → Scheduler(2) → Admin(4). Alphabetical would be Admin first.
    expect(ids(sortUsers(rows, { column: "group", dir: "asc" }))).toEqual(["staff", "sched", "admin"]);
    expect(ids(sortUsers(rows, { column: "group", dir: "desc" }))).toEqual(["admin", "sched", "staff"]);
  });
});

describe("sortUsers — staff (nulls to the end ascending)", () => {
  it("sorts by linked staff name, unlinked last ascending", () => {
    const rows = [
      u({ id: "none", staff: null }),
      u({ id: "yo", staff: { name: "Young", initials: "YO" } }),
      u({ id: "ab", staff: { name: "Abbott", initials: "AB" } }),
    ];
    expect(ids(sortUsers(rows, { column: "staff", dir: "asc" }))).toEqual(["ab", "yo", "none"]);
  });
});

describe("sortUsers — status rank (Active > Disabled-complete > Needs setup)", () => {
  const active = u({ id: "active", isActive: true, loginComplete: true });
  const disabled = u({ id: "disabled", isActive: false, loginComplete: true });
  const needsSetup = u({ id: "needs", isActive: false, loginComplete: false });

  it("ranks the three distinct states, not just isActive", () => {
    const rows = [needsSetup, active, disabled];
    // Ascending: needs setup (0) → disabled (1) → active (2).
    expect(ids(sortUsers(rows, { column: "status", dir: "asc" }))).toEqual(["needs", "disabled", "active"]);
    expect(ids(sortUsers(rows, { column: "status", dir: "desc" }))).toEqual(["active", "disabled", "needs"]);
  });
});

describe("sortUsers — 2FA", () => {
  it("sorts off before on ascending", () => {
    const rows = [u({ id: "on", totpEnabled: true }), u({ id: "off", totpEnabled: false })];
    expect(ids(sortUsers(rows, { column: "totp", dir: "asc" }))).toEqual(["off", "on"]);
    expect(ids(sortUsers(rows, { column: "totp", dir: "desc" }))).toEqual(["on", "off"]);
  });
});

describe("sortUsers — stable, deterministic tiebreak", () => {
  it("breaks equal keys by name then id, independent of direction", () => {
    // All same group level → tie on the primary key; resolve by name, then id.
    const g = { name: "Staff", level: 1 };
    const rows = [
      u({ id: "id3", name: "Same", group: g }),
      u({ id: "id1", name: "Same", group: g }),
      u({ id: "id2", name: "Same", group: g }),
    ];
    // Tiebreak is always ascending (name equal → id asc) regardless of dir.
    expect(ids(sortUsers(rows, { column: "group", dir: "asc" }))).toEqual(["id1", "id2", "id3"]);
    expect(ids(sortUsers(rows, { column: "group", dir: "desc" }))).toEqual(["id1", "id2", "id3"]);
  });

  it("orders equal-primary rows by name before id", () => {
    const g = { name: "Staff", level: 1 };
    const rows = [
      u({ id: "x", name: "Zoe", group: g }),
      u({ id: "y", name: "Ana", group: g }),
    ];
    expect(ids(sortUsers(rows, { column: "group", dir: "asc" }))).toEqual(["y", "x"]);
  });
});

// Type-level sanity: UserSort is what parse returns.
const _sample: UserSort = { column: "name", dir: "asc" };
void _sample;
