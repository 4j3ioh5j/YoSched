"use client";

import { useState } from "react";

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled?: boolean;
  createdAt: string | Date;
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-amber-700 text-amber-100",
  manager: "bg-blue-700 text-blue-100",
  viewer: "bg-slate-600 text-slate-300",
};

export function UsersPage({
  initialUsers,
  currentUserId,
}: {
  initialUsers: User[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", confirmPassword: "", role: "viewer" });
  const [error, setError] = useState("");

  function resetForm() {
    setForm({ email: "", name: "", password: "", confirmPassword: "", role: "viewer" });
    setShowForm(false);
    setEditingId(null);
    setError("");
  }

  async function handleSave() {
    setError("");

    if (form.password && form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const endpoint = "/api/users";

    if (editingId) {
      const body: Record<string, string> = { id: editingId, email: form.email, name: form.name, role: form.role };
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

  function startEdit(user: User) {
    setForm({ email: user.email, name: user.name, password: "", confirmPassword: "", role: user.role });
    setEditingId(user.id);
    setShowForm(true);
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
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
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

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Role</th>
              <th className="py-2 px-3">2FA</th>
              <th className="py-2 px-3 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="py-2 px-3">{user.name}</td>
                <td className="py-2 px-3 text-slate-400">{user.email}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE[user.role] || ROLE_BADGE.viewer}`}>
                    {user.role}
                  </span>
                </td>
                <td className="py-2 px-3">
                  {user.totpEnabled ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-800/50 text-green-300">On</span>
                  ) : (
                    <span className="text-xs text-slate-600">Off</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => startEdit(user)}
                    className="text-xs text-slate-500 hover:text-slate-300 mr-2"
                  >
                    Edit
                  </button>
                  {user.totpEnabled && (
                    <button
                      onClick={() => handleReset2FA(user.id)}
                      className="text-xs text-amber-500/60 hover:text-amber-400 mr-2"
                    >
                      Reset 2FA
                    </button>
                  )}
                  {user.id !== currentUserId && (
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-xs text-red-500/60 hover:text-red-400"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
