"use client";

import { useActiveEditors } from "./presence-provider";

// Passive banner on the schedule page: tells an editor that other editors are also
// logged in right now, so they can coordinate before making changes. It is purely
// informational — it does not lock cells, block edits, or detect conflicts. The list
// comes from PresenceProvider (app-wide heartbeat); this component only renders it.
//
// "Two or more editors" reduces to: the viewer is an editor (only editors get a
// heartbeat, so the list is empty otherwise) AND at least one OTHER editor is active.

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function EditorPresenceBanner() {
  const editors = useActiveEditors();
  if (editors.length === 0) return null;

  const names = editors.map((e) => e.name);
  const verb = names.length === 1 ? "is" : "are";

  return (
    <div
      data-print-hide
      role="status"
      className="flex items-center gap-2 px-6 py-2 text-sm border-b border-amber-700/60 bg-amber-950/40 text-amber-200 shrink-0"
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-400" />
      <span>
        <span className="font-medium">{joinNames(names)}</span> {verb} also editing the schedule — coordinate before making changes.
      </span>
    </div>
  );
}
