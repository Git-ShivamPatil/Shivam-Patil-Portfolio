import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: everything under test here is server-side logic —
    // signature verification, money maths, rate limiting, template escaping.
    // Component rendering is covered by the build and by browser verification
    // instead, which is where component bugs actually show up.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each file gets a fresh module registry so the module-scoped caches in
    // lib/rate-limit.ts and lib/realtime/hub.ts can't leak between files.
    isolate: true,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/generated/**"],
    },
  },
});
