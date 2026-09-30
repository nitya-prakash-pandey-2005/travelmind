import { expect, type Page } from "@playwright/test";

export type Owner = { agency: string; name: string; email: string; password: string };

export function newOwner(tag: string): Owner {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    agency: `E2E ${tag} ${stamp}`,
    name: "Esha Owner",
    email: `owner-${tag}-${stamp}@e2etravels.com`,
    password: "e2e-password-123",
  };
}

export async function signUp(page: Page, owner: Owner) {
  await page.goto("/signup");
  await page.getByLabel("Agency name").fill(owner.agency);
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create command deck" }).click();
  await expect(page.getByRole("banner").getByText(owner.agency)).toBeVisible();
}

export async function pickAirport(page: Page, label: string, code: string) {
  await page.getByRole("combobox", { name: label }).fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).first().click();
}
