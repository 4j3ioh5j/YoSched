import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { SITE_URL, canonicalUrl } from "@/lib/base-path";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Richer, generic (non-industry-specific) metadata. metadataBase makes the
// Open Graph/canonical URLs absolute, and the description/keywords give
// URL-categorization engines clear signals that this is legitimate business
// scheduling software — a key part of avoiding "uncategorized" blocks.
// NOTE: deliberately no `alternates.canonical` here. Metadata cascades from the root
// layout into every route that doesn't override it, so a canonical set here would make
// /privacy (and every other page) claim to be the app root. Canonicals are declared
// per-route instead.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "YoSched — Staff Scheduling Software",
    template: "%s · YoSched",
  },
  description:
    "YoSched is staff scheduling software for teams that run around the clock — automated schedule generation, fair shift distribution, time-off requests, and coverage rules.",
  applicationName: "YoSched",
  keywords: [
    "staff scheduling",
    "employee scheduling",
    "shift scheduling software",
    "workforce scheduling",
    "schedule generator",
    "shift management",
  ],
  openGraph: {
    title: "YoSched — Staff Scheduling Software",
    description:
      "Automated, fair, and flexible staff scheduling. Smarter schedules and happier teams.",
    url: canonicalUrl("/"),
    siteName: "YoSched",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
