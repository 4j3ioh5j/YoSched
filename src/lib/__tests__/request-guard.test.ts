import { describe, it, expect } from "vitest";
import { createRequestGuard } from "../request-guard";

// Deferred-response scenarios for the /users "Generate password" action.
describe("createRequestGuard", () => {
  it("regression: Generate for Alice, close, open Bob, Alice's response arrives late → ignored", () => {
    const g = createRequestGuard();
    g.invalidate("alice"); // open Alice's editor
    const t = g.begin(); // Generate (request in flight)
    g.invalidate(null); // Cancel
    g.invalidate("bob"); // open Bob's editor
    expect(g.isCurrent(t)).toBe(false); // Alice's password must not show in Bob's form
  });
  it("close and reopen the SAME user while in flight → still ignored (a new editor session)", () => {
    const g = createRequestGuard();
    g.invalidate("alice");
    const t = g.begin();
    g.invalidate(null);
    g.invalidate("alice");
    expect(g.isCurrent(t)).toBe(false);
  });
  it("two clicks: only the latest response applies", () => {
    const g = createRequestGuard();
    g.invalidate("alice");
    const first = g.begin();
    const second = g.begin();
    expect(g.isCurrent(first)).toBe(false);
    expect(g.isCurrent(second)).toBe(true);
  });
  it("no change → applies", () => {
    const g = createRequestGuard();
    g.invalidate("alice");
    expect(g.isCurrent(g.begin())).toBe(true);
  });
});
