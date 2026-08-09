"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    // Auth.js refetches /api/auth/session every time the tab regains focus.
    // AuthNav lives in the header, so that fires on every page of a site whose
    // traffic is overwhelmingly signed-out visitors reading public pages —
    // a request per alt-tab that can only ever return the same empty session.
    //
    // The session here is a JWT, not a database lookup (the Credentials
    // provider forces the JWT strategy), so each refetch was cheap on the
    // server; this is about not spending the visitor's main thread and
    // radio on it. Sign-in and sign-out still update the session immediately —
    // those go through Auth.js's own broadcast channel, not this poll.
    <NextAuthSessionProvider refetchOnWindowFocus={false}>{children}</NextAuthSessionProvider>
  );
}
