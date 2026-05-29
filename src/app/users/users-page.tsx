"use client";

import { useState, useEffect, useCallback } from "react";
import { useEscape } from "@/lib/use-escape";
import { formatDate, type DateFormatKey, DEFAULT_DATE_FORMAT } from "@/lib/date-format";

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
  email: string;
  name: string;
  role: string;
  groupId?: string | null;
  group?: { name: string; level: number } | null;
  isActive: boolean;
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
  currentUserId,
  currentGroupLevel,
  groups,
  deviceTrustDays: initialTrustDays,
  dateFormat: dateFormatProp,
}: {
  initialUsers: User[];
  currentUserId: string;
  currentGroupLevel: number;
  groups: GroupOption[];
  deviceTrustDays: number;
  dateFormat?: string;
}) {
  const dateFormat = (dateFormatProp || DEFAULT_DATE_FORMAT) as DateFormatKey;
  const assignableGroups = groups.filter((g) => g.level < currentGroupLevel);
  const defaultGroupId = assignableGroups.find((g) => g.name === "Staff")?.id ?? assignableGroups[0]?.id ?? "";

  const [users, setUsers] = useState(initialUsers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", confirmPassword: "", groupId: defaultGroupId });
  const [error, setError] = useState("");
  const [trustDays, setTrustDays] = useState(initialTrustDays);
  const [savingTrust, setSavingTrust] = useState(false);

  const resetForm = useCallback(() => {
    setForm({ email: "", name: "", password: "", confirmPassword: "", groupId: defaultGroupId });
    setShowForm(false);
    setEditingId(null);
    setError("");
  }, [defaultGroupId]);
  useEscape(resetForm);

  async function handleSave() {
    setError("");

    if (form.password && form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const endpoint = "/api/users";

    if (editingId) {
      const body: Record<string, string> = { id: editingId, email: form.email, name: form.name, groupId: form.groupId };
      if (form.password) body.password = form.password;
      const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { setError((await res.json()).error); return; }
      const updated = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === editingId ? updated : u)));
    } else {
      if (!form.password) { setError("Password required for new users"); return; }
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
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

  async function handleReset2FA(id: string) {
    if (!confirm("Reset 2FA for this user? They will need to set it up again.")) return;
    const res = await fetch("/api/users/reset-totp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) });
    if (res.ok) setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, totpEnabled: false } : u)));
  }

  async function handleToggleActive(user: User) {
    const res = await fetch("/api/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, isActive: !user.isActive }) });
    if (res.ok) {
      const updated = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
    }
  }

  function startEdit(user: User) {
    setForm({ email: user.email, name: user.name, password: "", confirmPassword: "", groupId: user.groupId ?? defaultGroupId });
    setEditingId(user.id);
    setShowForm(true);
  }

  function canManageUser(user: User): boolean {
    if (user.id === currentUserId) return false;
    const userLevel = user.group?.level ?? 0;
    return userLevel < currentGroupLevel;
  }

  return (
    <main className="flex-1 p-6 bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold">Users</h1>
          {!showForm && (
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              Add User
            </button>
          )}
        </div>

        {showForm && (
          <div className="mb-6 p-4 bg-slate-800 rounded border border-slate-700 space-y-3">
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
        )}

        <div className="mb-4 px-3 py-2.5 bg-slate-800/40 border border-slate-700/50 rounded flex items-center gap-2 text-xs text-slate-500">
          <span>2FA trusted devices are remembered for</span>
          <input
            type="number"
            min={1}
            max={365}
            value={trustDays}
            onChange={(e) => setTrustDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
            className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span>days before re-prompting.</span>
          {trustDays !== initialTrustDays && (
            <button
              disabled={savingTrust}
              onClick={async () => {
                setSavingTrust(true);
                await fetch("/api/settings/scheduling-preferences", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ deviceTrustDays: trustDays }),
                });
                setSavingTrust(false);
              }}
              className="ml-auto px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {savingTrust ? "Saving..." : "Save"}
            </button>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Group</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">2FA</th>
              <th className="py-2 px-3 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const gName = user.group?.name ?? "";
              const manageable = canManageUser(user);
              return (
                <tr key={user.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${!user.isActive ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3">{user.name}</td>
                  <td className="py-2 px-3 text-slate-400">{user.email}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${GROUP_BADGE[gName] || "bg-slate-600 text-slate-300"}`}>
                      {gName || user.role}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    {manageable ? (
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${user.isActive ? "bg-green-800/50 text-green-300 hover:bg-green-800/80" : "bg-red-900/50 text-red-400 hover:bg-red-900/80"}`}
                      >
                        {user.isActive ? "Active" : "Disabled"}
                      </button>
                    ) : (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${user.isActive ? "bg-green-800/50 text-green-300" : "bg-red-900/50 text-red-400"}`}>
                        {user.isActive ? "Active" : "Disabled"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {user.totpEnabled ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-800/50 text-green-300">On</span>
                    ) : (
                      <span className="text-xs text-slate-600">Off</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
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
                    {manageable && (
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="text-xs text-red-500/60 hover:text-red-400"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <LoginLogSection dateFormat={dateFormat} />
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
    <div className="mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="text-xs">{expanded ? "▼" : "▶"}</span>
        Login Activity
        {logs.length > 0 && <span className="text-xs text-slate-600">({logs.length})</span>}
      </button>
      {expanded && (
        <div className="mt-3 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 bg-slate-800/60 border-b border-slate-800">
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Result</th>
                <th className="py-2 px-3">Detail</th>
                <th className="py-2 px-3">IP</th>
                <th className="py-2 px-3">Browser</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && loaded && (
                <tr><td colSpan={6} className="py-4 px-3 text-center text-slate-600">No login activity recorded yet.</td></tr>
              )}
              {logs.map((log) => {
                const r = log.reason ? REASON_LABELS[log.reason] : null;
                const ua = log.userAgent?.replace(/^Mozilla\/5\.0 \(/, "")?.split(")")[0] || log.userAgent;
                return (
                  <tr key={log.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                    <td className="py-1.5 px-3 text-slate-500 font-mono whitespace-nowrap">
                      {(() => { const dt = new Date(log.createdAt); return `${formatDate(dt, dateFormat)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`; })()}
                    </td>
                    <td className="py-1.5 px-3 text-slate-300">{log.email}</td>
                    <td className="py-1.5 px-3">
                      {log.success ? (
                        <span className="text-green-400">Success</span>
                      ) : (
                        <span className="text-red-400">Failed</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className={r?.color || "text-slate-500"}>{r?.label || log.reason || "—"}</span>
                    </td>
                    <td className="py-1.5 px-3 text-slate-500 font-mono">{log.ipAddress || "—"}</td>
                    <td className="py-1.5 px-3 text-slate-600 truncate max-w-[200px]" title={log.userAgent || ""}>{ua || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
