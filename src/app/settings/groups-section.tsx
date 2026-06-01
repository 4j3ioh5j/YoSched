"use client";

import { useState, useCallback } from "react";
import { useEscape } from "@/lib/use-escape";

type Group = {
  id: string;
  name: string;
  permissions: string[];
  level: number;
  isSystem: boolean;
  permissionsLocked: boolean;
  _count: { users: number };
};

const ALL_PERMISSIONS = [
  { key: "schedule:view", label: "View Schedule", category: "Schedule" },
  { key: "schedule:edit", label: "Edit Schedule", category: "Schedule" },
  { key: "schedule:auto", label: "Auto-Scheduler", category: "Schedule" },
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
] as const;

const CATEGORIES = ["Schedule", "Staff", "Statistics", "Settings", "Users", "Groups"] as const;

const GROUP_BADGE: Record<string, string> = {
  Admin: "bg-amber-700 text-amber-100",
  "Super User": "bg-blue-700 text-blue-100",
  Scheduler: "bg-emerald-700 text-emerald-100",
  Staff: "bg-slate-600 text-slate-300",
};

export function GroupsSection({ canEdit }: { canEdit: boolean }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState(0);
  const [newPermissions, setNewPermissions] = useState<string[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/groups");
    if (res.ok) {
      setGroups(await res.json());
      setLoaded(true);
    }
  }, []);

  const resetForm = useCallback(() => {
    setShowCreate(false);
    setEditingGroup(null);
    setNewName("");
    setNewLevel(0);
    setNewPermissions([]);
    setError("");
  }, []);
  useEscape(resetForm);

  function togglePerm(perm: string) {
    setNewPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  function toggleCategory(cat: string) {
    const catPerms: string[] = ALL_PERMISSIONS.filter((p) => p.category === cat).map((p) => p.key as string);
    const allChecked = catPerms.every((p) => newPermissions.includes(p));
    if (allChecked) {
      setNewPermissions((prev) => prev.filter((p) => !catPerms.includes(p)));
    } else {
      setNewPermissions((prev) => [...new Set([...prev, ...catPerms])]);
    }
  }

  async function handleCreate() {
    setError("");
    const res = await fetch("/api/settings/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, permissions: newPermissions, level: newLevel }),
    });
    if (!res.ok) { setError((await res.json()).error); return; }
    const created = await res.json();
    setGroups((prev) => [...prev, created].sort((a, b) => b.level - a.level));
    resetForm();
  }

  async function handleUpdate() {
    if (!editingGroup) return;
    setError("");
    const res = await fetch("/api/settings/groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingGroup.id, name: newName || undefined, permissions: newPermissions }),
    });
    if (!res.ok) { setError((await res.json()).error); return; }
    const updated = await res.json();
    setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    resetForm();
  }

  async function handleDelete(group: Group) {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    const res = await fetch("/api/settings/groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: group.id }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
  }

  function startEdit(group: Group) {
    setEditingGroup(group);
    setNewName(group.name);
    setNewPermissions([...group.permissions]);
    setShowCreate(false);
    setError("");
  }

  return (
    <section className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
      <button
        onClick={() => { setExpanded(!expanded); if (!loaded) load(); }}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="text-sm font-medium text-slate-300">Groups & Permissions</h2>
        <span className="text-xs text-slate-500">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-700">
                <th className="py-2 px-2">Group</th>
                <th className="py-2 px-2">Level</th>
                <th className="py-2 px-2">Permissions</th>
                <th className="py-2 px-2">Users</th>
                <th className="py-2 px-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-2 px-2">
                    <span className={`inline-block w-[88px] text-center text-xs py-0.5 rounded ${GROUP_BADGE[group.name] || "bg-slate-600 text-slate-300"}`}>
                      {group.name}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-slate-400 font-mono text-xs">{group.level}</td>
                  <td className="py-2 px-2 text-slate-400 text-xs">
                    {group.permissionsLocked ? (
                      <span className="text-slate-500">All (locked)</span>
                    ) : (
                      <span>{group.permissions.length} / {ALL_PERMISSIONS.length}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-slate-400 text-xs">{group._count.users}</td>
                  <td className="py-2 px-2 text-right">
                    {canEdit && !group.permissionsLocked && (
                      <button onClick={() => startEdit(group)} className="text-xs text-slate-500 hover:text-slate-300 mr-2">
                        Edit
                      </button>
                    )}
                    {canEdit && !group.isSystem && group._count.users === 0 && (
                      <button onClick={() => handleDelete(group)} className="text-xs text-red-500/60 hover:text-red-400">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canEdit && !showCreate && !editingGroup && (
            <button
              onClick={() => { setShowCreate(true); setNewPermissions([]); setNewName(""); setNewLevel(0); }}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + New Group
            </button>
          )}

          {(showCreate || editingGroup) && (
            <div className="p-3 bg-slate-900/50 border border-slate-700 rounded space-y-3">
              <h3 className="text-xs font-medium text-slate-400">
                {editingGroup ? `Edit: ${editingGroup.name}` : "New Group"}
              </h3>
              <div className="flex gap-3">
                <input
                  placeholder="Group name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={editingGroup?.isSystem}
                  className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
                {!editingGroup && (
                  <select
                    value={newLevel}
                    onChange={(e) => setNewLevel(Number(e.target.value))}
                    className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value={0}>Level 0</option>
                    <option value={1}>Level 1</option>
                  </select>
                )}
              </div>

              <div className="grid grid-cols-3 gap-x-6 gap-y-1">
                {CATEGORIES.map((cat) => {
                  const catPerms = ALL_PERMISSIONS.filter((p) => p.category === cat);
                  const allChecked = catPerms.every((p) => newPermissions.includes(p.key));
                  const someChecked = catPerms.some((p) => newPermissions.includes(p.key));
                  return (
                    <div key={cat}>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400 py-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                          onChange={() => toggleCategory(cat)}
                          className="rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        {cat}
                      </label>
                      {catPerms.map((p) => (
                        <label key={p.key} className="flex items-center gap-1.5 text-xs text-slate-500 pl-4 py-0.5 cursor-pointer select-none hover:text-slate-300">
                          <input
                            type="checkbox"
                            checked={newPermissions.includes(p.key)}
                            onChange={() => togglePerm(p.key)}
                            className="rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                          />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={editingGroup ? handleUpdate : handleCreate}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  {editingGroup ? "Save" : "Create"}
                </button>
                <button onClick={resetForm} className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
