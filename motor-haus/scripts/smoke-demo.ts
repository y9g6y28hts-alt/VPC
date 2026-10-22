// =============================================================================
// Verificación de un despliegue sin acceso a la base (p. ej. la URL de Vercel):
// inicia sesión, recorre todas las secciones y sus primeros expedientes, y
// ejecuta una negociación con escenario de financiación por la interfaz.
// Uso: MH_BASE_URL=https://su-app.vercel.app npx tsx scripts/smoke-demo.ts
// =============================================================================
import { chromium, Page } from "playwright-core";

const base = (process.env.MH_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const password = process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026";
let failures = 0;

async function login(page: Page, email: string) {
  await page.goto(`${base}/login`);
  if (await page.locator("details:not([open]) summary").count()) await page.locator("details summary").first().click();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function check(page: Page, path: string) {
  const errors: string[] = [];
  const onErr = (e: Error) => errors.push(e.message);
  page.on("pageerror", onErr);
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  const broken = await page.getByText("No se pudo cargar esta vista").count();
  page.off("pageerror", onErr);
  const ok = (res?.status() ?? 500) < 400 && broken === 0 && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${res?.status()} ${path}${errors.length ? ` · ${errors[0]}` : ""}${broken ? " · error de servidor" : ""}`);
}

async function firstLink(page: Page, list: string, pattern: RegExp): Promise<string | null> {
  await page.goto(`${base}${list}`, { waitUntil: "networkidle" });
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.find((h) => pattern.test(h)) ?? null;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MH_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    // Acceso de demostración con un toque (sin escribir credenciales)
    await page.goto(`${base}/login`);
    await page.getByRole("button", { name: /Entrar como Director general/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    console.log(`✓ acceso de demostración con un toque en ${base}`);
    const lists = ["/", "/inventory", "/inventory?view=table", "/imports", "/service", "/customers", "/deals", "/appraisals", "/contracts",
      "/contracts?tab=reservations", "/receivables", "/payments", "/treasury", "/payables", "/approvals", "/documents", "/reports", "/audit", "/admin"];
    for (const p of lists) await check(page, p);
    const details: Array<[string, RegExp]> = [["/inventory", /^\/inventory\/[0-9a-f-]{36}$/], ["/imports", /^\/imports\/[0-9a-f-]{36}$/],
      ["/customers", /^\/customers\/[0-9a-f-]{36}$/], ["/deals", /^\/deals\/[0-9a-f-]{36}$/], ["/appraisals", /^\/appraisals\/[0-9a-f-]{36}$/],
      ["/contracts", /^\/contracts\/[0-9a-f-]{36}$/], ["/receivables", /^\/receivables\/[0-9a-f-]{36}/], ["/documents", /^\/documents\/[0-9a-f-]{36}$/]];
    for (const [list, re] of details) {
      const href = await firstLink(page, list, re);
      if (href) await check(page, href); else { failures++; console.log(`✗ sin expedientes en ${list}`); }
    }
    const doc = await firstLink(page, "/documents", /^\/api\/documents\/[0-9a-f-]{36}\/pdf$/);
    if (doc) {
      const r = await page.request.get(`${base}${doc}`);
      const ok = r.status() === 200 && (r.headers()["content-type"] ?? "").includes("pdf");
      if (!ok) failures++;
      console.log(`${ok ? "✓" : "✗"} PDF ${r.status()}`);
    }

    // Negociación por la interfaz con la asesora
    const advisor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(advisor, "asesor1@motorhaus.demo");
    await advisor.goto(`${base}/deals/new`);
    const unitOptions = await advisor.locator('select[name="unit"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const custOptions = await advisor.locator('select[name="customer"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    await advisor.selectOption('select[name="unit"]', unitOptions[0]);
    await advisor.selectOption('select[name="customer"]', custOptions[0]);
    await advisor.getByRole("button", { name: "Crear y abrir mesa" }).click();
    await advisor.waitForURL(/\/deals\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await advisor.fill('input[name="cash_down"]', "10000");
    await advisor.getByRole("button", { name: "Guardar términos" }).click();
    await advisor.getByRole("status").filter({ hasText: /Términos guardados/ }).first().waitFor({ timeout: 20_000 });
    await advisor.fill('input[name="label"]', "Smoke");
    await advisor.getByRole("button", { name: "Guardar escenario" }).click();
    await advisor.getByRole("status").filter({ hasText: /validado por el servidor/ }).first().waitFor({ timeout: 20_000 });
    await advisor.reload();
    await advisor.getByText("Smoke", { exact: true }).first().waitFor({ timeout: 20_000 });
    console.log("✓ negociación creada, términos guardados y escenario validado por el servidor");
  } catch (e) {
    failures++;
    console.log(`✗ ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} problema(s)` : "\nDespliegue verificado sin errores");
  process.exitCode = failures ? 1 : 0;
})();
