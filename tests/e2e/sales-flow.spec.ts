import { expect, test } from "@playwright/test";
import { login, selectByText } from "./helpers";

test.describe.serial("Flujo comercial completo", () => {
  let dealUrl = "";
  let contractUrl = "";

  test("vendedor crea una operación financiada, la envía y genera la propuesta PDF", async ({ page }) => {
    await login(page, "vendedor");
    await page.goto("/ventas/nueva");
    await selectByText(page, "select[name=customer]", "Javier Acosta");
    await selectByText(page, "select[name=vehicle]", "CS35 Plus");
    await page.fill("#discount", "2.000.000");
    await page.fill("#down", "40.000.000");
    await page.getByLabel("Tasa (%)").fill("18");
    await expect(page.getByText("Cuota mensual")).toBeVisible();
    await expect(page.getByText("Requiere aprobación")).toHaveCount(0);

    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Propuesta PDF" }).click();
    const pdf = await popup;
    await pdf.waitForLoadState();
    expect(pdf.url()).toMatch(/\/api\/propuestas\//);
    const res = await page.request.get(pdf.url());
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
    await pdf.close();

    await page.getByRole("button", { name: "Guardar y enviar" }).click();
    await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Aprobada", { exact: true }).first()).toBeVisible();
    dealUrl = page.url();
  });

  test("el vendedor no puede formalizar ni ve costes", async ({ page }) => {
    await login(page, "vendedor");
    await page.goto(dealUrl);
    await expect(page.getByRole("button", { name: "Formalizar venta" })).toHaveCount(0);
    await expect(page.getByText("Rentabilidad de la operación")).toHaveCount(0);
  });

  test("administración formaliza: se genera contrato y la unidad queda vendida", async ({ page }) => {
    await login(page, "administracion");
    await page.goto(dealUrl);
    await page.getByRole("button", { name: "Formalizar venta" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Formalizar" }).click();
    await expect(page).toHaveURL(/\/financiaciones\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Saldos verificados")).toBeVisible();
    contractUrl = page.url();
    await page.goto("/inventario?q=CS35");
    await expect(page.locator("tbody").getByText("Vendido, pendiente de entrega").first()).toBeVisible();
  });

  test("cobranzas registra un pago que no cuenta hasta ser confirmado", async ({ page }) => {
    await login(page, "cobranzas");
    await page.goto(contractUrl);
    const before = await page.locator('[data-stat="c-out"]').innerText();
    await page.getByRole("button", { name: "Registrar pago" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("input[name=amount]").fill("40.000.000");
    await selectByText(page, "dialog select[name=cash_account_id]", "Banco cuenta Gs.");
    await dlg.locator("input[name=reference]").fill("E2E-TRF-001");
    await dlg.getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText(/pendiente de confirmación/)).toBeVisible();
    await page.reload();
    const after = await page.locator('[data-stat="c-out"]').innerText();
    expect(after).toBe(before);
  });

  test("administración confirma el pago y el saldo baja", async ({ page }) => {
    await login(page, "administracion");
    await page.goto("/cobranzas?vista=confirmar");
    const row = page.getByRole("row", { name: /E2E-TRF-001/ });
    await row.getByRole("button", { name: "Confirmar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Pago confirmado y aplicado")).toBeVisible();
    await page.goto(`${contractUrl}?tab=cuotas`);
    await expect(page.getByRole("row", { name: /Entrega inicial/ }).getByText("Pagada")).toBeVisible();
    await expect(page.getByText("Saldos verificados")).toBeVisible();
  });
});
