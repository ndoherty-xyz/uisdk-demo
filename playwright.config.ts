import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  use: { baseURL: "http://localhost:5173" },
  webServer: { command: "pnpm dev", url: "http://localhost:5173", reuseExistingServer: true },
});
