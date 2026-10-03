import { screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

test.each([
  ["/app/clients", "Clients", [], [["Pipeline", "/app/pipeline"], ["Quotes", "/app/quotes"]]],
  ["/app/routes", "Route intel", [], [["Fare search", "/app/fares"], ["Command Center", "/app"]]],
  ["/app/settings", "Settings", [], [["Team", "/app/team"], ["Suppliers", "/app/suppliers"]]],
  ["/app/clients/c-1", "Client", ["Clients"], [["Clients", "/app/clients"], ["Pipeline", "/app/pipeline"]]],
] as const)("%s shows a titled page that says what is coming", async (path, title, crumbs, links) => {
  mockApi(withSession(ME_OWNER));
  renderApp(path);
  const main = await screen.findByRole("main");
  expect(await within(main).findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  const coming = within(main).getByRole("region", { name: "In this release" });
  expect(within(coming).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  const related = within(main).getByRole("navigation", { name: "Related pages" });
  for (const [name, href] of links) {
    expect(within(related).getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  }
  if (crumbs.length > 0) {
    const trail = within(main).getByRole("navigation", { name: "Breadcrumb" });
    for (const crumb of crumbs) expect(within(trail).getByRole("link", { name: crumb })).toBeInTheDocument();
  }
  expect(main.textContent).not.toMatch(/lorem|todo|tbd/i);
});
