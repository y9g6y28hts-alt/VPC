import { defineConfig } from "@playwright/test";

/**
 * Pruebas de punta a punta. Requieren el stack local en ejecución:
 *   npm run auth:dev  ·  npm run db:seed-demo (con GOTRUE_BIN)  ·  npm run dev
 * PW_CHROMIUM permite usar un Chromium ya instalado.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: "retain-on-failure",
  },
});
