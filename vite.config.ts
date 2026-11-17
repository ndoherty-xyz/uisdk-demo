/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  // Playwright owns tests/*.spec.ts.
  test: { include: ["tests/**/*.test.ts"] },
});
