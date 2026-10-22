// Recorre todas las pantallas como un usuario y reporta estados HTTP y errores.
import { chromium } from "playwright-core";
import { Pool } from "pg";

const base = process.env.MH_BASE_URL ?? "http://localhost:3000";
const email = process.argv[2] ?? "direccion@motorhaus.demo";

(async () => {
  const admin = new Pool({ connectionString: process.env.MH_ADMIN_DATABASE_URL });
  const one = async (sql: string) => (await admin.query(sql)).rows[0]?.id as string | undefined;
  const ids = {
    unit: await one("select id from units where model = '280 SL'"),
    deal: await one("select id from deals where status = 'pending_approval' limit 1"),
    contract: await one("select id from sales_contracts order by contract_date limit 1 offset 3"),
    customer: await one("select customer_id id from sales_contracts order by contract_date limit 1 offset 3"),
    appraisal: await one("select id from trade_in_appraisals where status = 'pending_approval' limit 1"),
    shipment: await one("select id from shipments where reference = 'EMB-0398'"),
    doc: await one("select id from documents where kind = 'account_statement' limit 1"),
  };
  await admin.end();
  const paths = ["/", "/inventory", "/inventory?view=table", `/inventory/${ids.unit}`, "/inventory/new", "/imports", `/imports/${ids.shipment}`, "/service",
    "/customers", `/customers/${ids.customer}`, "/customers/new", "/deals", `/deals/${ids.deal}`, "/deals/new", "/appraisals", `/appraisals/${ids.appraisal}`, "/appraisals/new",
    "/contracts", "/contracts?tab=reservations", `/contracts/${ids.contract}`, "/receivables", `/receivables/${ids.customer}`, "/payments", `/payments/new?customer=${ids.customer}`,
    "/treasury", "/payables", "/approvals", "/approvals?tab=history", "/documents", `/documents/${ids.doc}`, "/reports", "/audit", "/admin"];
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text()); });
  await page.goto(`${base}/login`);
  if (await page.locator("details:not([open]) summary").count()) await page.locator("details summary").first().click();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  let failures = 0;
  for (const p of paths) {
    errors = [];
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const alert = await page.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => null);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const bad = (res?.status() ?? 0) >= 400 || errors.length > 0 || (alert && alert.includes("No se pudo"));
    if (bad) failures++;
    console.log(`${bad ? "✗" : "✓"} ${res?.status()} ${p}${hscroll ? " [scroll horizontal]" : ""}${errors.length ? `\n   ${errors.join("\n   ")}` : ""}${alert ? `\n   alerta: ${alert.slice(0, 160)}` : ""}`);
  }
  await browser.close();
  console.log(failures ? `${failures} pantalla(s) con problemas` : "Todas las pantallas cargaron sin errores");
  process.exitCode = failures ? 1 : 0;
})();
