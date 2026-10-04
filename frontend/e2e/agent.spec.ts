import { expect, test, type Page } from "@playwright/test";
import { newOwner, signUp } from "./support";

// Runs against an API with the demo planner (TM_AGENT_PROVIDER=fake): plans are deterministic, use the
// sandbox flight supplier and run inline in development.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day `days` from today, as a person types it ("26 Oct 2026"). */
function dayAhead(days: number): string {
  const day = new Date(Date.now() + days * 86_400_000);
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

async function openAgent(page: Page) {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Agent" }).click();
  await expect(page).toHaveURL(/\/app\/agent$/);
  await expect(page.getByRole("heading", { level: 1, name: "Agent" })).toBeVisible();
  await expect(page.getByText("Demo planner", { exact: true })).toBeVisible();
}

async function plan(page: Page, request: string) {
  await page.getByRole("textbox", { name: "Trip request" }).fill(request);
  await page.getByRole("button", { name: "Plan trip" }).click();
  await expect(page).toHaveURL(/\/app\/agent\/[^/]+$/);
  await expect(page.getByRole("log", { name: "Plan trace" })).toBeVisible();
}

const VERIFIED = "All prices verified against live results";

test("an agent plans a trip and turns it into an enquiry after approval", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = newOwner("agent");
  await signUp(page, owner, "India");
  await openAgent(page);

  await plan(page, `Delhi to Mumbai for 2 adults, ${dayAhead(21)} to ${dayAhead(24)}, economy`);

  // The trace shows the steps the plan took.
  const trace = page.getByRole("log", { name: "Plan trace" });
  await expect(trace.getByRole("button", { name: /^Show details: Searching flights DEL → BOM/ })).toBeVisible({ timeout: 30_000 });
  await expect(trace.getByText("Plan summary")).toBeVisible();

  // The board is verified and carries the sandbox's flight cards.
  const board = page.getByRole("region", { name: "Plan board" });
  await expect(board.getByText(VERIFIED)).toBeVisible();
  await expect(board.getByRole("article", { name: /^F1 / })).toBeVisible();
  expect(await board.getByRole("article", { name: /^F\d+ / }).count()).toBeGreaterThan(1);

  // Create enquiry starts a new plan for the same trip, which waits for approval before saving.
  const firstPlan = page.url();
  await board.getByRole("button", { name: "Create enquiry" }).click();
  await expect(page).not.toHaveURL(firstPlan);
  const confirm = page.getByRole("region", { name: "Create enquiry" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm).toContainText("DEL → BOM");
  await confirm.getByRole("button", { name: "Approve" }).click();
  await expect(confirm).toBeHidden();

  // The answer cites the enquiry it created; the plan is still verified.
  await expect(page.getByRole("log", { name: "Plan trace" }).getByText(/Enquiry E-0001 is created for this trip\./)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "Plan board" }).getByText(VERIFIED)).toBeVisible();

  // The pipeline lists it under New.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/\/app\/pipeline$/);
  await expect(page.getByRole("list", { name: "New enquiries" }).getByRole("article", { name: "E-0001 DEL → BOM" })).toBeVisible();
});

test("an agent asks for what a request leaves out, then completes the plan", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = newOwner("agent-ask");
  await signUp(page, owner, "India");
  await openAgent(page);

  await plan(page, "I want to go to Dubai");

  // The question takes the answer box; the reply fills the gaps.
  const form = page.getByRole("form", { name: "Answer the question" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("log", { name: "Plan trace" })).toContainText("where you're travelling from");
  await form.getByRole("textbox", { name: "Your answer" }).fill(`From Delhi, ${dayAhead(21)} to ${dayAhead(24)}, 2 adults`);
  await form.getByRole("button", { name: "Send answer" }).click();
  await expect(form).toBeHidden();

  const board = page.getByRole("region", { name: "Plan board" });
  await expect(board.getByText(VERIFIED)).toBeVisible({ timeout: 30_000 });
  await expect(board.getByRole("article", { name: /^F1 / })).toBeVisible();
  await expect(page.getByRole("log", { name: "Plan trace" }).getByText(/Plan for DEL → DXB/)).toBeVisible();
});
