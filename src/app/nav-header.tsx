"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const ROLE_LEVEL: Record<string, number> = { viewer: 0, manager: 1, admin: 2 };

const NAV_ITEMS = [
  { label: "Schedule", href: "/", minRole: "viewer" },
  { label: "Staff", href: "/staff", minRole: "manager" },
  { label: "Statistics", href: "/equity", minRole: "viewer" },
  { label: "Settings", href: "/settings", minRole: "admin" },
  { label: "Users", href: "/users", minRole: "admin" },
];

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-amber-700 text-amber-100",
  manager: "bg-blue-700 text-blue-100",
  viewer: "bg-slate-600 text-slate-300",
};

export function NavHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role;

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
      <Link href="/" className="text-xl font-bold tracking-tight hover:text-blue-400 transition-colors">
        YoSched
      </Link>
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.filter((item) => (ROLE_LEVEL[role ?? "viewer"] ?? 0) >= (ROLE_LEVEL[item.minRole] ?? 0)).map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "px-3 py-1 text-sm rounded transition-colors",
                active
                  ? "bg-slate-700 text-slate-100 font-medium"
                  : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {session?.user && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Link href="/account" className="text-sm text-slate-300 hover:text-slate-100 transition-colors">
              {session.user.name}
            </Link>
            {role && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE[role] || ROLE_BADGE.viewer}`}>
                {role}
              </span>
            )}
          </div>
          <button
            onClick={async () => {
              await signOut({ redirect: false });
              window.location.href = "/login";
            }}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
