import Link from "next/link";

// Public, unauthenticated landing page shown at "/" to logged-out visitors
// (and, importantly, to URL-categorization crawlers run by corporate web
// filters). It has NO app data and NO auth — just marketing copy describing
// the product generically as staff scheduling software. Logged-in users never
// see this: page.tsx renders the schedule grid for them instead.

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Automated scheduling",
    body: "Generate a balanced schedule in seconds, then fine-tune by hand. The engine respects your coverage rules, staffing limits, and each person's availability.",
  },
  {
    title: "Fair by design",
    body: "Built-in equity tracking spreads desirable and undesirable shifts evenly, so no one quietly carries more than their share month after month.",
  },
  {
    title: "Time-off & shift requests",
    body: "Staff submit their own time-off and shift requests. Approvals flow straight onto the schedule — no spreadsheets, no lost emails.",
  },
  {
    title: "Coverage you can trust",
    body: "Set minimum staffing and per-day limits. YoSched flags gaps and over-scheduling before they become a problem on the floor.",
  },
  {
    title: "Hours on target",
    body: "Track pay-period hour targets per person so everyone lands where they should — no surprise overtime, no short weeks.",
  },
  {
    title: "Built for teams",
    body: "Multiple schedulers can work at once with live coordination, so the person editing always sees the current picture.",
  },
];

export function MarketingLanding() {
  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-dvh flex flex-col relative overflow-hidden text-slate-100"
      style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }}
    >
      {/* Drifting grid backdrop — matches the sign-in screen's look */}
      <div
        className="fixed inset-0 animate-[drift_20s_linear_infinite] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,179,237,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,179,237,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <div className="text-2xl font-extrabold tracking-tight">
          <span className="text-white">Yo</span>
          <span style={{ color: "#63b3ed" }}>Sched</span>
        </div>
        <Link
          href="/login"
          className="py-2 px-4 bg-sky-500/80 hover:bg-sky-500 text-white text-sm font-medium rounded transition-colors backdrop-blur-sm"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-6">
        <section className="text-center pt-16 pb-14">
          <h1
            className="text-5xl sm:text-6xl font-extrabold tracking-tight"
            style={{ textShadow: "0 0 40px rgba(99, 179, 237, 0.3)" }}
          >
            Staff scheduling,
            <br />
            <span style={{ color: "#63b3ed" }}>done right.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-white/70 font-light max-w-2xl mx-auto">
            YoSched is staff scheduling software for teams that run around the
            clock. Automated, fair, and flexible — smarter schedules and happier
            teams.
          </p>
        </section>

        {/* Feature grid */}
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 pb-20">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
            >
              <h2 className="text-lg font-semibold text-white">{f.title}</h2>
              <p className="mt-2 text-sm text-white/60 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="max-w-6xl mx-auto w-full px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-white/40">
          <span>© {year} Yologiq. All rights reserved.</span>
          <nav className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-white/70 transition-colors">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
