import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DataTable } from "./DataTable";

const rows = [
  { id: "a", name: "Zed", n: 2 },
  { id: "b", name: "Amy", n: 5 },
  { id: "c", name: "Mia", n: 11 },
];
type Row = (typeof rows)[number];
const columns = [
  { key: "name", header: "Name", cell: (r: Row) => r.name, sortValue: (r: Row) => r.name },
  { key: "n", header: "Trips", cell: (r: Row) => r.n, sortValue: (r: Row) => r.n, align: "right" as const },
  { key: "note", header: "Note", cell: (r: Row) => `note ${r.id}` },
];

test("data table sorts, shows empty and loading states", async () => {
  const user = userEvent.setup();
  const rows = [
    { id: "a", name: "Zed", n: 2 },
    { id: "b", name: "Amy", n: 5 },
  ];
  const columns = [
    { key: "name", header: "Name", cell: (r: (typeof rows)[number]) => r.name, sortValue: (r: (typeof rows)[number]) => r.name },
    {
      key: "n",
      header: "Trips",
      cell: (r: (typeof rows)[number]) => r.n,
      sortValue: (r: (typeof rows)[number]) => r.n,
      align: "right" as const,
    },
  ];
  const { rerender } = render(
    <DataTable caption="Clients" columns={columns} rows={rows} getRowId={(r) => r.id} emptyState={<p>None</p>} />,
  );
  await user.click(screen.getByRole("button", { name: "Name" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Amy");
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
  rerender(<DataTable caption="Clients" columns={columns} rows={[]} getRowId={(r) => r.id} emptyState={<p>None</p>} />);
  expect(screen.getByText("None")).toBeInTheDocument();
  rerender(
    <DataTable caption="Clients" columns={columns} rows={[]} loading getRowId={(r) => r.id} emptyState={<p>None</p>} />,
  );
  expect(screen.getByRole("table", { name: "Clients" })).toHaveAttribute("aria-busy", "true");
});

test("a second click sorts descending, numbers sort numerically and unsortable columns have no sort button", async () => {
  const user = userEvent.setup();
  render(<DataTable caption="Clients" columns={columns} rows={rows} getRowId={(r) => r.id} emptyState={null} />);
  expect(screen.getByRole("columnheader", { name: "Trips" })).toHaveAttribute("aria-sort", "none");
  expect(screen.getByRole("columnheader", { name: "Note" })).not.toHaveAttribute("aria-sort");
  expect(screen.queryByRole("button", { name: "Note" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Trips" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Zed");
  expect(screen.getAllByRole("row")[3]).toHaveTextContent("Mia");
  await user.click(screen.getByRole("button", { name: "Trips" }));
  expect(screen.getByRole("columnheader", { name: /Trips/ })).toHaveAttribute("aria-sort", "descending");
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Mia");
});

test("initialSort orders rows on first render and loading renders five skeleton rows", () => {
  const { rerender } = render(
    <DataTable
      caption="Clients"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      emptyState={null}
      initialSort={{ key: "n", direction: "desc" }}
    />,
  );
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Mia");
  rerender(<DataTable caption="Clients" columns={columns} rows={rows} loading getRowId={(r) => r.id} emptyState={null} />);
  const [, body] = screen.getAllByRole("rowgroup");
  expect(within(body!).getAllByRole("row")).toHaveLength(5);
  expect(screen.queryByText("Zed")).not.toBeInTheDocument();
});

test("row click works with the mouse and with Enter", async () => {
  const user = userEvent.setup();
  const onRowClick = vi.fn();
  render(
    <DataTable
      caption="Clients"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      emptyState={null}
      onRowClick={onRowClick}
    />,
  );
  await user.click(screen.getByText("Amy"));
  expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  const zedRow = screen.getByText("Zed").closest("tr");
  expect(zedRow).not.toBeNull();
  zedRow!.focus();
  await user.keyboard("{Enter}");
  expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
  expect(onRowClick).toHaveBeenCalledTimes(2);
});
