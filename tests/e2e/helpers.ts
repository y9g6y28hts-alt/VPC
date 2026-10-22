import { expect, type Page } from "@playwright/test";

export const PASSWORD = "DemoDaSilva2026!";

export async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto("/ingresar");
  // Demo autónoma (sin DATABASE_URL): se elige el usuario, sin contraseña.
  const demoButton = page.locator(`button[data-email="${user}@demo.dasilva.local"]`);
  if (await demoButton.count()) {
    await demoButton.click();
    await expect(page).not.toHaveURL(/ingresar/);
    return;
  }
  await page.fill("#email", `${user}@demo.dasilva.local`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).not.toHaveURL(/ingresar/);
}

/** Selecciona una opción de un <select> por coincidencia parcial del texto. */
export async function selectByText(page: Page, selector: string, text: string) {
  const value = await page.locator(`${selector} option`, { hasText: text }).first().getAttribute("value");
  if (!value) throw new Error(`Opción «${text}» no encontrada en ${selector}`);
  await page.selectOption(selector, value);
}
