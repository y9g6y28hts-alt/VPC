// Captura de pantallas autenticadas para revisión visual (desarrollo).
// Uso: tsx scripts/shot.ts <email> <ruta> [<ruta>...]  → artifacts/screens/*.png
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.env.MH_BASE_URL ?? "http://localhost:3000";
const [email, ...paths] = process.argv.slice(2);
const out = "artifacts/screens";
mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MH_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: Number(process.env.MH_W ?? 1440), height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const p of paths) {
    if (p.startsWith("/api/")) {
      const r = await page.request.get(`${base}${p}`);
      const file = `${out}/${p.replace(/[^a-z0-9]+/gi, "_")}.${(r.headers()["content-type"] ?? "").includes("pdf") ? "pdf" : "txt"}`;
      (await import("node:fs")).writeFileSync(file, await r.body());
      console.log(`${r.status()} ${p} → ${file}`);
      continue;
    }
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.MH_FULL !== "0" });
    console.log(`${res?.status()} ${p} → ${out}/${name}.png`);
  }
  if (errors.length) console.log("ERRORES DE PÁGINA:\n" + errors.join("\n"));
  await browser.close();
})();
