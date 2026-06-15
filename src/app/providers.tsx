"use client";

import { SessionProvider } from "next-auth/react";
import { PresenceProvider } from "./presence-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PresenceProvider>{children}</PresenceProvider>
    </SessionProvider>
  );
}
