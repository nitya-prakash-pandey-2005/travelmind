import { expect, type Locator, type Page } from "@playwright/test";

export type Owner = { agency: string; name: string; email: string; password: string };

/** Signed-in people land on the Command Center at /app. */
export const APP_HOME = /\/app\/?$/;

export function newOwner(tag: string): Owner {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    agency: `E2E ${tag} ${stamp}`,
    name: "Esha Owner",
    email: `owner-${tag}-${stamp}@e2etravels.com`,
    password: "e2e-password-123",
  };
}

/** Creates the agency (in `country` when given, else the form's default) and waits for the Command Center. */
export async function signUp(page: Page, owner: Owner, country?: string) {
  await page.goto("/signup");
  await page.getByLabel("Agency name").fill(owner.agency);
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  if (country) await page.getByLabel("Country").selectOption({ label: country });
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(APP_HOME);
  await expect(page.getByRole("banner").getByText(owner.agency)).toBeVisible();
}

/** Signs out from the account menu in the top bar (the button is named after the user). */
export async function signOut(page: Page, fullName: string) {
  await page.getByRole("banner").getByRole("button", { name: fullName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Picks an airport in the `label` combobox within `scope` (the page, or a dialog or panel on it). */
export async function pickAirport(scope: Page | Locator, label: string, code: string) {
  await scope.getByRole("combobox", { name: label }).fill(code);
  await scope.getByRole("option", { name: new RegExp(code) }).first().click();
}

/** A key figure on the Command Center, by its label ("Open enquiries"); its name carries the value. */
export function kpi(page: Page, label: string): Locator {
  return page.getByRole("region", { name: "Key figures" }).getByRole("group", { name: new RegExp(`^${label}: `) });
}
