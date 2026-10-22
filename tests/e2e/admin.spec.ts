import { expect, test } from "@playwright/test";
import { login, selectByText } from "./helpers";

test.describe.serial("Administración, reportes y auditoría", () => {
  const email = `nuevo.${Date.now()}@demo.dasilva.local`;
  const initialPassword = "ClaveInicial-2026";

  test("el administrador técnico da de alta un usuario y no puede asignar «director»", async ({ page }) => {
    await login(page, "tecnico");
    await page.goto("/configuracion?vista=usuarios");
    await page.getByRole("button", { name: "Nuevo usuario" }).click();
    await expect(page.locator("#u-role option", { hasText: "Director" })).toHaveCount(0);
    await page.fill("#u-name", "Usuario Prueba E2E");
    await page.fill("#u-email", email);
    await selectByText(page, "#u-role", "Cobranzas");
    await page.fill("#u-pass", initialPassword);
    await page.getByRole("button", { name: "Crear usuario" }).click();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  });

  test("el nuevo usuario ingresa con su rol y cambia su contraseña", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/ingresar");
    await page.fill("#email", email);
    await page.fill("#password", initialPassword);
    await page.click("button[type=submit]");
    await expect(page).not.toHaveURL(/ingresar/);
    await expect(page.getByRole("link", { name: "Cobranzas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Configuración" })).toHaveCount(0);

    await page.goto("/cuenta");
    await page.fill("#p-cur", "incorrecta-000");
    await page.fill("#p-new", "NuevaClave-2026-x");
    await page.fill("#p-conf", "NuevaClave-2026-x");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByText("La contraseña actual no es correcta")).toBeVisible();
    await page.fill("#p-cur", initialPassword);
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByText("Contraseña actualizada")).toBeVisible();
  });

  test("el director exporta un reporte y la exportación queda en la auditoría", async ({ page }) => {
    await login(page, "director");
    await page.goto("/reportes?r=deudas");
    const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("DATOS DE DEMOSTRACIÓN");
    expect(csv).toContain("Contrato;Cliente;Tramo");

    await page.goto("/auditoria?accion=reporte_exportado");
    await expect(page.getByText("Exportación de «deudas»").first()).toBeVisible();
  });

  test("administración ve reportes pero no puede exportar", async ({ page }) => {
    await login(page, "administracion");
    await page.goto("/reportes?r=deudas");
    await expect(page.getByRole("heading", { name: "Deudas por antigüedad" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);
    const res = await page.request.get("/api/reportes/deudas");
    expect(res.status()).toBe(403);
  });

  test("el director cambia un parámetro y queda auditado", async ({ page }) => {
    await login(page, "director");
    await page.goto("/configuracion");
    await page.fill("#s-res", "10");
    await page.getByRole("button", { name: "Guardar parámetros" }).click();
    await expect(page.getByText("Parámetros guardados")).toBeVisible();
    await page.goto("/auditoria?entidad=org_settings");
    await expect(page.getByText("reservation_default_days").first()).toBeVisible();
    // Restablece el valor original para no afectar otras pruebas.
    await page.goto("/configuracion");
    await page.fill("#s-res", "7");
    await page.getByRole("button", { name: "Guardar parámetros" }).click();
    await expect(page.getByText("Parámetros guardados")).toBeVisible();
  });

  test("un vendedor no accede a reportes, auditoría ni configuración", async ({ page }) => {
    await login(page, "vendedor");
    for (const path of ["/reportes", "/auditoria", "/configuracion"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/sin-acceso/);
    }
  });
});
