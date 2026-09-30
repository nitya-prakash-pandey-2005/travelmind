import { expect, test } from "@playwright/test";
import { APP_HOME, pickAirport, signOut, signUp } from "./support";

// The second test signs in as the owner the first one creates, so they run (and retry) together.
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const owner = {
  agency: `E2E Travels ${stamp}`,
  name: "Esha Owner",
  email: `owner-${stamp}@e2etravels.com`,
  password: "e2e-password-123",
};

test("an owner plots a route, invites an agent, and the agent joins the crew", async ({ page, browser }) => {
  await signUp(page, owner);

  // The route scanner sits on the Command Center.
  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  // Real OurAirports coordinates (local dev) and the CI fixture CSVs differ by about a kilometre,
  // so the readouts are checked by shape: DEL→BOM is ~1,13x km and ~1h 5xm.
  const scanner = page.getByRole("region", { name: "Plot a route" });
  await expect(scanner.getByText(/^1,13\d\s?km$/)).toBeVisible();
  await expect(scanner.getByText(/^1h 5\dm$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent routes" }).getByText("DEL → BOM")).toBeVisible();

  // The Command Center may link to the roster too; use the sidebar's entry.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(/\/app\/team$/);
  await page.getByLabel("Crew member email").fill(`agent-${stamp}@e2etravels.com`);
  await page.getByRole("button", { name: "Generate invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toContain("/invite/");

  await signOut(page, owner.name);
  await expect(page.getByRole("heading", { name: "Mission access" })).toBeVisible();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await agentPage.goto(link);
  await agentPage.getByLabel("Your name").fill("Arjun Agent");
  await agentPage.getByLabel("Password").fill("agent-password-123");
  await agentPage.getByRole("button", { name: "Join the crew" }).click();
  await expect(agentPage).toHaveURL(APP_HOME);
  await expect(agentPage.getByRole("banner").getByText(owner.agency)).toBeVisible();

  await agentPage.keyboard.press("Control+k");
  await agentPage.getByPlaceholder(/command or an airport/i).fill("crew");
  await agentPage.keyboard.press("Enter");
  await expect(agentPage).toHaveURL(/\/app\/team$/);
  const table = agentPage.getByRole("table", { name: "Crew members" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(agentPage.getByText(/ask an agency owner or admin/i)).toBeVisible();
  await agentContext.close();
});

test("signed-out visitors are sent to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/app/team");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp%2Fteam/);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Engage" }).click();
  await expect(page).toHaveURL(/\/app\/team$/);
});
