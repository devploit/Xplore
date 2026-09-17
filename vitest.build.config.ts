import { defineConfig } from "vitest/config";

// Runs only the guard over dist/. Kept separate so unit tests never depend on a build.
export default defineConfig({
  test: { environment: "node", include: ["tests/build/**/*.test.ts"] },
});
