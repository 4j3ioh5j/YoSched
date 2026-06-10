import { describe, it, expect } from "vitest";
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  PERMISSION_KEYS,
} from "@/lib/permission-catalog";

// The catalog is the single source consumed by the editor UI, the group-save API
// validator, and the seed. These guards catch the class of bug CR #578 found:
// a permission the UI/seed can produce that the API validator would reject.
describe("permission catalog (single source of truth)", () => {
  it("includes requests:view (regression: CR #578 — API validator had dropped it)", () => {
    expect(PERMISSION_KEYS).toContain("requests:view");
  });

  it("PERMISSION_KEYS mirrors the catalog exactly and in order", () => {
    expect(PERMISSION_KEYS).toEqual(PERMISSION_CATALOG.map((p) => p.key));
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("every catalog entry uses a registered category", () => {
    for (const p of PERMISSION_CATALOG) {
      expect(PERMISSION_CATEGORIES).toContain(p.category);
    }
  });

  it("puts the request permissions under the new request tabs, not Schedule", () => {
    const categoryOf = Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p.category]));
    expect(categoryOf["requests:self"]).toBe("My Requests");
    expect(categoryOf["requests:view"]).toBe("Requests");
  });
});
