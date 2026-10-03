import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { clientOut } from "../../test/workspaceFixtures";
import { mockApi, type MockCall, type MockHandler } from "../../test/mockApi";
import { renderApp } from "../../test/renderApp";
import { clientMocks, listClients } from "./clientFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

function clientsPage(extra: Record<string, MockHandler> = {}) {
  const api = mockApi(clientMocks(extra));
  return { ...api, ...renderApp("/app/clients") };
}

const listCalls = (calls: MockCall[]) => calls.filter((c) => c.method === "GET" && c.path === "/api/v1/clients");

test("the list shows every client with company, email, tags, counts and won value", async () => {
  clientsPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Clients" })).toBeInTheDocument();
  const table = await screen.findByRole("table", { name: "Clients" });
  await within(table).findByText("Priya Sharma");
  for (const header of ["Name", "Company", "Email", "Tags", "Enquiries", "Quotes", "Won value"]) {
    expect(within(table).getByRole("columnheader", { name: new RegExp(`^${header}`) })).toBeInTheDocument();
  }
  const row = within(table).getByText("Priya Sharma").closest("tr") as HTMLElement;
  expect(within(row).getByText("Sharma Exports")).toBeInTheDocument();
  expect(within(row).getByText("priya@example.com")).toBeInTheDocument();
  expect(within(row).getByText("vip")).toBeInTheDocument();
  expect(within(row).getByText("₹45,200")).toBeInTheDocument();
  const company = within(table).getByText("Orbit Logistics").closest("tr") as HTMLElement;
  expect(within(company).getByText("Company")).toBeInTheDocument();

  const figures = screen.getByRole("region", { name: "Client figures" });
  expect(within(figures).getByRole("group", { name: /^Clients: 3/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Won value: ₹45,200/ })).toBeInTheDocument();
});

test("search and the tag filter ask the server and narrow the rows", async () => {
  const { user, calls } = clientsPage();
  const table = await screen.findByRole("table", { name: "Clients" });
  await within(table).findByText("Rahul Mehta");

  await user.type(screen.getByRole("searchbox", { name: "Search clients" }), "sharma");
  await waitFor(() => expect(listCalls(calls).some((c) => c.search.get("q") === "sharma")).toBe(true));
  await waitFor(() => expect(within(table).queryByText("Rahul Mehta")).not.toBeInTheDocument());
  expect(await within(table).findByText("Priya Sharma")).toBeInTheDocument();
  expect(within(table).queryByText("Rahul Mehta")).not.toBeInTheDocument();

  await user.clear(screen.getByRole("searchbox", { name: "Search clients" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter by tag" }), "corporate");
  await waitFor(() => expect(listCalls(calls).some((c) => c.search.get("tag") === "corporate")).toBe(true));
  expect(await within(table).findByText("Orbit Logistics")).toBeInTheDocument();
  expect(within(table).queryByText("Rahul Mehta")).not.toBeInTheDocument();
  expect(within(table).getByText("Priya Sharma")).toBeInTheDocument();
});

test("a search with no match says so and clears", async () => {
  const { user } = clientsPage();
  const table = await screen.findByRole("table", { name: "Clients" });
  await within(table).findByText("Priya Sharma");
  await user.type(screen.getByRole("searchbox", { name: "Search clients" }), "zzz");
  expect(await within(table).findByText("No clients match “zzz”")).toBeInTheDocument();
  await user.click(within(table).getByRole("button", { name: "Clear search" }));
  expect(await within(table).findByText("Priya Sharma")).toBeInTheDocument();
});

test("New client posts the form and opens the new record", { timeout: 15_000 }, async () => {
  const created = clientOut("c-new", "Kavya Nair", {
    email: "kavya@example.com",
    home_airport: "BOM",
    tags: ["family"],
  });
  const { user, calls, router } = clientsPage({
    "POST /api/v1/clients": { status: 201, body: created },
    "GET /api/v1/clients/c-new": { status: 200, body: created },
    "GET /api/v1/clients/c-new/activity": { status: 200, body: { items: [] } },
  });
  await user.click(await screen.findByRole("button", { name: "New client" }));
  const drawer = screen.getByRole("dialog", { name: "New client" });
  await user.click(within(drawer).getByLabelText("Name"));
  await user.paste("Kavya Nair");
  await user.click(within(drawer).getByLabelText("Email"));
  await user.paste("kavya@example.com");
  await user.click(within(drawer).getByLabelText("Phone"));
  await user.paste("+91 99999 00000");
  await user.type(within(drawer).getByRole("combobox", { name: "Home airport" }), "BOM");
  await user.click(await within(drawer).findByRole("option", { name: /BOM/ }));
  await user.type(within(drawer).getByLabelText("Tags"), "Family{Enter}");
  expect(within(drawer).getByRole("button", { name: "Remove tag family" })).toBeInTheDocument();
  await user.click(within(drawer).getByLabelText("Notes"));
  await user.paste("Travels with two children.");
  await user.click(within(drawer).getByRole("button", { name: "Add client" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/app/clients/c-new"));
  const post = calls.find((c) => c.method === "POST" && c.path === "/api/v1/clients");
  expect(post?.body).toEqual({
    kind: "individual",
    name: "Kavya Nair",
    email: "kavya@example.com",
    phone: "+91 99999 00000",
    company_name: null,
    home_airport: "BOM",
    tags: ["family"],
    notes: "Travels with two children.",
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Kavya Nair" })).toBeInTheDocument();
});

test("the form needs a name before it posts", async () => {
  const { user, calls } = clientsPage();
  await user.click(await screen.findByRole("button", { name: "New client" }));
  const drawer = screen.getByRole("dialog", { name: "New client" });
  await user.click(within(drawer).getByRole("button", { name: "Add client" }));
  expect(within(drawer).getByLabelText("Name")).toHaveAccessibleDescription("Enter the client's name.");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("server validation errors show next to their fields", async () => {
  const { user } = clientsPage({
    "POST /api/v1/clients": {
      status: 422,
      body: {
        detail: "Some of the information you entered isn't valid.",
        errors: [
          { field: "email", message: "value is not a valid email address: An email address must have an @-sign." },
          { field: "phone", message: "String should have at most 40 characters" },
        ],
      },
    },
  });
  await user.click(await screen.findByRole("button", { name: "New client" }));
  const drawer = screen.getByRole("dialog", { name: "New client" });
  await user.type(within(drawer).getByLabelText("Name"), "Kavya Nair");
  await user.type(within(drawer).getByLabelText("Email"), "kavya");
  await user.click(within(drawer).getByRole("button", { name: "Add client" }));
  await waitFor(() =>
    expect(within(drawer).getByLabelText("Email")).toHaveAccessibleDescription("Enter a valid email address, like name@example.com."),
  );
  expect(within(drawer).getByLabelText("Phone")).toHaveAccessibleDescription("Enter a phone number of up to 40 characters.");
  expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument();
});

test("a duplicate email and an unknown airport are shown on their fields", async () => {
  let attempt = 0;
  const { user } = clientsPage({
    "POST /api/v1/clients": () => {
      attempt += 1;
      return attempt === 1
        ? { status: 409, body: { detail: "A client with this email already exists." } }
        : { status: 422, body: { detail: "Unknown airport code XYZ." } };
    },
  });
  await user.click(await screen.findByRole("button", { name: "New client" }));
  const drawer = screen.getByRole("dialog", { name: "New client" });
  await user.type(within(drawer).getByLabelText("Name"), "Priya Sharma");
  await user.type(within(drawer).getByLabelText("Email"), "priya@example.com");
  await user.click(within(drawer).getByRole("button", { name: "Add client" }));
  await waitFor(() =>
    expect(within(drawer).getByLabelText("Email")).toHaveAccessibleDescription("A client with this email already exists."),
  );
  await user.click(within(drawer).getByRole("button", { name: "Add client" }));
  expect(await within(drawer).findByText("Unknown airport code XYZ.")).toBeInTheDocument();
});

test("an agency without clients sees what a record holds and how to add one", async () => {
  const { user } = clientsPage({ "GET /api/v1/clients": listClients([]) });
  expect(await screen.findByText("No clients yet")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "What a client record holds" })).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "New client" })[0] as HTMLElement);
  expect(screen.getByRole("dialog", { name: "New client" })).toBeInTheDocument();
});
