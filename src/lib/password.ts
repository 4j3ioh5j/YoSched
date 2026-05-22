const RULES = [
  { test: (p: string) => p.length >= 8, message: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), message: "One uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), message: "One lowercase letter" },
  { test: (p: string) => /\d/.test(p), message: "One number" },
];

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors = RULES.filter((r) => !r.test(password)).map((r) => r.message);
  return { valid: errors.length === 0, errors };
}

export const PASSWORD_RULES = RULES.map((r) => r.message);
