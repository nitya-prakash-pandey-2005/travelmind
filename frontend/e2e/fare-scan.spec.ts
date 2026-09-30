import { expect, test } from "@playwright/test";
import { newOwner, pickAirport, signUp } from "./support";

test("an agent searches sandbox fares, verifies a price and checks the supplier connections", async ({ page }) => {
  await signUp(page, newOwner("fares"));

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Fare search" }).click();
  await expect(page).toHaveURL(/\/app\/fares$/);
  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  await page.getByRole("button", { name: "Scan fares" }).click();

  const board = page.getByRole("list", { name: "Flight offers" });
  await expect(board.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Supplier status" })).toContainText("sandbox · OK");
  const first = board.getByRole("article").first();
  await expect(first).toContainText("Sandbox · not bookable");
  await expect(first).toContainText(/₹[\d,]+/);

  await first.getByRole("button", { name: "Flight details" }).click();
  await expect(first.getByRole("button", { name: "Flight details" })).toHaveAttribute("aria-expanded", "true");

  await first.getByRole("button", { name: "Verify price" }).click();
  await expect(first.getByText(/Price confirmed/)).toBeVisible();

  await page.getByRole("button", { name: "Fastest" }).click();
  await expect(page.getByRole("button", { name: "Fastest" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Suppliers" }).click();
  await expect(page).toHaveURL(/\/app\/suppliers$/);
  const links = page.getByRole("table", { name: "Booking suppliers" });
  await expect(links.getByRole("row", { name: /Sandbox inventory/ })).toContainText("Connected");
});
