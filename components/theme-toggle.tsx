"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid rendering theme-dependent UI until after hydration, since the
  // server doesn't know the user's stored/system preference yet. This is
  // next-themes' own documented mount-guard pattern — the one-time setState
  // here is intentional, not a synchronization bug.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
      className="border-app-line text-app-fg hover:border-app-fg inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
    >
      {mounted && isDark ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 15a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM4.93 4.93a1 1 0 0 1 1.41 0l.71.7a1 1 0 0 1-1.42 1.42l-.7-.71a1 1 0 0 1 0-1.41Zm12.02 12.02a1 1 0 0 1 1.41 0l.71.7a1 1 0 0 1-1.42 1.42l-.7-.71a1 1 0 0 1 0-1.41ZM3 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm15 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM4.93 19.07a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-1.42 0Zm12.02-12.02a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-1.42 0ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
            fill="currentColor"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <path
            d="M20.742 13.045a8.088 8.088 0 0 1-2.077.267c-4.476 0-8.106-3.63-8.106-8.106 0-1.09.216-2.13.61-3.078a1 1 0 0 0-1.276-1.303A10.106 10.106 0 0 0 2 10.894C2 16.478 6.522 21 12.106 21a10.106 10.106 0 0 0 9.94-8.243 1 1 0 0 0-1.304-1.106 8.06 8.06 0 0 1 0 .394Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
}
