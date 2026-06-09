import { describe, it, expect } from "vitest";
import { isEmailConfigured, buildConfirmationEmail, normalizeOptionalEmail, type EmailConfig } from "../email";

const base: EmailConfig = {
  enabled: true,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "user",
  password: "pass",
  fromAddress: "scheduler@example.com",
};

describe("normalizeOptionalEmail", () => {
  const ok = (r: ReturnType<typeof normalizeOptionalEmail>) => (r.ok ? r.value : `ERR:${(r as { error: string }).error}`);

  it("null/undefined/empty/whitespace → null (email is optional)", () => {
    expect(ok(normalizeOptionalEmail(null))).toBeNull();
    expect(ok(normalizeOptionalEmail(undefined))).toBeNull();
    expect(ok(normalizeOptionalEmail(""))).toBeNull();
    expect(ok(normalizeOptionalEmail("   "))).toBeNull();
  });

  it("trims and lowercases a valid address", () => {
    expect(ok(normalizeOptionalEmail("  Jane.Doe@Hospital.ORG  "))).toBe("jane.doe@hospital.org");
  });

  it("accepts plus-tags and subdomains", () => {
    expect(ok(normalizeOptionalEmail("a+b@mail.sub.example.io"))).toBe("a+b@mail.sub.example.io");
  });

  it("rejects malformed values", () => {
    for (const bad of ["nope", "no@domain", "@example.com", "a@b.c d", "two@@at.com", "trailing@dot."]) {
      const r = normalizeOptionalEmail(bad);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects non-string input", () => {
    const r = normalizeOptionalEmail(42);
    expect(r.ok).toBe(false);
  });
});

describe("isEmailConfigured", () => {
  it("true when enabled with host, port, and from-address", () => {
    expect(isEmailConfigured(base)).toBe(true);
  });
  it("auth is optional (relay without username)", () => {
    expect(isEmailConfigured({ ...base, username: null, password: null })).toBe(true);
  });
  it("false when disabled", () => {
    expect(isEmailConfigured({ ...base, enabled: false })).toBe(false);
  });
  it("false when missing host or from-address or port", () => {
    expect(isEmailConfigured({ ...base, host: null })).toBe(false);
    expect(isEmailConfigured({ ...base, fromAddress: null })).toBe(false);
    expect(isEmailConfigured({ ...base, port: 0 })).toBe(false);
  });
  it("false for null/undefined", () => {
    expect(isEmailConfigured(null)).toBe(false);
    expect(isEmailConfigured(undefined)).toBe(false);
  });
});

describe("buildConfirmationEmail", () => {
  const msg = buildConfirmationEmail({
    providerName: "Dr. Smith",
    requestDescription: "Off",
    dateRange: "July 3, 2026",
    flexible: false,
    submitted: "June 6, 2026 12:05",
    reference: "req-abc123",
  });

  it("subject names the request and dates", () => {
    expect(msg.subject).toBe("Schedule request received — Off (July 3, 2026)");
  });
  it("body carries the key facts", () => {
    expect(msg.text).toContain("Dr. Smith");
    expect(msg.text).toContain("July 3, 2026");
    expect(msg.text).toContain("June 6, 2026 12:05");
    expect(msg.text).toContain("req-abc123");
    expect(msg.text).toContain("pending");
  });
  it("marks a flexible request as a preference", () => {
    const m = buildConfirmationEmail({
      providerName: "X", requestDescription: "Avoid ORC", dateRange: "July 3, 2026",
      flexible: true, submitted: "June 6, 2026 12:05", reference: "r1",
    });
    expect(m.text).toContain("(preference)");
  });
});
