// =============================================================================
// Prueba E2E por la interfaz: negociación → propuesta → formalización → cobro.
// Requiere: servidor en MH_BASE_URL (por defecto http://localhost:3000) con el
// seed de demostración cargado. Usa una unidad disponible distinta en cada corrida.
// =============================================================================
import { Browser, chromium, Page } from "playwright-core";
import { Pool } from "pg";

const base = process.env.MH_BASE_URL ?? "http://localhost:3000";
const password = process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026";
const admin = new Pool({ connectionString: process.env.MH_ADMIN_DATABASE_URL });
const steps: string[] = [];
const ok = (s: string) => { steps.push(`✓ ${s}`); console.log(`✓ ${s}`); };

async function login(browser: Browser, email: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => { throw new Error(`Error de página (${email}): ${e.message}`); });
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  return page;
}

async function poll(fn: () => Promise<boolean>, timeout = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await new Promise((r) => setTimeout(r, 300)); }
  throw new Error("La condición esperada no se cumplió a tiempo");
}

async function expectStatus(page: Page, text: RegExp) {
  await page.getByRole("status").filter({ hasText: text }).first().waitFor({ timeout: 20_000 });
}

(async () => {
  const unit = (await admin.query<{ id: string; stock_number: string }>(
    `select u.id, u.stock_number from units u where u.commercial_status = 'available' and u.currency = 'USD'
       and not exists (select 1 from deal_items di join deals d on d.id = di.deal_id where di.unit_id = u.id and d.status <> 'cancelled')
     order by u.list_price limit 1`)).rows[0];
  if (!unit) throw new Error("No hay unidades disponibles sin negociación; ejecute db:reset y db:seed");
  const customer = (await admin.query<{ id: string }>("select id from customers where display_name like 'Tomás Rivas%'")).rows[0];
  const browser = await chromium.launch({ executablePath: process.env.MH_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // 1. Asesora: crea la operación desde la unidad
    const sofia = await login(browser, "asesor1@motorhaus.demo");
    await sofia.goto(`${base}/deals/new?unit=${unit.id}&customer=${customer.id}`);
    await sofia.getByRole("button", { name: "Crear y abrir mesa" }).click();
    await sofia.waitForURL(/\/deals\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const dealId = sofia.url().split("/").pop()!;
    ok(`Operación creada para ${unit.stock_number}`);

    // 2. Términos: precio con 7 % de descuento y entrega inicial
    const list = Number((await admin.query("select list_price from units where id = $1", [unit.id])).rows[0].list_price);
    const price = Math.round(list * 0.93); // 7 % de descuento: supera el límite y exige autorización
    const down = Math.round(price * 0.35);
    await sofia.fill(`input[name="price_${unit.id}"]`, String(price));
    await sofia.fill('input[name="cash_down"]', String(down));
    await sofia.getByRole("button", { name: "Guardar términos" }).click();
    await expectStatus(sofia, /Términos guardados/);
    ok(`Términos guardados: precio ${price}, entrega ${down}`);

    // 3. Escenario de financiación (vista previa en vivo + validación en servidor)
    await sofia.fill('input[name="label"]', "E2E · Francés 24");
    await sofia.fill('input[name="rate_pct"]', "11.5");
    await sofia.getByText("Cuota", { exact: true }).first().waitFor();
    await sofia.getByRole("button", { name: "Guardar escenario" }).click();
    await expectStatus(sofia, /validado por el servidor/);
    await sofia.reload();
    await sofia.getByRole("button", { name: "Seleccionar" }).first().click();
    await sofia.getByText("Seleccionado").first().waitFor({ timeout: 20_000 });
    ok("Escenario calculado, validado por PostgreSQL y seleccionado");

    // 4. Envío a aprobación (dentro de política ⇒ aprobada) y propuesta PDF
    await sofia.getByRole("button", { name: "Enviar a aprobación" }).click();
    // El formulario desaparece al cambiar el estado: se espera la insignia de estado.
    await sofia.locator("h1").getByText(/Aprobada|Pendiente de aprobación/).waitFor({ timeout: 20_000 });
    let status = (await admin.query("select status from deals where id = $1", [dealId])).rows[0].status;
    if (status === "pending_approval") {
      const rules = (await admin.query("select rule from approvals where entity_id = $1 and status = 'pending'", [dealId])).rows.map((r) => r.rule);
      ok(`Fuera de política (${rules.join(", ")}): solicitudes de autorización generadas`);
      // La asesora no puede aprobar su propia excepción
      await sofia.goto(`${base}/approvals`);
      if (await sofia.getByRole("button", { name: "Aprobar" }).count() > 0) throw new Error("La asesora no debería poder aprobar");
      const gerente = await login(browser, "comercial@motorhaus.demo");
      for (let i = 0; i < rules.length; i++) {
        await gerente.goto(`${base}/approvals`);
        const item = gerente.locator("li").filter({ has: gerente.locator(`a[href="/deals/${dealId}"]`) }).first();
        await item.locator('input[name="note"]').fill("Autorizado: cliente recurrente (E2E)");
        const before = (await admin.query("select count(*)::int n from approvals where entity_id = $1 and status = 'pending'", [dealId])).rows[0].n;
        await item.getByRole("button", { name: "Aprobar" }).click();
        await poll(async () => (await admin.query("select count(*)::int n from approvals where entity_id = $1 and status = 'pending'", [dealId])).rows[0].n < before);
      }
      status = (await admin.query("select status from deals where id = $1", [dealId])).rows[0].status;
      ok("Gerente comercial autorizó desde la bandeja con fundamento registrado");
    }
    if (status !== "approved") throw new Error(`Se esperaba operación aprobada y quedó ${status}`);
    ok("Operación aprobada");
    await sofia.goto(`${base}/deals/${dealId}`);
    await sofia.getByRole("button", { name: "Emitir propuesta PDF" }).click();
    await sofia.waitForURL(/\/documents\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await sofia.getByText("Integridad verificada").waitFor();
    const docId = sofia.url().split("/").pop()!;
    const pdf = await sofia.request.get(`${base}/api/documents/${docId}/pdf`);
    if (pdf.status() !== 200 || !(pdf.headers()["content-type"] ?? "").includes("pdf")) throw new Error("La descarga del PDF falló");
    ok(`Propuesta emitida y PDF descargado (${(await pdf.body()).length} bytes)`);

    // 5. Un asesor no puede formalizar
    if (await sofia.goto(`${base}/deals/${dealId}`).then(() => sofia.getByRole("button", { name: "Formalizar operación" }).count()) > 0) {
      throw new Error("El asesor no debería ver la acción de formalizar");
    }
    ok("La acción de formalizar no está disponible para el asesor (y el servidor la rechazaría)");

    // 6. CFO formaliza con confirmación en dos pasos
    const cfo = await login(browser, "finanzas@motorhaus.demo");
    await cfo.goto(`${base}/deals/${dealId}`);
    await cfo.getByRole("button", { name: "Formalizar operación" }).click();
    await cfo.getByRole("button", { name: "Formalizar y generar obligaciones" }).click();
    await cfo.waitForURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const contractId = cfo.url().split("/").pop()!;
    const inst = (await admin.query("select count(*)::int n, sum(principal_amount) p from receivable_installments where contract_id = $1", [contractId])).rows[0];
    if (inst.n !== 25 || Number(inst.p) !== price) throw new Error(`Obligaciones inesperadas: ${inst.n} / ${inst.p}`);
    const u = (await admin.query("select commercial_status from units where id = $1", [unit.id])).rows[0];
    if (u.commercial_status !== "sold_pending_delivery") throw new Error("La unidad no quedó vendida");
    ok("Contrato formalizado: 25 obligaciones que reconcilian con el precio; unidad vendida pendiente de entrega");

    // 7. Cobranzas registra la entrega inicial
    const lucia = await login(browser, "cobranzas@motorhaus.demo");
    await lucia.goto(`${base}/payments/new?customer=${customer.id}&contract=${contractId}`);
    await lucia.fill('input[name="amount"]', String(down));
    await lucia.fill('input[name="reference"]', `E2E-${Date.now()}`);
    await lucia.getByRole("button", { name: "Revisar pago" }).click();
    await lucia.getByText("Revise antes de confirmar").waitFor();
    await lucia.getByRole("button", { name: "Registrar pago" }).click();
    await lucia.waitForURL(/\/payments\?focus=/, { timeout: 20_000 });
    const paymentId = new URL(lucia.url()).searchParams.get("focus")!;
    let bal = (await admin.query("select collected_confirmed, pending_reconciliation from contract_balances where contract_id = $1", [contractId])).rows[0];
    if (Number(bal.collected_confirmed) !== 0 || Number(bal.pending_reconciliation) !== down) throw new Error("Un pago pendiente no debe contar como cobrado");
    ok("Pago registrado como pendiente de conciliación: no cuenta como cobrado");

    // 8. CFO confirma el pago
    await cfo.goto(`${base}/payments?focus=${paymentId}`);
    await cfo.getByRole("button", { name: "Confirmar", exact: true }).first().click();
    await cfo.getByRole("button", { name: "Confirmar conciliación" }).click();
    await poll(async () => (await admin.query("select status from customer_payments where id = $1", [paymentId])).rows[0].status === "confirmed");
    bal = (await admin.query("select collected_confirmed from contract_balances where contract_id = $1", [contractId])).rows[0];
    if (Number(bal.collected_confirmed) !== down) throw new Error("El pago confirmado no se reflejó en el saldo");
    const mv = (await admin.query("select count(*)::int n from cash_movements where source_id = $1", [paymentId])).rows[0];
    if (mv.n !== 1) throw new Error("Falta el movimiento de caja del pago");
    ok("Pago confirmado: saldo del contrato y caja actualizados");

    // 9. Auditoría del recorrido
    const audit = (await admin.query("select count(*)::int n from audit_events where action in ('deal.submit','deal.formalize','payment.confirm') and (entity_id = $1 or entity_id = $2 or entity_id = $3)",
      [dealId, contractId, paymentId])).rows[0];
    if (audit.n < 3) throw new Error("Faltan eventos de auditoría");
    ok("Eventos de auditoría registrados para envío, formalización y confirmación");
    console.log(`\nE2E completo: ${steps.length} pasos verificados.`);
  } finally {
    await browser.close();
    await admin.end();
  }
})().catch((e) => { console.error("✗ E2E falló:", e.message); process.exitCode = 1; });
