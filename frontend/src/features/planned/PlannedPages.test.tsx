import { screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

test.each([
  ["/app/quotes", "Quotes", [], [["Pipeline", "/app/pipeline"], ["Fare search", "/app/fares"]]],
  ["/app/clients", "Clients", [], [["Pipeline", "/app/pipeline"], ["Quotes", "/app/quotes"]]],
  ["/app/routes", "Route intel", [], [["Fare search", "/app/fares"], ["Command Center", "/app"]]],
  ["/app/settings", "Settings", [], [["Team", "/app/team"], ["Suppliers", "/app/suppliers"]]],
  ["/app/quotes/q-4", "Quote", ["Quotes"], [["Quotes", "/app/quotes"], ["Pipeline", "/app/pipeline"]]],
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

test("the client quote page stands alone: no app shell, no session needed, no data read yet", async () => {
  const { calls } = mockApi(withSession(null));
  const { router } = renderApp("/q/tok_abc");
  expect(await screen.findByRole("heading", { level: 1, name: "Your travel quote" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/q/tok_abc");
  expect(calls.some((call) => call.path.startsWith("/api/v1/public/quotes"))).toBe(false);
});
