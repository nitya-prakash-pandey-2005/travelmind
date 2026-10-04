import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { EnquiryOut } from "../../api/enquiries";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { renderApp } from "../../test/renderApp";
import { clientOut, enquiryOut } from "../../test/workspaceFixtures";
import { routeStore } from "../route/routeStore";
import { PRIYA, PRIYA_ENQUIRIES, clientMocks, listEnquiries } from "./clientFixtures";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

beforeEach(() => routeStore.reset());

function clientPage(extra: Record<string, MockHandler> = {}, id = "c-priya") {
  const api = mockApi(clientMocks(extra));
  return { ...api, ...renderApp(`/app/clients/${id}`) };
}

test("the record shows the header, contact card, figures, enquiries, quotes and timeline", async () => {
  clientPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Priya Sharma" })).toBeInTheDocument();
  const main = screen.getByRole("main");
  const trail = within(main).getByRole("navigation", { name: "Breadcrumb" });
  expect(within(trail).getByRole("link", { name: "Clients" })).toHaveAttribute("href", "/app/clients");
  expect(within(main).getAllByText("Individual").length).toBeGreaterThan(0);
  expect(within(main).getAllByText("vip").length).toBeGreaterThan(0);

  const contact = within(main).getByRole("region", { name: "Contact" });
  expect(within(contact).getByRole("link", { name: "priya@example.com" })).toHaveAttribute("href", "mailto:priya@example.com");
  expect(within(contact).getByRole("link", { name: "+91 98100 12345" })).toHaveAttribute("href", "tel:+919810012345");
  expect(within(contact).getByText("Sharma Exports")).toBeInTheDocument();
  expect(within(contact).getByText("DEL")).toBeInTheDocument();
  expect(within(contact).getByText("Prefers aisle seats and morning departures.")).toBeInTheDocument();

  const figures = within(main).getByRole("region", { name: "Client figures" });
  expect(within(figures).getByRole("group", { name: /^Enquiries: 2/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Quotes: 2/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Won value: ₹45,200/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Last trip: DEL → BOM/ })).toBeInTheDocument();
  expect(within(figures).getByRole("group", { name: /^Next trip: DEL → GOI/ })).toBeInTheDocument();

  const enquiries = within(main).getByRole("region", { name: "Enquiries" });
  expect(await within(enquiries).findAllByRole("link", { name: "E-0005" })).not.toHaveLength(0);
  expect(within(enquiries).getAllByRole("link", { name: "E-0005" })[0]).toHaveAttribute("href", "/app/enquiries/e-5");
  expect(within(enquiries).queryByText("E-0009")).not.toBeInTheDocument();

  const quotes = within(main).getByRole("region", { name: "Quotes" });
  expect((await within(quotes).findAllByRole("link", { name: "Q-0004" }))[0]).toHaveAttribute("href", "/app/quotes/q-4");
  expect(within(quotes).getAllByText("Accepted").length).toBeGreaterThan(0);

  const timeline = within(main).getByRole("region", { name: "Timeline" });
  expect(await within(timeline).findByText("Added client Priya Sharma")).toBeInTheDocument();
});

test("a client without history says what will fill each section", async () => {
  clientPage({}, "c-rahul");
  expect(await screen.findByRole("heading", { level: 1, name: "Rahul Mehta" })).toBeInTheDocument();
  const quotes = screen.getByRole("region", { name: "Quotes" });
  expect(await within(quotes).findByText("No quotes yet")).toBeInTheDocument();
  expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  const contact = screen.getByRole("region", { name: "Contact" });
  expect(within(contact).getByText("No phone number")).toBeInTheDocument();
});

test("Edit saves only the changed fields", async () => {
  const { user, calls } = clientPage({
    "PATCH /api/v1/clients/c-priya": (call) => ({ status: 200, body: { ...PRIYA, ...(call.body as object) } }),
  });
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const drawer = screen.getByRole("dialog", { name: "Edit Priya Sharma" });
  expect(within(drawer).getByLabelText("Name")).toHaveValue("Priya Sharma");
  expect(within(drawer).getByRole("button", { name: "Remove tag vip" })).toBeInTheDocument();
  await user.clear(within(drawer).getByLabelText("Phone"));
  await user.type(within(drawer).getByLabelText("Phone"), "+91 98100 99999");
  await user.click(within(drawer).getByRole("button", { name: "Remove tag vip" }));
  await user.click(within(drawer).getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Priya Sharma" })).not.toBeInTheDocument());
  const patch = calls.find((c) => c.method === "PATCH");
  expect(patch?.body).toEqual({ phone: "+91 98100 99999", tags: ["corporate"] });
  expect(await screen.findByText("Changes saved")).toBeInTheDocument();
});

test("Delete explains the 409 inline when the client has quotes", async () => {
  const { user, router } = clientPage({
    "DELETE /api/v1/clients/c-priya": { status: 409, body: { detail: "This client has quotes, so it can't be deleted." } },
  });
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete Priya Sharma?" });
  await user.click(within(dialog).getByRole("button", { name: "Delete client" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("This client has quotes, so it can't be deleted.");
  expect(router.state.location.pathname).toBe("/app/clients/c-priya");
});

test("Delete removes a client without quotes and returns to the list", async () => {
  const { user, router, calls } = clientPage(
    { "DELETE /api/v1/clients/c-rahul": { status: 204 } },
    "c-rahul",
  );
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete Rahul Mehta?" });
  await user.click(within(dialog).getByRole("button", { name: "Delete client" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/clients"));
  expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/clients/c-rahul")).toBe(true);
  expect(await screen.findByText("Rahul Mehta deleted")).toBeInTheDocument();
});

test("New enquiry opens the Command Center dialog with the client already picked", async () => {
  const { user, calls } = clientPage();
  await user.click(await screen.findByRole("button", { name: "New enquiry" }));
  const dialog = screen.getByRole("dialog", { name: "New enquiry" });
  expect(within(dialog).getByText("Priya Sharma")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Change client" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  expect(await screen.findByText("Enquiry E-0007 created")).toBeInTheDocument();
  const post = calls.find((c) => c.method === "POST" && c.path === "/api/v1/enquiries");
  expect(post?.body).toMatchObject({ client_id: "c-priya" });
});

test("an unknown client shows a not-found state with a way back", async () => {
  clientPage({ "GET /api/v1/clients/c-gone": { status: 404, body: { detail: "Client not found." } } }, "c-gone");
  expect(await screen.findByText("Client not found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to clients" })).toHaveAttribute("href", "/app/clients");
});

test("the enquiries panel asks the server for this client's enquiries by id", async () => {
  const { calls } = clientPage();
  await screen.findByRole("heading", { level: 1, name: "Priya Sharma" });
  const enquiries = screen.getByRole("region", { name: "Enquiries" });
  expect(await within(enquiries).findAllByRole("link", { name: "E-0005" })).not.toHaveLength(0);
  const list = calls.find((c) => c.method === "GET" && c.path === "/api/v1/enquiries");
  expect(list?.search.get("client_id")).toBe("c-priya");
  expect(list?.search.get("q")).toBeNull();
  expect(within(enquiries).getByText(/^2 for Priya Sharma/)).toBeInTheDocument();
});

test("a client whose name reads like an enquiry number still lists its enquiries", async () => {
  const named = clientOut("c-e12", "E-12", { enquiry_count: 1 });
  const theirs = enquiryOut({ id: "e-31", number: "E-0031", origin: "BLR", destination: "SIN", status: "new", client: { id: "c-e12", name: "E-12" } });
  const numbered = enquiryOut({ id: "e-12", number: "E-0012", origin: "DEL", destination: "DXB", status: "new", client: { id: "c-priya", name: "Priya Sharma" } });
  clientPage(
    {
      "GET /api/v1/clients/c-e12": { status: 200, body: named },
      "GET /api/v1/clients/c-e12/activity": { status: 200, body: { items: [] } },
      "GET /api/v1/enquiries": listEnquiries([theirs, numbered] as unknown as EnquiryOut[]),
    },
    "c-e12",
  );
  await screen.findByRole("heading", { level: 1, name: "E-12" });
  const enquiries = screen.getByRole("region", { name: "Enquiries" });
  expect((await within(enquiries).findAllByRole("link", { name: "E-0031" }))[0]).toHaveAttribute("href", "/app/enquiries/e-31");
  expect(within(enquiries).queryByText("E-0012")).not.toBeInTheDocument();
});

test("a client with more enquiries than one page says only the newest are shown", async () => {
  clientPage({
    "GET /api/v1/enquiries": { status: 200, body: { items: PRIYA_ENQUIRIES.slice(0, 2), total: 250 } },
  });
  await screen.findByRole("heading", { level: 1, name: "Priya Sharma" });
  const enquiries = screen.getByRole("region", { name: "Enquiries" });
  expect(await within(enquiries).findByText("Showing the 2 newest of 250 enquiries.")).toBeInTheDocument();
});

test("contact links escape the email and skip a phone without digits", async () => {
  clientPage({
    "GET /api/v1/clients/c-priya": {
      status: 200,
      body: { ...PRIYA, email: "ravi&sons?x@example.com", phone: "ask reception" },
    },
  });
  await screen.findByRole("heading", { level: 1, name: "Priya Sharma" });
  const contact = screen.getByRole("region", { name: "Contact" });
  expect(within(contact).getByRole("link", { name: "ravi&sons?x@example.com" })).toHaveAttribute(
    "href",
    "mailto:ravi%26sons%3Fx@example.com",
  );
  expect(within(contact).getByText("ask reception")).toBeInTheDocument();
  expect(within(contact).queryByRole("link", { name: "ask reception" })).not.toBeInTheDocument();
});

test("a duplicate email on edit is shown under Email", async () => {
  const { user } = clientPage({
    "PATCH /api/v1/clients/c-priya": { status: 409, body: { detail: "A client with this email already exists." } },
  });
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const drawer = screen.getByRole("dialog", { name: "Edit Priya Sharma" });
  const email = within(drawer).getByLabelText("Email");
  await user.clear(email);
  await user.type(email, "rahul@example.com");
  await user.click(within(drawer).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(email).toHaveAccessibleDescription("A client with this email already exists."));
  expect(email).toHaveAttribute("aria-invalid", "true");
  expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument();
});

test("an unknown saved airport on edit is described on the picker", async () => {
  const { user } = clientPage({
    "PATCH /api/v1/clients/c-priya": { status: 422, body: { detail: "Unknown airport code DEL." } },
  });
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const drawer = screen.getByRole("dialog", { name: "Edit Priya Sharma" });
  await user.type(within(drawer).getByLabelText("Phone"), "1");
  await user.click(within(drawer).getByRole("button", { name: "Save changes" }));
  const change = within(drawer).getByRole("button", { name: "Change Home airport" });
  await waitFor(() => expect(change).toHaveAccessibleDescription("Unknown airport code DEL."));
});
