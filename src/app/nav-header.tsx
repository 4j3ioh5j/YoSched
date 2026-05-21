"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Schedule", href: "/" },
  { label: "Staff", href: "/staff" },
  { label: "Statistics", href: "/equity" },
  { label: "Settings", href: "/settings" },
];

export function NavHeader() {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
      <Link href="/" className="text-xl font-bold tracking-tight hover:text-blue-400 transition-colors">
        YoSched
      </Link>
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
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
    </header>
  );
}
