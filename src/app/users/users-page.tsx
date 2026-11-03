"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useEscape } from "@/lib/use-escape";
import { formatDate, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { canManageGroupLevel } from "@/lib/permissions";
import { sortUsers, type UserSort, type UserSortColumn } from "@/lib/users-sort";
import { linkOptionsForLogin, type LinkOptionStaff } from "@/lib/staff-login-link";
import { generatePassword, browserRandomInt } from "@/lib/generate-password";
import { createRequestGuard } from "@/lib/request-guard";
import { GroupsSection } from "../settings/groups-section";

type LoginLogEntry = {
  id: string;
  email: string;
  userId: string | null;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type User = {
  id: string;
  email: string | null;
  name: string;
  groupId?: string | null;
  group?: { name: string; level: number } | null;
  staffId?: string | null;
  staff?: { id: string; name: string; initials: string } | null;
  isActive: boolean;
  loginComplete: boolean; // has both email + password (server-derived; gate 3 of activation)
  isShell?: boolean; // has neither email nor password (server-derived; unlinking deletes it)
  mustChangePassword?: boolean; // admin-set/generated password not yet replaced by the person
  totpEnabled?: boolean;
  createdAt: string | Date;
};

type GroupOption = {
  id: string;
  name: string;
  level: number;
};

const GROUP_BADGE: Record<string, string> = {
  Admin: "bg-amber-700 text-amber-100",
  "Super User": "bg-blue-700 text-blue-100",
  Scheduler: "bg-emerald-700 text-emerald-100",
  Staff: "bg-slate-600 text-slate-300",
};

export function UsersPage({
  initialUsers,
  initialSort,
  currentUserId,
  currentGroupLevel,
  groups,
  staff,
  hiddenTakenStaffIds,
  initialCreateStaffId,
  initialEditUserId,
  canEditUsers,
  canViewGroups,
  canEditGroups,
  canEditSettings,
  deviceTrustDays: initialTrustDays,
  dateFormat: dateFormatProp,
}: {
  initialUsers: User[];
  initialSort: UserSort | null;
  currentUserId: string;
  currentGroupLevel: number;
  groups: GroupOption[];
  staff: LinkOptionStaff[];
  hiddenTakenStaffIds: string[];
  initialCreateStaffId: string | null;
  initialEditUserId: string | null;
  canEditUsers: boolean;
  canViewGroups: boolean;
  canEditGroups: boolean;
  canEditSettings: boolean;
  deviceTrustDays: number;
  dateFormat?: string;
}) {
  const dateFormat = (dateFormatProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  // You can assign any group at or below your own level (so an admin can create another
  // admin). Only strictly-higher groups are off-limits — same predicate as the server.
  const assignableGroups = groups.filter((g) => canManageGroupLevel(currentGroupLevel, g.level));
  const defaultGroupId = assignableGroups.find((g) => g.name === "Staff")?.id ?? assignableGroups[0]?.id ?? "";

  function canManageUser(user: User): boolean {
    if (!canEditUsers) return false;
    if (user.id === currentUserId) return false;
    // Every user has a group, so their level is just the group's level.
    const userLevel = user.group?.level ?? 0;
    // At-or-below your level is manageable (peers included); only strictly-higher is not.
    return canManageGroupLevel(currentGroupLevel, userLevel);
  }

  const emptyForm = { email: "", name: "", password: "", confirmPassword: "", groupId: defaultGroupId, staffId: "" };
  // Deep links from the Staff page, read once into the initial state: ?edit=<userId> opens
  // that login's editor; ?create=<staffId> opens New User for that staff member (name
  // prefilled, staff preselected) if it is active and has no login yet.
  const [deepLink] = useState(() => {
    if (!canEditUsers) return null;
    if (initialEditUserId) {
      const u = initialUsers.find((x) => x.id === initialEditUserId);
      if (!u || !canManageUser(u)) return null;
      return {
        editingId: u.id,
        form: { ...emptyForm, email: u.email ?? "", name: u.name, groupId: u.groupId ?? defaultGroupId, staffId: u.staffId ?? "" },
      };
    }
    if (initialCreateStaffId) {
      const st = staff.find((x) => x.id === initialCreateStaffId);
      const taken = new Set([...hiddenTakenStaffIds, ...initialUsers.map((u) => u.staffId).filter(Boolean)]);
      if (!st || !st.isActive || taken.has(st.id)) return null;
      return { editingId: null, form: { ...emptyForm, name: st.name, staffId: st.id } };
    }
    return null;
  });

  const [users, setUsers] = useState(initialUsers);
  const [sort, setSort] = useState<UserSort | null>(initialSort);
  const [showForm, setShowForm] = useState(deepLink !== null);
  const [editingId, setEditingId] = useState<string | null>(deepLink?.editingId ?? null);
  const [form, setForm] = useState(deepLink?.form ?? emptyForm);
  const [error, setError] = useState("");
  // A generated password, shown ONCE in the form until it closes (never stored client-side
  // beyond this state). `saved` = already written to the server (existing login).
  const [generated, setGenerated] = useState<{ password: string; saved: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  // Every open/close/switch of the form invalidates in-flight Generate requests, so a late
  // response can't show one user's password in another user's form.
  const [genGuard] = useState(createRequestGuard);
  // One Generate at a time: overlapping requests could save in reverse order, leaving the
  // server on a password that isn't the one shown.
  const [generating, setGenerating] = useState(false);
  const [trustDays, setTrustDays] = useState(initialTrustDays);
  const [savingTrust, setSavingTrust] = useState(false);

  const resetForm = useCallback(() => {
    setForm({ email: "", name: "", password: "", confirmPassword: "", groupId: defaultGroupId, staffId: "" });
    setShowForm(false);
    setEditingId(null);
    setError("");
    setGenerated(null);
    setCopied(false);
    genGuard.invalidate(null);
  }, [defaultGroupId, genGuard]);

  async function handleGenerate() {
    setError("");
    setCopied(false);
    if (!editingId) {
      // New login: fill both fields; the server hashes it and flags the change on Create.
      const password = generatePassword(browserRandomInt);
      setForm((f) => ({ ...f, password, confirmPassword: password }));
      setGenerated({ password, saved: false });
      return;
    }
    const targetId = editingId;
    const target = users.find((u) => u.id === targetId);
    if (!confirm(`Replace ${target?.name ?? "this user"}'s password with a new generated one now? Their current password stops working.`)) return;
    if (generating) return;
    setGenerating(true);
    const ticket = genGuard.begin();
    let res: Response;
    let body: { password?: string; hasEmail?: boolean; error?: string } = {};
    try {
      res = await fetch("/api/users/generate-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: targetId }),
        cache: "no-store",
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setGenerating(false);
      if (genGuard.isCurrent(ticket)) setError("Could not reach the server. The password may or may not have changed; generate again to be sure.");
      return;
    }
    setGenerating(false);
    if (res.ok) {
      // The server saved it either way: keep the row honest for the TARGET user.
      setUsers((prev) => prev.map((u) => (u.id === targetId
        ? { ...u, mustChangePassword: true, isShell: false, loginComplete: !!body.hasEmail }
        : u)));
    }
    // Only show the result in the form that asked for it (same editor session, latest click).
    if (!genGuard.isCurrent(ticket)) {
      if (res.ok) alert(`A new password was set for ${target?.name ?? "that user"}, but its form was closed, so it isn't shown. Generate again from their form to get one you can copy.`);
      return;
    }
    if (!res.ok) { setError(body.error ?? "Could not generate a password"); return; }
    setGenerated({ password: body.password ?? "", saved: true });
    setCopied(false);
    setForm((f) => ({ ...f, password: "", confirmPassword: "" }));
  }

  async function copyGenerated() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  useEscape(resetForm);

  async function handleSave() {
    setError("");

    if (form.password && form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const endpoint = "/api/users";

    if (editingId) {
      const original = users.find((u) => u.id === editingId);
      const body: Record<string, string | null> = { id: editingId, email: form.email, name: form.name, groupId: form.groupId };
      if (form.password) body.password = form.password;
      const originalStaffId = original?.staffId ?? "";
      if (form.staffId !== originalStaffId) {
        body.staffId = form.staffId || null;
        // Rule 4: unlinking a never-completed login (no email, no password) deletes it —
        // unless this same save gives it an email or a password.
        if (!form.staffId && original?.isShell && !form.email && !form.password) {
          if (!confirm("This empty login (no email, no password) will be deleted when it is unlinked. Continue?")) return;
        }
      }
      const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { setError((await res.json()).error); return; }
      const updated = await res.json();
      if (updated.deleted) setUsers((prev) => prev.filter((u) => u.id !== editingId));
      else setUsers((prev) => prev.map((u) => (u.id === editingId ? updated : u)));
    } else {
      if (!form.password) { setError("Password required for new users"); return; }
      const { staffId, ...rest } = form;
      const payload = staffId ? { ...rest, staffId } : rest;
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { setError((await res.json()).error); return; }
      const created = await res.json();
      setUsers((prev) => [...prev, created]);
    }
    resetForm();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this user?")) return;
    const res = await fetch("/api/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!res.ok) { alert((await res.json()).error); return; }
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  // Staff-linked logins can't be deleted (Rule 5) — unlink them first (Edit → Linked
  // staff → none), or Reset them to a bare shell (disabled, no email, no password).
  async function handleReset(id: string) {
    if (!confirm("Reset this staff login? This disables it and clears the email + password. The staff member stays in the system.")) return;
    const res = await fetch("/api/users/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!res.ok) { alert((await res.json()).error); return; }
    const updated = await res.json();
    setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
  }

  async function handleReset2FA(id: string) {
    if (!confirm("Reset 2FA for this user? They will need to set it up again.")) return;
    const res = await fetch("/api/users/reset-totp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) });
    if (res.ok) setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, totpEnabled: false } : u)));
  }

  async function handleToggleActive(user: User) {
    if (!user.isActive && !user.loginComplete) {
      alert("Set an email and password for this login before activating it.");
      return;
    }
    const res = await fetch("/api/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, isActive: !user.isActive }) });
    if (!res.ok) { alert((await res.json()).error); return; }
    const updated = await res.json();
    setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
  }

  function startEdit(user: User) {
    setForm({ email: user.email ?? "", name: user.name, password: "", confirmPassword: "", groupId: user.groupId ?? defaultGroupId, staffId: user.staffId ?? "" });
    setEditingId(user.id);
    setShowForm(true);
    setGenerated(null);
    setCopied(false);
    genGuard.invalidate(user.id);
  }

  // "Linked staff" choices: active staff with no login, plus this login's own staff member.
  const takenStaffIds = new Set<string>([
    ...hiddenTakenStaffIds,
    ...users.map((u) => u.staffId).filter((x): x is string => !!x),
  ]);
  const editingStaffId = editingId ? users.find((u) => u.id === editingId)?.staffId ?? null : null;
  const staffLinkOptions = linkOptionsForLogin(staff, takenStaffIds, editingStaffId);

  // Deep links are consumed into the initial state above; drop the query afterwards so a
  // reload doesn't reopen the form.
  useEffect(() => {
    if (initialEditUserId || initialCreateStaffId) {
      try { window.history.replaceState(null, "", window.location.pathname); } catch { /* cosmetic only */ }
    }
  }, [initialEditUserId, initialCreateStaffId]);


  // Persist the chosen sort to this login's server-side prefs, debounced so a flurry of
  // header clicks coalesces into a single PUT carrying the final state (avoids a slow
  // earlier save landing after a faster later one).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function handleSort(column: UserSortColumn) {
    const next: UserSort =
      sort?.column === column
        ? { column, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "asc" };
    setSort(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usersTableSort: next }),
      }).catch(() => {}); // best-effort; the sort still applies in-session if the save fails
    }, 400);
  }

  // Apply the active sort for display without disturbing the canonical `users` state
  // (edits/adds/deletes still operate on `users`). No sort → server's createdAt order.
  const displayedUsers = sort ? sortUsers(users, sort) : users;

  function sortHeader(column: UserSortColumn, label: string) {
    const active = sort?.column === column;
    return (
      <th className="py-2.5 px-3 font-medium" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => handleSort(column)}
          className={`group inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-slate-200 ${active ? "text-slate-200" : ""}`}
          title={`Sort by ${label}`}
        >
          {label}
          <span className={`text-[9px] leading-none ${active ? "" : "opacity-0 group-hover:opacity-40"}`}>
            {active ? (sort!.dir === "asc" ? "▲" : "▼") : "▲"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <main className="flex-1 p-6 bg-slate-950 text-slate-100">
      <div className="max-w-screen-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">Users</h1>
          {canEditUsers && !showForm && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Add User
            </button>
          )}
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={resetForm}>
            <div
              className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
            <h2 className="text-sm font-medium text-slate-300">
              {editingId ? "Edit User" : "New User"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                placeholder={editingId ? "New password (leave blank to keep)" : "Password"}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                placeholder="Confirm password"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={form.groupId}
                onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {assignableGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <div className="col-span-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors disabled:opacity-50"
                  title={editingId ? "Set a new random password now (they choose their own at next sign-in)" : "Fill in a random password (they choose their own at first sign-in)"}
                >
                  {generating ? "Generating..." : "Generate password"}
                </button>
                <span className="text-xs text-slate-500">They&#39;ll be asked to choose their own at sign-in.</span>
              </div>
              {generated && (
                <div className="col-span-2 rounded border border-emerald-800 bg-emerald-950/40 p-3 space-y-2">
                  <p className="text-xs text-emerald-300">
                    {generated.saved
                      ? "New password saved. Copy it now — it won't be shown again."
                      : "Password filled in. Copy it now — it's saved when you press Create."}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={generated.password}
                      aria-label="Generated password"
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono text-sm text-slate-100"
                    />
                    <button type="button" onClick={copyGenerated} className="px-2.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors">
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
              <label className="col-span-2 flex items-center gap-2 text-xs text-slate-400">
                <span className="w-24 shrink-0">Linked staff</span>
                <select
                  value={form.staffId}
                  onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                  aria-label="Linked staff"
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— none —</option>
                  {staffLinkOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
              >
                {editingId ? "Save" : "Create"}
              </button>
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            </div>
          </div>
        )}

        <div className="mb-4 px-3 py-2.5 bg-slate-800/40 border border-slate-700/50 rounded flex items-center gap-2 text-xs text-slate-500">
          <span>2FA trusted devices are remembered for</span>
          <input
            type="number"
            min={1}
            max={365}
            value={trustDays}
            onChange={(e) => setTrustDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
            disabled={!canEditSettings}
            className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <span>days before re-prompting.</span>
          {canEditSettings && trustDays !== initialTrustDays && (
            <button
              disabled={savingTrust}
              onClick={async () => {
                setSavingTrust(true);
                const res = await fetch("/api/settings/scheduling-preferences", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ deviceTrustDays: trustDays }),
                });
                if (!res.ok) setTrustDays(initialTrustDays);
                setSavingTrust(false);
              }}
              className="ml-auto px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {savingTrust ? "Saving..." : "Save"}
            </button>
          )}
        </div>

        <table className="w-full text-sm table-fixed">
          {/* Proportional widths summing to 100% so no column balloons on the wide
              page (an unconstrained Email col used to absorb all slack, leaving a
              huge gap before Group). Staff gets extra room for "Name (INITIALS)". */}
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[24%]" />
            <col className="w-[12%]" />
            <col className="w-[20%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800 text-xs uppercase tracking-wider">
              {sortHeader("name", "Name")}
              {sortHeader("email", "Email")}
              {sortHeader("group", "Group")}
              {sortHeader("staff", "Staff")}
              {sortHeader("status", "Status")}
              {sortHeader("totp", "2FA")}
              <th className="py-2.5 px-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {displayedUsers.map((user) => {
              const gName = user.group?.name ?? "";
              const manageable = canManageUser(user);
              return (
                <tr key={user.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${!user.isActive ? "opacity-50" : ""}`}>
                  <td className="py-2.5 px-3 truncate">
                    {user.name}
                    {user.mustChangePassword && (
                      <span
                        title="Using a password set by an administrator; they must choose their own at next sign-in"
                        className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-400"
                      >
                        temp password
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 truncate">{user.email ?? <span className="italic text-slate-600">no email</span>}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block w-[88px] text-center text-xs py-0.5 rounded ${GROUP_BADGE[gName] || "bg-slate-600 text-slate-300"}`}>
                      {gName}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 truncate">
                    {user.staff ? (
                      <span title={user.staff.name}>{user.staff.name} <span className="text-slate-500">({user.staff.initials})</span></span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {manageable ? (
                      !user.isActive && !user.loginComplete ? (
                        <span
                          title="Set an email and password (Edit) before this login can be activated"
                          className="inline-block w-[76px] text-center text-xs py-0.5 rounded bg-amber-900/40 text-amber-400 cursor-help"
                        >
                          Needs setup
                        </span>
                      ) : (
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={`inline-block w-[60px] text-center text-xs py-0.5 rounded transition-colors ${user.isActive ? "bg-green-800/50 text-green-300 hover:bg-green-800/80" : "bg-red-900/50 text-red-400 hover:bg-red-900/80"}`}
                        >
                          {user.isActive ? "Active" : "Disabled"}
                        </button>
                      )
                    ) : (
                      <span className={`inline-block w-[60px] text-center text-xs py-0.5 rounded ${user.isActive ? "bg-green-800/50 text-green-300" : "bg-red-900/50 text-red-400"}`}>
                        {user.isActive ? "Active" : "Disabled"}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {user.totpEnabled ? (
                      <span className="inline-block w-[32px] text-center text-xs py-0.5 rounded bg-green-800/50 text-green-300">On</span>
                    ) : (
                      <span className="inline-block w-[32px] text-center text-xs py-0.5 text-slate-600">Off</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    {manageable && user.totpEnabled && (
                      <button
                        onClick={() => handleReset2FA(user.id)}
                        className="text-xs text-amber-500/60 hover:text-amber-400 mr-2"
                      >
                        Reset 2FA
                      </button>
                    )}
                    {manageable && (
                      <button
                        onClick={() => startEdit(user)}
                        className="text-xs text-slate-500 hover:text-slate-300 mr-2"
                      >
                        Edit
                      </button>
                    )}
                    {manageable && (user.staff ? (
                      <button
                        onClick={() => handleReset(user.id)}
                        title="Disable this login and clear its email + password (the staff member stays)"
                        className="text-xs text-amber-500/60 hover:text-amber-400"
                      >
                        Reset
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="text-xs text-red-500/60 hover:text-red-400"
                      >
                        Delete
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-6 space-y-4">
          <LoginLogSection dateFormat={dateFormat} />
          {canViewGroups && <GroupsSection canEdit={canEditGroups} />}
        </div>
      </div>
    </main>
  );
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  bad_password: { label: "Bad password", color: "text-red-400" },
  bad_totp: { label: "Bad TOTP", color: "text-red-400" },
  unknown_email: { label: "Unknown email", color: "text-red-400" },
  rate_limited: { label: "Rate limited", color: "text-amber-400" },
  account_locked: { label: "Locked", color: "text-amber-400" },
  account_disabled: { label: "Disabled", color: "text-red-400" },
  trusted_device: { label: "Trusted device", color: "text-green-400" },
  totp_verified: { label: "TOTP verified", color: "text-green-400" },
};

function LoginLogSection({ dateFormat }: { dateFormat: DateFormatKey }) {
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (expanded && !loaded) {
      fetch("/api/login-logs").then((r) => r.json()).then((data) => {
        setLogs(data);
        setLoaded(true);
      });
    }
  }, [expanded, loaded]);

  return (
    <section className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="text-sm font-medium text-slate-300">
          Login Activity
          {logs.length > 0 && <span className="ml-2 text-xs text-slate-600">({logs.length})</span>}
        </h2>
        <span className="text-xs text-slate-500">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 overflow-x-auto">
          <table className="w-full text-xs table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[20%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-700">
                <th className="py-2 px-2">Time</th>
                <th className="py-2 px-2">Email</th>
                <th className="py-2 px-2">Result</th>
                <th className="py-2 px-2">Detail</th>
                <th className="py-2 px-2">IP</th>
                <th className="py-2 px-2">Browser</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && loaded && (
                <tr><td colSpan={6} className="py-4 px-2 text-center text-slate-600">No login activity recorded yet.</td></tr>
              )}
              {logs.map((log) => {
                const r = log.reason ? REASON_LABELS[log.reason] : null;
                const ua = log.userAgent?.replace(/^Mozilla\/5\.0 \(/, "")?.split(")")[0] || log.userAgent;
                return (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-1.5 px-2 text-slate-500 font-mono truncate">
                      {(() => { const dt = new Date(log.createdAt); return `${formatDate(dt, dateFormat)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`; })()}
                    </td>
                    <td className="py-1.5 px-2 text-slate-300 truncate">{log.email}</td>
                    <td className="py-1.5 px-2">
                      {log.success ? (
                        <span className="text-green-400">Success</span>
                      ) : (
                        <span className="text-red-400">Failed</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 truncate">
                      <span className={r?.color || "text-slate-500"}>{r?.label || log.reason || "—"}</span>
                    </td>
                    <td className="py-1.5 px-2 text-slate-500 font-mono truncate">{log.ipAddress || "—"}</td>
                    <td className="py-1.5 px-2 text-slate-600 truncate" title={log.userAgent || ""}>{ua || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
