import { expect, test } from "@playwright/test";
import { newOwner, pickAirport, signUp } from "./support";

/** A departure three weeks out, as the date input wants it ("2026-10-24"). */
function departDate(): string {
  return new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
}

test("an agency quotes an enquiry, sends the link and the client accepts an option", async ({ page, browser }) => {
  // Two sandbox searches, a priced version and a second browser for the client.
  test.setTimeout(120_000);
  const owner = newOwner("quote");
  await signUp(page, owner, "India");

  // The enquiry, with a new client, from the Command Center.
  await page.getByRole("button", { name: "New enquiry", exact: true }).click();
  const enquiryDialog = page.getByRole("dialog", { name: "New enquiry" });
  await pickAirport(enquiryDialog, "From", "DEL");
  await pickAirport(enquiryDialog, "To", "BOM");
  await enquiryDialog.getByLabel("Depart", { exact: true }).fill(departDate());
  // The radios are visually hidden inside their labels, so click the label as a person would.
  await enquiryDialog.getByRole("radiogroup", { name: "Client type" }).getByText("New client", { exact: true }).click();
  await enquiryDialog.getByLabel("Client name").fill("Priya Sharma");
  await enquiryDialog.getByRole("button", { name: "Create enquiry" }).click();
  // Every run signs up a new agency, so its first enquiry is always E-0001.
  await expect(page.getByText("Enquiry E-0001 created")).toBeVisible();

  // The pipeline lists it under New.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/\/app\/pipeline$/);
  const card = page.getByRole("list", { name: "New enquiries" }).getByRole("article", { name: "E-0001 DEL → BOM" });
  await expect(card).toContainText("Priya Sharma");
  await card.getByRole("link", { name: "DEL → BOM" }).click();

  // The enquiry page starts the quote: the dialog knows the enquiry and takes the markup.
  await expect(page).toHaveURL(/\/app\/enquiries\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "E-0001" })).toBeVisible();
  // The header and the empty Quotes panel both offer it.
  await page.getByRole("button", { name: "Create quote" }).first().click();
  const quoteDialog = page.getByRole("dialog", { name: "New quote" });
  await expect(quoteDialog).toContainText("For E-0001 · DEL → BOM");
  await expect(quoteDialog.getByRole("radio", { name: "Percent" })).toBeChecked();
  await quoteDialog.getByLabel("Markup (%)").fill("10");
  await quoteDialog.getByRole("button", { name: "Create quote" }).click();
  await expect(page).toHaveURL(/\/app\/quotes\/[^/]+$/);
  const quoteHeading = page.getByRole("heading", { level: 1, name: /^Q-/ });
  await expect(quoteHeading).toBeVisible();
  const quoteNumber = (await quoteHeading.textContent())?.trim() ?? "";

  // The editor searches the enquiry's trip; two sandbox offers go into the version.
  await page.getByRole("button", { name: "Scan fares" }).click();
  const offers = page.getByRole("list", { name: "Flight offers" });
  await expect(offers.getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(offers.getByRole("article").first()).toContainText("Sandbox · not bookable");
  const addable = offers.getByRole("checkbox", { name: "Add to quote", disabled: false });
  await addable.nth(0).check();
  await addable.nth(1).check();
  await expect(page.getByRole("list", { name: "Options in this version" }).getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("Version 1 saved")).toBeVisible();
  const figures = page.getByRole("region", { name: "Quote figures" });
  await expect(figures.getByRole("group", { name: /^Markup: 10\s?%/ })).toBeVisible();

  // Sending shows the client link once.
  await page.getByRole("button", { name: "Send to client" }).click();
  const sendDialog = page.getByRole("dialog", { name: `Send ${quoteNumber} to the client` });
  await expect(sendDialog).toContainText("Version 1 · 2 options · for Priya Sharma");
  await sendDialog.getByRole("button", { name: "Create link" }).click();
  const linkField = sendDialog.getByLabel("Client link");
  await expect(linkField).toHaveValue(/\/q\/[^/]+$/);
  const link = await linkField.inputValue();
  // Closing before copying asks first.
  await sendDialog.getByRole("button", { name: "Done" }).click();
  await sendDialog.getByRole("button", { name: "Close without copying" }).click();
  await expect(sendDialog).toBeHidden();
  await expect(figures.getByRole("group", { name: /^Status: Sent/ })).toBeVisible();

  // The client opens the link in a browser with no session and accepts option 1.
  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  await clientPage.goto(link);
  await expect(clientPage.getByRole("heading", { level: 1, name: "Hello Priya," })).toBeVisible();
  await expect(clientPage.getByRole("article", { name: /Option 1/ })).toBeVisible();
  await expect(clientPage.getByRole("article", { name: /Option 2/ })).toBeVisible();
  await expect(clientPage.getByText("Indicative price — confirm with your travel agent").first()).toBeVisible();
  // Nothing internal: no agent details.
  await expect(clientPage.locator("body")).not.toContainText(owner.name);
  await expect(clientPage.locator("body")).not.toContainText(owner.email);

  await clientPage.getByRole("button", { name: "Accept option 1" }).click();
  const decision = clientPage.getByRole("dialog", { name: "Accept option 1?" });
  await decision.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(clientPage.getByRole("heading", { name: `Thanks — ${owner.agency} has been notified.` })).toBeVisible();
  await expect(clientPage.getByRole("button", { name: /^Accept option/ })).toHaveCount(0);
  await clientContext.close();

  // Back in the app: the quote is accepted and its enquiry won.
  await page.reload();
  await expect(figures.getByRole("group", { name: /^Status: Accepted/ })).toBeVisible();
  await page.getByRole("link", { name: "E-0001 DEL → BOM" }).click();
  await expect(page).toHaveURL(/\/app\/enquiries\/[^/]+$/);
  const enquiryTitle = page.getByRole("heading", { level: 1, name: "E-0001" });
  // The status pill sits next to the title.
  await expect(enquiryTitle.locator("xpath=..")).toContainText("Won");
  const quotes = page.getByRole("table", { name: "Quotes for E-0001" });
  await expect(quotes.getByRole("row", { name: new RegExp(quoteNumber) })).toContainText("Accepted");

  await nav.getByRole("link", { name: "Pipeline" }).click();
  await expect(page.getByRole("list", { name: "Won enquiries" }).getByRole("article", { name: "E-0001 DEL → BOM" })).toBeVisible();
});
