import { describe, it, expect } from "vitest";
import {
  DEFAULT_STAFF_ORDER,
  orderStaff,
  parseStaffOrderCriteria,
  staffAlphaKey,
  validateStaffOrderCriteria,
  type OrderableStaff,
} from "../staff-order";

const FTE = { sortOrder: 0 };
const FEE_BASIS = { sortOrder: 1 };

let seq = 0;
function s(over: Partial<OrderableStaff> & { initials: string }): OrderableStaff {
  seq++;
  return {
    id: over.id ?? `id-${seq}`,
    name: over.name ?? over.initials,
    ftePercentage: 1,
    isAutoScheduled: true,
    sortOrder: seq,
    createdAt: new Date(2026, 0, seq),
    employmentType: FTE,
    ...over,
  };
}

function order(staff: OrderableStaff[], criteria = DEFAULT_STAFF_ORDER): string[] {
  return orderStaff(staff, criteria).map((p) => p.initials);
}

describe("staffAlphaKey", () => {
  it("uses the last word of a real name", () => {
    expect(staffAlphaKey("David Hendleman", "DH")).toBe("Hendleman");
    expect(staffAlphaKey("Mary Jo Van Dorn", "MVD")).toBe("Dorn");
  });

  it("falls back to initials minus the first letter when name is just initials", () => {
    expect(staffAlphaKey("ADh", "ADh")).toBe("Dh");
    expect(staffAlphaKey("KZ", "KZ")).toBe("Z");
  });

  it("falls back to the whole initials when they are a single letter", () => {
    expect(staffAlphaKey("Q", "Q")).toBe("Q");
  });

  it("treats a spaced name identical to initials as no last name", () => {
    expect(staffAlphaKey(" ADh ", "ADh")).toBe("Dh");
  });
});

describe("orderStaff — default stack", () => {
  it("groups FTE employment type before Fee Basis", () => {
    const staff = [
      s({ initials: "NH", employmentType: FEE_BASIS, ftePercentage: 0 }),
      s({ initials: "YA", employmentType: FTE, ftePercentage: 1 }),
      s({ initials: "DB", employmentType: FEE_BASIS, ftePercentage: 0 }),
      s({ initials: "CC", employmentType: FTE, ftePercentage: 0.6 }),
    ];
    expect(order(staff)).toEqual(["YA", "CC", "DB", "NH"]);
  });

  it("sorts FTE percentage descending within a group", () => {
    const staff = [
      s({ initials: "AR", ftePercentage: 0.3 }),
      s({ initials: "BC", ftePercentage: 1 }),
      s({ initials: "SH", ftePercentage: 0.8 }),
      s({ initials: "CC", ftePercentage: 0.6 }),
    ];
    expect(order(staff)).toEqual(["BC", "SH", "CC", "AR"]);
  });

  it("mixes real last names and initials-fallback alphabetically within a group", () => {
    const staff = [
      s({ initials: "ST", name: "ST", ftePercentage: 1 }), // key "T"
      s({ initials: "DH", name: "David Hendleman", ftePercentage: 1 }), // key "Hendleman"
      s({ initials: "BR", name: "Ben Rosellini", ftePercentage: 1 }), // key "Rosellini"
      s({ initials: "ADh", name: "ADh", ftePercentage: 1 }), // key "Dh"
    ];
    expect(order(staff)).toEqual(["ADh", "DH", "BR", "ST"]);
  });

  it("places a new 1.0 FTE hire among the other 1.0 FTE staff, not at the end", () => {
    const staff = [
      s({ initials: "YA", ftePercentage: 1, sortOrder: 1 }),
      s({ initials: "CC", ftePercentage: 0.6, sortOrder: 2 }),
      s({ initials: "ST", ftePercentage: 1, sortOrder: 17 }),
      s({ initials: "RMc", name: "RMc", ftePercentage: 1, sortOrder: 39 }), // new hire, key "Mc"
    ];
    expect(order(staff)).toEqual(["YA", "RMc", "ST", "CC"]);
  });
});

describe("orderStaff — other criteria", () => {
  it("respects an explicit direction override", () => {
    const staff = [
      s({ initials: "BC", ftePercentage: 1 }),
      s({ initials: "AR", ftePercentage: 0.3 }),
    ];
    expect(order(staff, [{ key: "ftePercentage", dir: "asc" }])).toEqual(["AR", "BC"]);
  });

  it("autoScheduled puts auto-scheduled staff first by default", () => {
    const staff = [
      s({ initials: "AH", isAutoScheduled: false }),
      s({ initials: "YA", isAutoScheduled: true }),
    ];
    expect(order(staff, [{ key: "autoScheduled" }])).toEqual(["YA", "AH"]);
  });

  it("seniority orders by createdAt ascending by default", () => {
    const staff = [
      s({ initials: "BR", createdAt: "2026-09-09T00:00:00Z" }),
      s({ initials: "YA", createdAt: "2026-05-19T00:00:00Z" }),
    ];
    expect(order(staff, [{ key: "seniority" }])).toEqual(["YA", "BR"]);
  });

  it("manual mode follows Staff.sortOrder", () => {
    const staff = [
      s({ initials: "ZZ", sortOrder: 2 }),
      s({ initials: "AA", sortOrder: 9 }),
      s({ initials: "MM", sortOrder: 1 }),
    ];
    expect(order(staff, [{ key: "manual" }])).toEqual(["MM", "ZZ", "AA"]);
  });

  it("breaks duplicate sortOrder ties deterministically by initials", () => {
    const staff = [
      s({ initials: "KZ", sortOrder: 18 }),
      s({ initials: "CWa", sortOrder: 18 }),
    ];
    expect(order(staff, [{ key: "manual" }])).toEqual(["CWa", "KZ"]);
    expect(order([...staff].reverse(), [{ key: "manual" }])).toEqual(["CWa", "KZ"]);
  });

  it("is fully deterministic when every criterion ties", () => {
    const a = s({ initials: "XX", id: "b" });
    const b = s({ initials: "XX", id: "a" });
    expect(orderStaff([a, b], DEFAULT_STAFF_ORDER).map((p) => p.id)).toEqual(["a", "b"]);
    expect(orderStaff([b, a], DEFAULT_STAFF_ORDER).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("parseStaffOrderCriteria (lenient read)", () => {
  it("falls back to the default stack on null/garbage/empty", () => {
    expect(parseStaffOrderCriteria(null)).toEqual(DEFAULT_STAFF_ORDER);
    expect(parseStaffOrderCriteria("nope")).toEqual(DEFAULT_STAFF_ORDER);
    expect(parseStaffOrderCriteria([])).toEqual(DEFAULT_STAFF_ORDER);
    expect(parseStaffOrderCriteria([{ key: "bogus" }])).toEqual(DEFAULT_STAFF_ORDER);
  });

  it("drops unknown keys, bad dirs, and duplicates but keeps valid entries", () => {
    expect(
      parseStaffOrderCriteria([
        { key: "bogus" },
        { key: "alphabetical", dir: "sideways" },
        { key: "alphabetical" },
        { key: "ftePercentage", dir: "asc" },
      ]),
    ).toEqual([{ key: "alphabetical" }, { key: "ftePercentage", dir: "asc" }]);
  });

  it("collapses any config containing manual to manual-only", () => {
    expect(parseStaffOrderCriteria([{ key: "alphabetical" }, { key: "manual" }])).toEqual([
      { key: "manual" },
    ]);
  });
});

describe("validateStaffOrderCriteria (strict write)", () => {
  it("accepts a valid stack", () => {
    expect(
      validateStaffOrderCriteria([{ key: "employmentType" }, { key: "ftePercentage", dir: "desc" }]),
    ).toEqual({ value: [{ key: "employmentType" }, { key: "ftePercentage", dir: "desc" }] });
  });

  it("accepts manual alone but rejects manual mixed with others", () => {
    expect(validateStaffOrderCriteria([{ key: "manual" }])).toEqual({ value: [{ key: "manual" }] });
    expect(
      validateStaffOrderCriteria([{ key: "manual" }, { key: "alphabetical" }]),
    ).toHaveProperty("error");
  });

  it("rejects empty, unknown keys, duplicates, and bad dirs", () => {
    expect(validateStaffOrderCriteria([])).toHaveProperty("error");
    expect(validateStaffOrderCriteria([{ key: "bogus" }])).toHaveProperty("error");
    expect(
      validateStaffOrderCriteria([{ key: "initials" }, { key: "initials" }]),
    ).toHaveProperty("error");
    expect(validateStaffOrderCriteria([{ key: "initials", dir: "up" }])).toHaveProperty("error");
  });
});
