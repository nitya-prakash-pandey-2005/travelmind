import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { makeOffer, searchResponse } from "../../test/offerFixtures";
import { renderApp, withSession } from "../../test/renderApp";
import { commandCenterMocks } from "../../test/workspaceFixtures";
import type { GlobeArc } from "../../features/globe/RouteGlobe";
import { routeStore } from "../../features/route/routeStore";
import { THEMES } from "../palettes";
import { STORAGE_KEY } from "../storage";
import { initTheme } from "../store";

vi.mock("../../features/globe/webgl", () => ({ hasWebGL: () => true }));
vi.mock("../../features/globe/RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => <div data-testid="globe">{arcs.length}</div>,
}));

const FACTS = { airports: 8801, suppliers: [{ kind: "flights", connected: 1 }], routes_with_history: 42 };
const inr = (amount_minor: number) => ({ amount_minor, currency: "INR" });
const OFFER = makeOffer({ id: "sandbox~a", total: inr(420000), display_total: inr(420000) });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error");
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

/** As on a real page load: the saved choice is read before the app renders. */
function loadSavedTheme(theme: string) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, mode: "dark", contrast: false }));
  initTheme();
  expect(document.documentElement.dataset.theme).toBe(theme);
}

describe.each(THEMES.map((theme) => [theme.name, theme] as const))("%s", (name, theme) => {
  test("landing renders with the switcher in its header", async () => {
    loadSavedTheme(theme.id);
    mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: FACTS } }));
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("8,801")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Theme: ${name}` })).toBeInTheDocument();
  });

  test("Command Center renders every panel", async () => {
    loadSavedTheme(theme.id);
    mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
    renderApp("/app");
    expect(await screen.findByRole("heading", { level: 1, name: "Command Center" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: /Open enquiries/ })).toHaveTextContent("12");
    await waitFor(() => expect(screen.getByRole("region", { name: "Pipeline" })).not.toHaveAttribute("aria-busy"));
    expect(within(screen.getByRole("banner")).getByRole("button", { name: `Theme: ${name}` })).toBeInTheDocument();
  });

  test("Fare search renders results", async () => {
    loadSavedTheme(theme.id);
    mockApi(withSession(ME_OWNER, { "POST /api/v1/flights/search": { status: 200, body: searchResponse({ offers: [OFFER] }) } }));
    const { user } = renderApp("/app/fares");
    await user.click(await screen.findByRole("button", { name: "Scan fares" }));
    const list = await screen.findByRole("list", { name: "Flight offers" });
    expect(within(list).getAllByRole("article")).toHaveLength(1);
  });
});

test("the user menu's theme entry opens the theme list in a dialog (the phone route)", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: false })));
  const { user } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: ME_OWNER.user.full_name }));
  await user.click(screen.getByRole("menuitem", { name: "Theme: Orbital" }));
  const dialog = screen.getByRole("dialog", { name: "Theme" });
  const list = within(dialog).getByRole("listbox", { name: "Theme" });
  expect(list).toHaveFocus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(document.documentElement.dataset.theme).toBe("nebula");
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog", { name: "Theme" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: ME_OWNER.user.full_name })).toHaveFocus();
});
