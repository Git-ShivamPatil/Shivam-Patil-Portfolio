"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    // Light is the default: it is the pink-and-cream system, tuned so every
    // text pairing clears WCAG AAA, and it is the one a first-time visitor
    // should land on. enableSystem stays false so the default is honoured
    // rather than being overridden by whatever the OS happens to prefer.
    <NextThemesProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      {children}
    </NextThemesProvider>
  );
}
