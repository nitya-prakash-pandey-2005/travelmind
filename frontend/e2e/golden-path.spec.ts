import { expect, test, type Page } from "@playwright/test";

// The second test signs in as the owner the first one creates, so they run (and retry) together.
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const owner = {
  agency: `E2E Travels ${stamp}`,
  name: "Esha Owner",
  email: `owner-${stamp}@e2etravels.com`,
  password: "e2e-password-123",
};

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Agency name").fill(owner.agency);
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create command deck" }).click();
  await expect(page.getByRole("banner").getByText(owner.agency)).toBeVisible();
}

async function pickAirport(page: Page, label: "From" | "To", code: string) {
  await page.getByRole("combobox", { name: label }).fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).first().click();
}

test("an owner plots a route, invites an agent, and the agent joins the crew", async ({ page, browser }) => {
  await signUp(page);

  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  // Real OurAirports coordinates (local dev) and the CI fixture CSVs differ by about a kilometre,
  // so the readouts are checked by shape: DEL→BOM is ~1,13x km and ~1h 5xm.
  const scanner = page.getByRole("region", { name: "Plot a route" });
  await expect(scanner.getByText(/^1,13\d\s?km$/)).toBeVisible();
  await expect(scanner.getByText(/^1h 5\dm$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent routes" }).getByText("DEL → BOM")).toBeVisible();

  // The dashboard also has an "Open crew roster" link; use the navigation rail's entry.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Crew roster" }).click();
  await page.getByLabel("Crew member email").fill(`agent-${stamp}@e2etravels.com`);
  await page.getByRole("button", { name: "Generate invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toContain("/invite/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Mission access" })).toBeVisible();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await agentPage.goto(link);
  await agentPage.getByLabel("Your name").fill("Arjun Agent");
  await agentPage.getByLabel("Password").fill("agent-password-123");
  await agentPage.getByRole("button", { name: "Join the crew" }).click();
  await expect(agentPage.getByRole("banner").getByText(owner.agency)).toBeVisible();

  await agentPage.keyboard.press("Control+k");
  await agentPage.getByPlaceholder(/command or an airport/i).fill("crew");
  await agentPage.keyboard.press("Enter");
  const table = agentPage.getByRole("table", { name: "Crew members" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(agentPage.getByText(/ask an agency owner or admin/i)).toBeVisible();
  await agentContext.close();
});

test("signed-out visitors are sent to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fteam/);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Engage" }).click();
  await expect(page).toHaveURL(/\/team$/);
});
