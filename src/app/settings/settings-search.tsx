"use client";

// Card #366: a search box at the top of Settings that jumps to any control. The list is read
// from the page itself when the box is used (section titles, field rows, labels, subheadings and
// named controls), so a new setting is found without a list to keep up to date.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { dedupeSettingsEntries, searchSettings, type SettingsSearchEntry, type SettingsSearchHit } from "@/lib/settings-search";

const CONTROL_SELECTOR = "[data-search-label], label, h3, input[aria-label], select[aria-label], textarea[aria-label]";
const FOCUSABLE = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";
const FLASH_MS = 2000;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Hidden by something other than its section being collapsed (a sub-panel that is closed).
function hiddenInsideBody(el: Element, body: Element): boolean {
  for (let p: Element | null = el; p && p !== body; p = p.parentElement) {
    if (p.classList.contains("hidden") || p.hasAttribute("hidden")) return true;
  }
  return false;
}

// A label's own words, apart from a description printed inside it: text nodes are grouped by the
// element that holds them, the first group is the name and the rest is the description.
function splitText(el: Element): { label: string; desc: string } {
  const groups: { parent: Node | null; parts: string[] }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue ?? "";
    if (!t.trim()) continue;
    const last = groups[groups.length - 1];
    if (last && last.parent === n.parentNode) last.parts.push(t);
    else groups.push({ parent: n.parentNode, parts: [t] });
  }
  const norm = (parts: string[]) => parts.join("").replace(/\s+/g, " ").trim();
  return { label: norm(groups[0]?.parts ?? []), desc: groups.slice(1).map((g) => norm(g.parts)).join(" ") };
}

function labelOf(el: Element): { label: string; desc: string } {
  const own = el.getAttribute("data-search-label") ?? (el.matches("input, select, textarea") ? el.getAttribute("aria-label") : null);
  if (own != null) return { label: clip(own.replace(/\s+/g, " ").trim(), 90), desc: el.getAttribute("data-search-desc") ?? "" };
  const split = splitText(el);
  return { label: clip(split.label, 90), desc: split.desc };
}

type Indexed = { entries: SettingsSearchEntry[]; targets: Map<string, Element> };

function buildIndex(): Indexed {
  const raw: SettingsSearchEntry[] = [];
  const targets = new Map<string, Element>();
  let order = 0;
  document.querySelectorAll("[data-settings-section]").forEach((section) => {
    const sectionId = section.getAttribute("data-settings-section") ?? "";
    const title = section.getAttribute("data-section-title") ?? "";
    const desc = section.getAttribute("data-section-desc") ?? "";
    const groupEl = section.parentElement?.previousElementSibling;
    const group = groupEl?.getAttribute("data-settings-group") ?? "";
    const key = `s:${sectionId}`;
    raw.push({ key, sectionId, section: title, group, label: title, desc, kind: "section", order: order++ });
    targets.set(key, section);
    const body = section.querySelector("[data-settings-body]");
    if (!body) return;
    body.querySelectorAll(CONTROL_SELECTOR).forEach((el) => {
      if (el.closest('[role="dialog"], .fixed')) return;
      if (hiddenInsideBody(el, body)) return;
      // A label inside a field row is already covered by the row.
      if (!el.hasAttribute("data-search-label")) {
        const row = el.parentElement?.closest("[data-search-label]");
        if (row && body.contains(row)) return;
      }
      const k = `c:${sectionId}:${order}`;
      const { label, desc: ownDesc } = labelOf(el);
      raw.push({ key: k, sectionId, section: title, group, label, desc: clip(ownDesc, 300), kind: "control", order: order++ });
      targets.set(k, el);
    });
  });
  return { entries: dedupeSettingsEntries(raw), targets };
}

function controlFor(el: Element): HTMLElement | null {
  if (el.matches("input, select, textarea")) return el as HTMLElement;
  if (el instanceof HTMLLabelElement && el.htmlFor) return document.getElementById(el.htmlFor);
  return el.querySelector<HTMLElement>(FOCUSABLE);
}

function visible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

export function SettingsSearch({ openSection }: { openSection: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<Indexed | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashRef = useRef<{ el: Element; timer: number } | null>(null);
  const listId = useId();

  const hits: SettingsSearchHit[] = useMemo(() => (index ? searchSettings(index.entries, query) : []), [index, query]);

  // "/" focuses the box, unless the person is typing somewhere.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.closest("input, textarea, select, [contenteditable]"))) return;
      ev.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    const f = flashRef.current;
    if (f) { window.clearTimeout(f.timer); f.el.removeAttribute("data-search-flash"); }
  }, []);

  const jump = useCallback((hit: SettingsSearchHit) => {
    const target = index?.targets.get(hit.key);
    setOpen(false);
    setQuery("");
    if (!target || !target.isConnected) return;
    openSection(hit.sectionId);
    // Wait for the opened section to lay out before measuring and scrolling.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const section = target.closest("[data-settings-section]");
      const el = visible(target) ? target : section;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const prev = flashRef.current;
      if (prev) { window.clearTimeout(prev.timer); prev.el.removeAttribute("data-search-flash"); }
      el.setAttribute("data-search-flash", "");
      flashRef.current = { el, timer: window.setTimeout(() => { el.removeAttribute("data-search-flash"); flashRef.current = null; }, FLASH_MS) };
      const control = el === target && hit.kind === "control" ? controlFor(target) : null;
      if (control && visible(control)) control.focus({ preventScroll: true });
    }));
  }, [index, openSection]);

  // Keep the highlighted result in sight when the arrows move past the dropdown's edge.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setOpen(true);
      setActive((a) => (hits.length ? (a + 1) % hits.length : 0));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((a) => (hits.length ? (a - 1 + hits.length) % hits.length : 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const hit = hits[active];
      if (hit) jump(hit);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      if (query) setQuery(""); else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="relative flex-1 max-w-sm">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search settings"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search settings  ( / )"
        value={query}
        onFocus={() => { setIndex(buildIndex()); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onChange={(ev) => { setQuery(ev.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching settings"
          className="absolute left-0 right-0 mt-1 max-h-96 overflow-y-auto rounded border border-slate-600 bg-slate-800 shadow-xl z-20 py-1"
        >
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No setting matches</li>}
          {hits.map((hit, i) => (
            <li
              key={hit.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the box's blur would close the list first.
              onMouseDown={(ev) => { ev.preventDefault(); jump(hit); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 cursor-pointer ${i === active ? "bg-slate-700" : ""}`}
            >
              <div className="text-sm text-slate-100 truncate">{hit.label}</div>
              <div className="text-xs text-slate-400 truncate">
                {hit.kind === "section" ? hit.group || "Section" : `${hit.section}${hit.group ? ` · ${hit.group}` : ""}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
