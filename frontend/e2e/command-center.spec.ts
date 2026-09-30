import { expect, test } from "@playwright/test";
import { APP_HOME, kpi, newOwner, pickAirport, signUp } from "./support";

test("a new agency logs its first enquiry and fare scan and sees them on the Command Center", async ({ page }) => {
  await signUp(page, newOwner("command"), "India");

  const checklist = page.getByRole("region", { name: "Get set up" });
  await expect(checklist).toContainText("0 of 6 done");
  await expect(kpi(page, "Open enquiries")).toHaveAccessibleName(/^Open enquiries: 0(,|$)/);

  await page.getByRole("button", { name: "New enquiry", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New enquiry" });
  await pickAirport(dialog, "From", "DEL");
  await pickAirport(dialog, "To", "BOM");
  // The radios are visually hidden inside their labels, so click the label as a person would.
  const clientType = dialog.getByRole("radiogroup", { name: "Client type" });
  await clientType.getByText("New client", { exact: true }).click();
  await expect(clientType.getByRole("radio", { name: "New client" })).toBeChecked();
  await dialog.getByLabel("Client name").fill("Priya Sharma");
  await dialog.getByRole("button", { name: "Create enquiry" }).click();

  // Every run signs up a new agency, so its first enquiry is always E-0001.
  await expect(page.getByText("Enquiry E-0001 created")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(kpi(page, "Open enquiries")).toHaveAccessibleName(/^Open enquiries: 1(,|$)/);
  await expect(checklist.getByRole("button", { name: /^Add a client\s*\(done\)$/ })).toBeVisible();
  await expect(checklist).toContainText("1 of 6 done");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Fare search" }).click();
  await expect(page).toHaveURL(/\/app\/fares$/);
  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  await page.getByRole("button", { name: "Scan fares" }).click();
  await expect(page.getByRole("list", { name: "Flight offers" }).getByRole("article").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Command Center" }).click();
  await expect(page).toHaveURL(APP_HOME);
  await expect(kpi(page, "Searches")).toHaveAccessibleName(/^Searches: [1-9][\d,]*(,|$)/);
  await expect(page.getByRole("region", { name: "Live activity" }).getByText(/Searched DEL → BOM/)).toBeVisible();
  await expect(checklist.getByRole("link", { name: /^Run your first fare scan\s*\(done\)$/ })).toBeVisible();
});
