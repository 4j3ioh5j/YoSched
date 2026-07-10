import type { Metadata } from "next";

// A sign-in form has no business in a search index, and the apex robots.txt is `Allow: /`,
// so the only thing keeping /login out of the index is this meta tag.
//
// It lives in a layout rather than on the page because `login/page.tsx` is a client
// component ("use client"), and client components cannot export `metadata`. Next merges
// this into the route's head exactly as if the page had declared it.
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// Rendered per-request so middleware's CSP nonce reaches Next's inline bootstrap scripts.
// This one is not optional: login/page.tsx is a client component, so under an enforced policy
// an un-nonced prerender would block its JS and sign-in would simply stop working. It lives in
// the layout because route segment config cannot be exported from a "use client" page.
export const dynamic = "force-dynamic";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
