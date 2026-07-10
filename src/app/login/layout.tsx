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

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
