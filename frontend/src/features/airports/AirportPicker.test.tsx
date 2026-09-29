import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import type { Airport } from "../../api/types";
import { AIRPORTS } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import { AirportPicker } from "./AirportPicker";

function Harness({ initial = null }: { initial?: Airport | null }) {
  const [value, setValue] = useState<Airport | null>(initial);
  return <AirportPicker label="From" value={value} onChange={setValue} />;
}

const goaResults = { status: 200, body: [AIRPORTS.GOI, AIRPORTS.GOX] };

test("asks for two letters before searching", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "g");
  expect(screen.getByText("Type at least 2 letters")).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

test("debounces and only searches settled terms", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  expect(await screen.findByRole("option", { name: /GOI/ })).toBeInTheDocument();
  expect(calls.map((c) => c.search.get("q"))).toEqual(["goa"]);
});

test("keyboard: arrow down then enter picks the highlighted airport", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  const input = screen.getByRole("combobox", { name: "From" });
  await user.type(input, "goa");
  await screen.findByRole("option", { name: /GOX/ });
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByText("GOX")).toBeInTheDocument();
  expect(screen.getByText("Manohar International Airport")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "From" })).not.toBeInTheDocument();
});

test("clicking an option picks it and Change lets you search again", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  await user.click(await screen.findByRole("option", { name: /GOI/ }));
  await user.click(screen.getByRole("button", { name: "Change From" }));
  expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("");
});

test("escape closes the suggestions", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  await screen.findByRole("listbox");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
});

test("no matches and API errors are explained", async () => {
  mockApi({ "GET /api/v1/reference/airports": { status: 200, body: [] } });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "zzzz");
  expect(await screen.findByText("No airports match “zzzz”")).toBeInTheDocument();

  mockApi({
    "GET /api/v1/reference/airports": {
      status: 429,
      body: { detail: "Too many requests. Please slow down." },
    },
  });
  await user.type(screen.getByRole("combobox", { name: "From" }), "x");
  expect(await screen.findByText("Too many requests. Please slow down.")).toBeInTheDocument();
});
