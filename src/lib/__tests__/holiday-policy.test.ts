import { describe, it, expect } from "vitest";
import { HOLIDAY_POLICIES, DEFAULT_HOLIDAY_POLICY, isHolidayPolicy, parseHolidayPolicy } from "../holiday-policy";

describe("holiday-policy", () => {
  it("defaults to the scheduled-workday entitlement", () => {
    expect(DEFAULT_HOLIDAY_POLICY).toBe("entitlement");
    expect(HOLIDAY_POLICIES).toEqual(["entitlement", "fill", "none"]);
  });

  it("isHolidayPolicy is strict", () => {
    for (const p of HOLIDAY_POLICIES) expect(isHolidayPolicy(p)).toBe(true);
    for (const bad of ["", "Entitlement", "off", "legacy", null, undefined, 1, {}]) expect(isHolidayPolicy(bad)).toBe(false);
  });

  it("parseHolidayPolicy is lenient on reads", () => {
    expect(parseHolidayPolicy("fill")).toBe("fill");
    expect(parseHolidayPolicy("none")).toBe("none");
    expect(parseHolidayPolicy("entitlement")).toBe("entitlement");
    expect(parseHolidayPolicy(undefined)).toBe("entitlement");
    expect(parseHolidayPolicy("bogus")).toBe("entitlement");
  });
});
