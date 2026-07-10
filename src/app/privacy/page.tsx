import Link from "next/link";
import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/base-path";

// Public privacy page. Two reasons it exists: (1) it's a real legitimacy signal
// that URL-categorization engines look for when deciding a domain is a genuine
// business rather than a parked/placeholder domain; (2) it's linked from the
// public landing footer. Content is a plain-English template — David should have
// the specifics reviewed before relying on it as a legal document.

export const metadata: Metadata = {
  title: "Privacy",
  description: "How YoSched handles your data.",
  alternates: { canonical: canonicalUrl("/privacy") },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-slate-900 text-slate-200">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-sky-400 hover:text-sky-300">
          ← Back to home
        </Link>
        <h1 className="mt-6 text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-400">
          YoSched is staff scheduling software. This page explains, in plain
          terms, what data the service handles and why.
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">What we store</h2>
            <p className="mt-1">
              YoSched stores the information needed to build and run staff
              schedules: account details for the people who sign in, staff roster
              information, shift assignments, time-off and shift requests, and
              scheduling settings configured by your organization.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Cookies</h2>
            <p className="mt-1">
              YoSched uses cookies strictly to keep you signed in and to secure
              your session. It does not use advertising or third-party tracking
              cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">How data is used</h2>
            <p className="mt-1">
              Your data is used only to provide the scheduling service to your
              organization. YoSched does not sell your data or share it with third
              parties for marketing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Access & questions</h2>
            <p className="mt-1">
              Access to your organization&apos;s data is limited to authorized
              users within your organization. For questions about your data,
              contact your YoSched administrator.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
