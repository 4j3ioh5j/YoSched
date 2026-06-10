// Single source of truth for the app's permission catalog: each permission's key,
// human label, and category (the categories mirror the nav tabs and drive the
// Groups & Permissions editor). The server-side group-save validator, the seed,
// and the editor UI all derive from here so the lists can never drift apart — a
// key present in the UI/seed but missing from the API validator would let a save
// produce a permission the API then rejects (the CR #578 regression).
//
// `Permission` is a type-only import, so this module pulls in NO runtime server
// dependencies (auth-guard imports next/prisma) — safe for the client bundle, the
// prisma seed (tsx), and unit tests alike.
import type { Permission } from "./auth-guard";

export type PermissionCategory =
  | "Schedule"
  | "My Requests"
  | "Requests"
  | "Staff"
  | "Statistics"
  | "Settings"
  | "Users"
  | "Groups";

export const PERMISSION_CATALOG: { key: Permission; label: string; category: PermissionCategory }[] = [
  { key: "schedule:view", label: "View Schedule", category: "Schedule" },
  { key: "schedule:edit", label: "Edit Schedule", category: "Schedule" },
  { key: "schedule:auto", label: "Auto-Scheduler", category: "Schedule" },
  { key: "requests:self", label: "Submit Own Requests", category: "My Requests" },
  { key: "requests:view", label: "View All Requests", category: "Requests" },
  { key: "staff:view", label: "View Staff", category: "Staff" },
  { key: "staff:edit", label: "Edit Staff", category: "Staff" },
  { key: "statistics:view", label: "View Statistics", category: "Statistics" },
  { key: "statistics:manage", label: "Manage Statistics Views", category: "Statistics" },
  { key: "settings:view", label: "View Settings", category: "Settings" },
  { key: "settings:edit", label: "Edit Settings", category: "Settings" },
  { key: "users:view", label: "View Users", category: "Users" },
  { key: "users:edit", label: "Edit Users", category: "Users" },
  { key: "groups:view", label: "View Groups", category: "Groups" },
  { key: "groups:edit", label: "Edit Groups", category: "Groups" },
];

// Category render order for the editor (mirrors the nav tabs).
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  "Schedule",
  "My Requests",
  "Requests",
  "Staff",
  "Statistics",
  "Settings",
  "Users",
  "Groups",
];

// Just the keys — for server-side validation and seeding.
export const PERMISSION_KEYS: Permission[] = PERMISSION_CATALOG.map((p) => p.key);
