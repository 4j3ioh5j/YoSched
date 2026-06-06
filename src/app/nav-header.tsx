"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const NAV_ITEMS: { label: string; href: string; requiredPermission: string | null }[] = [
  { label: "Schedule", href: "/", requiredPermission: null },
  { label: "My Requests", href: "/my-requests", requiredPermission: "requests:self" },
  { label: "Requests", href: "/requests", requiredPermission: "schedule:view" },
  { label: "Staff", href: "/staff", requiredPermission: "staff:view" },
  { label: "Statistics", href: "/equity", requiredPermission: "statistics:view" },
  { label: "Settings", href: "/settings", requiredPermission: "settings:view" },
  { label: "Users", href: "/users", requiredPermission: "users:view" },
];

const GROUP_BADGE: Record<string, string> = {
  Admin: "bg-amber-700 text-amber-100",
  "Super User": "bg-blue-700 text-blue-100",
  Scheduler: "bg-emerald-700 text-emerald-100",
  Staff: "bg-slate-600 text-slate-300",
};

export function NavHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const user = session?.user as { permissions?: string[]; groupName?: string } | undefined;
  const permissions = user?.permissions ?? [];
  const groupName = user?.groupName ?? "";

  return (
    <header data-print-hide className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
      <Link href="/" className="text-xl font-bold tracking-tight hover:text-blue-400 transition-colors">
        <span className="text-white">Yo</span><span style={{ color: "#63b3ed" }}>Sched</span>
      </Link>
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.filter((item) => !item.requiredPermission || permissions.includes(item.requiredPermission)).map((item) => {
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
          <Link href="/account" className="flex items-center gap-2 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors">
            <span className="text-sm text-slate-200">{session.user.name}</span>
            {groupName && (
              <span className={`inline-block w-[88px] text-center text-xs py-0.5 rounded ${GROUP_BADGE[groupName] || "bg-slate-600 text-slate-300"}`}>
                {groupName}
              </span>
            )}
          </Link>
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
