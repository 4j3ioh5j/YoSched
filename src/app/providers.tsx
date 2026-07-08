"use client";

import { SessionProvider } from "next-auth/react";
import { PresenceProvider } from "./presence-provider";
import { AUTH_BASE_PATH } from "@/lib/base-path";
// Installs the client fetch interceptor (prefixes app-absolute fetches with basePath).
import "./base-path-fetch";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={AUTH_BASE_PATH}>
      <PresenceProvider>{children}</PresenceProvider>
    </SessionProvider>
  );
}
