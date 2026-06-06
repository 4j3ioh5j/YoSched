import { describe, it, expect } from "vitest";
import { isEmailConfigured, buildConfirmationEmail, type EmailConfig } from "../email";

const base: EmailConfig = {
  enabled: true,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "user",
  password: "pass",
  fromAddress: "scheduler@example.com",
};

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
