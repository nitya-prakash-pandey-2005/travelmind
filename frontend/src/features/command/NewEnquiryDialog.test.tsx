import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { mockApi, type MockCall, type MockHandler } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import { commandCenterMocks } from "../../test/workspaceFixtures";
import { routeStore } from "../route/routeStore";
import { NewEnquiryDialog } from "./NewEnquiryDialog";

beforeEach(() => routeStore.reset());

function setup(overrides: Record<string, MockHandler> = {}) {
  const api = mockApi({ ...commandCenterMocks({ populated: true }), ...overrides });
  const onClose = vi.fn();
  const view = renderWithClient(<NewEnquiryDialog open onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "New enquiry" });
  return { ...api, ...view, onClose, dialog };
}

const posts = (calls: MockCall[]) => calls.filter((c) => c.method === "POST");

test("prefills the route from the scanner and links an existing client", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { calls, user, dialog, onClose, queryClient } = setup();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  expect(within(dialog).getByText("DEL")).toBeInTheDocument();
  expect(within(dialog).getByText("BOM")).toBeInTheDocument();

  await user.type(within(dialog).getByRole("combobox", { name: "Client" }), "pri");
  await user.click(await within(dialog).findByRole("option", { name: /Priya Sharma/ }));
  expect(within(dialog).getByText("Priya Sharma")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Depart"), { target: { value: "2026-11-20" } });
  fireEvent.change(within(dialog).getByLabelText("Return"), { target: { value: "2026-11-27" } });
  await user.selectOptions(within(dialog).getByLabelText("Cabin"), "business");
  await user.type(within(dialog).getByLabelText("Notes"), "Window seats");
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));

  expect(await screen.findByText("Enquiry E-0007 created")).toBeInTheDocument();
  expect(posts(calls).map((c) => c.path)).toEqual(["/api/v1/enquiries"]);
  expect(posts(calls)[0]?.body).toEqual({
    client_id: "c-priya",
    origin: "DEL",
    destination: "BOM",
    depart_date: "2026-11-20",
    return_date: "2026-11-27",
    adults: 1,
    cabin: "business",
    notes: "Window seats",
  });
  expect(onClose).toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  // The route scanner keeps its own route: the dialog's pickers are local.
  expect(routeStore.get().origin?.iata_code).toBe("DEL");
});

test("adults are clamped to 1–9", async () => {
  const { calls, user, dialog } = setup();
  const adults = within(dialog).getByLabelText("Adults");
  await user.clear(adults);
  await user.type(adults, "15");
  await user.tab();
  expect(adults).toHaveValue(9);
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  await screen.findByText("Enquiry E-0007 created");
  expect(posts(calls)[0]?.body).toMatchObject({ adults: 9 });
});

test("field errors show inline; errors for fields the form doesn't show get a general message", async () => {
  let attempt = 0;
  const { user, dialog } = setup({
    "POST /api/v1/enquiries": () => {
      attempt += 1;
      return attempt === 1
        ? {
            status: 422,
            body: {
              detail: "Some of the information you entered isn't valid.",
              errors: [{ field: "depart_date", message: "Input should be a valid date" }],
            },
          }
        : { status: 422, body: { detail: "Unknown airport code XXX." } };
    },
  });
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  expect(await within(dialog).findByText("Input should be a valid date")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Depart")).toHaveAttribute("aria-invalid", "true");
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unknown airport code XXX.");
});

test("a new client is created once, even when the enquiry needs a second try", async () => {
  let attempt = 0;
  const { calls, user, dialog } = setup({
    "POST /api/v1/enquiries": (call) => {
      attempt += 1;
      if (attempt === 1) return { status: 500, body: { detail: "Something went wrong on our side. Please try again." } };
      const handler = commandCenterMocks()["POST /api/v1/enquiries"];
      return typeof handler === "function" ? handler(call) : handler!;
    },
  });
  await user.click(within(dialog).getByRole("radio", { name: "New client" }));
  await user.type(within(dialog).getByLabelText("Client name"), "Priya");
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/went wrong/);

  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  await screen.findByText("Enquiry E-0007 created");
  expect(posts(calls).map((c) => c.path)).toEqual(["/api/v1/clients", "/api/v1/enquiries", "/api/v1/enquiries"]);
  expect(posts(calls)[2]?.body).toMatchObject({ client_id: "c-new" });
});

test("a new client needs a name", async () => {
  const { calls, user, dialog } = setup();
  await user.click(within(dialog).getByRole("radio", { name: "New client" }));
  await user.click(within(dialog).getByRole("button", { name: "Create enquiry" }));
  expect(await within(dialog).findByText("Enter the client's name, or pick an existing client.")).toBeInTheDocument();
  expect(posts(calls)).toHaveLength(0);
});

test("Cancel closes without sending anything", async () => {
  const { calls, user, dialog, onClose } = setup();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  await waitFor(() => expect(posts(calls)).toHaveLength(0));
});
