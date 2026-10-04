import { expect, test } from "@playwright/test";
import { APP_HOME, kpi } from "./support";

test("a visitor explores the live demo from the landing page and exits back to it", async ({ page }) => {
  // Building the demo prices its sample trips with real sandbox searches, which takes a while.
  test.setTimeout(150_000);

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

  // Market pulse and supplier health are tables: row 0 is the header, row 1 the first data row.
  const marketRow = page.getByRole("region", { name: "Market pulse" }).getByRole("row").nth(1);
  const supplierRow = page.getByRole("region", { name: "Supplier health" }).getByRole("row").nth(1);
  await expect(marketRow.or(supplierRow).first()).toBeVisible();

  // The sample data fills the rest of the workspace too.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/\/app\/pipeline$/);
  await expect(page.getByRole("region", { name: "Pipeline totals" }).getByRole("group", { name: /^Open enquiries: [1-9]/ })).toBeVisible();
  await expect(page.getByRole("list", { name: /^(New|Quoting|Quoted|Won|Lost) enquiries$/ }).getByRole("article").first()).toBeVisible();

  // Data tables: row 0 is the header, row 1 the first record.
  await nav.getByRole("link", { name: "Quotes" }).click();
  await expect(page).toHaveURL(/\/app\/quotes$/);
  await expect(page.getByRole("table", { name: "Quotes" }).getByRole("row").nth(1)).toBeVisible();

  await nav.getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(/\/app\/clients$/);
  await expect(page.getByRole("table", { name: "Clients" }).getByRole("row").nth(1)).toBeVisible();

  // Route intel suggests the demo's own routes; the first was searched, so it has fare history.
  await nav.getByRole("link", { name: "Route intel" }).click();
  await expect(page).toHaveURL(/\/app\/routes/);
  const yourRoutes = page.getByRole("region", { name: "Your routes" });
  await expect(yourRoutes).toContainText("Routes your agency searched or has enquiries for");
  await yourRoutes.getByRole("button").first().click();
  await expect(page).toHaveURL(/[?&]origin=[A-Z]{3}/);
  await expect(page.getByRole("region", { name: "Route figures" }).getByRole("group", { name: /^Fares seen: [1-9]/ })).toBeVisible();

  // Settings are shown but read-only in a demo.
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByText("Demo · read-only")).toBeVisible();
  const profile = page.getByRole("form", { name: "Agency profile" });
  await expect(profile).toContainText("Demo workspaces can't change settings.");
  await expect(profile.getByLabel("Agency name")).toHaveValue(/\S/);
  await expect(profile.getByLabel("Agency name")).toBeDisabled();

  await page.getByRole("region", { name: "Demo workspace" }).getByRole("button", { name: "Exit demo" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "Open demo workspace", exact: true })).toBeVisible();

  // The demo session is gone: the app sends the visitor to sign in.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});
