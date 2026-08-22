"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    // Dark is the default, on every device and regardless of what the OS asks
    // for. `enableSystem={false}` is what makes that true rather than a
    // preference: with it on, next-themes would resolve "system" and hand a
    // light-OS visitor the light theme, which is the opposite of a default.
    //
    // A stored choice still wins — this is the value for someone who has never
    // touched the toggle, not a lock.
    //
    // **This is only half of the default.** next-themes writes the attribute
    // from an inline script, so it cannot help a visitor whose JavaScript never
    // runs; for them the document would fall through to the light `:root`
    // block. app/layout.tsx server-renders `data-theme="dark"` on <html> to
    // close that gap, and the two values have to agree.
    <NextThemesProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
      {children}
    </NextThemesProvider>
  );
}
