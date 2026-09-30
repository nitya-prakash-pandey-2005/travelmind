import { expect, test } from "@playwright/test";
import { APP_HOME, kpi } from "./support";

test("a visitor explores the live demo from the landing page and exits back to it", async ({ page }) => {
  // Building the demo prices its sample trips with real sandbox searches, which takes a while.
  test.setTimeout(120_000);

  await page.goto("/");
  // Repeated calls to action carry extra screen-reader context; the hero's is the plain one.
  await page.getByRole("link", { name: "Open demo workspace", exact: true }).click();
  await expect(page).toHaveURL(APP_HOME, { timeout: 60_000 });

  await expect(page.getByRole("banner").getByText("Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Demo workspace" })).toContainText("demo workspace with sample data");

  // A number above zero, however it is grouped ("12", "1,204").
  await expect(kpi(page, "Open enquiries")).toHaveAccessibleName(/^Open enquiries: [1-9][\d,]*(,|$)/);

  const activity = page.getByRole("region", { name: "Live activity" }).getByRole("list", { name: "Recent activity" });
  await expect(activity.getByRole("listitem").nth(4)).toBeVisible();

  const marketRows = page.getByRole("region", { name: "Market pulse" }).getByRole("listitem");
  const supplierRows = page.getByRole("region", { name: "Supplier health" }).getByRole("listitem");
  await expect(marketRows.or(supplierRows).first()).toBeVisible();

  await page.getByRole("region", { name: "Demo workspace" }).getByRole("button", { name: "Exit demo" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "Open demo workspace", exact: true })).toBeVisible();

  // The demo session is gone: the app sends the visitor to sign in.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});
