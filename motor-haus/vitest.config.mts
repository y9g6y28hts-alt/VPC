import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Las pruebas de integración comparten una base PostgreSQL: se ejecutan en serie.
    fileParallelism: false,
  },
});
