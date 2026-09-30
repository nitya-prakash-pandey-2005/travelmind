import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { Avatar, AvatarStack } from "./Avatar";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { EmptyState } from "./EmptyState";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import { Panel } from "./Panel";
import { SegmentedControl } from "./SegmentedControl";
import { PanelSkeleton, Skeleton } from "./Skeleton";
import { StatusPill, type PillStatus } from "./StatusPill";
import { Tabs } from "./Tabs";

/** Renders `ui` as the only route of a throwaway router so router `Link`s work. */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByTestId("router-ready");
}

test("status pill labels", () => {
  render(
    <>
      <StatusPill status="won" />
      <StatusPill status="declined" />
    </>,
  );
  expect(screen.getByText("Won")).toBeInTheDocument();
  expect(screen.getByText("Declined")).toBeInTheDocument();
});

test("status pill maps every enquiry and quote status to its label and tone", () => {
  const expected: Array<[PillStatus, string, string]> = [
    ["new", "New", "primary"],
    ["quoting", "Quoting", "ai"],
    ["quoted", "Quoted", "warn"],
    ["won", "Won", "ok"],
    ["lost", "Lost", "neutral"],
    ["draft", "Draft", "neutral"],
    ["sent", "Sent", "primary"],
    ["viewed", "Viewed", "ai"],
    ["accepted", "Accepted", "ok"],
    ["declined", "Declined", "danger"],
    ["expired", "Expired", "neutral"],
  ];
  for (const [status, label, tone] of expected) {
    const { unmount } = render(<StatusPill status={status} />);
    const pill = screen.getByText(label).closest("[data-tone]");
    expect(pill).toHaveAttribute("data-tone", tone);
    unmount();
  }
});

function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New enquiry
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Create enquiry"
        footer={<button type="button">Create</button>}
      >
        <label>
          Notes <input data-autofocus="" />
        </label>
      </Dialog>
    </>
  );
}

test("dialog is labelled, closes on Escape and returns focus", async () => {
  const user = userEvent.setup();
  render(<DialogHarness />);
  const opener = screen.getByRole("button", { name: "New enquiry" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Create enquiry" });
  expect(dialog).toHaveAttribute("open");
  expect(within(dialog).getByRole("button", { name: "Create" })).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Notes")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test("dialog closes from its close button and from a backdrop click", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<DialogHarness onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: "New enquiry" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New enquiry" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "New enquiry" }));
  // A click on the <dialog> element itself (not its content) is a click on the backdrop.
  await user.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("dialog focuses the first focusable element in its body, not the header Close button", async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Share quote" footer={<button type="button">Send</button>}>
          <p>Copy the link below.</p>
          <button type="button">Copy link</button>
        </Dialog>
      </>
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("button", { name: "Copy link" })).toHaveFocus();
});

test("a drag that starts inside the dialog and ends on the backdrop does not close it", async () => {
  const user = userEvent.setup();
  render(<DialogHarness />);
  await user.click(screen.getByRole("button", { name: "New enquiry" }));
  const dialog = screen.getByRole("dialog");
  // Text selection: the pointer goes down in the input and the click lands on the <dialog> (the backdrop).
  fireEvent.pointerDown(within(dialog).getByLabelText("Notes"));
  fireEvent.click(dialog);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("drawer is a labelled modal side panel that closes on Escape", async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open client
        </button>
        <Drawer open={open} onClose={() => setOpen(false)} title="Priya Sharma">
          <p>priya@example.com</p>
        </Drawer>
      </>
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Open client" }));
  expect(screen.getByRole("dialog", { name: "Priya Sharma" })).toHaveTextContent("priya@example.com");
  // Nothing focusable in the body or footer: focus falls back to the Close button.
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open client" })).toHaveFocus();
});

function TabsHarness() {
  const [value, setValue] = useState("overview");
  return (
    <Tabs
      label="Client sections"
      value={value}
      onChange={setValue}
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "trips", label: "Trips" },
        { id: "quotes", label: "Quotes" },
      ]}
    />
  );
}

test("tabs move with arrow keys", async () => {
  const user = userEvent.setup();
  render(<TabsHarness />);
  expect(screen.getByRole("tablist", { name: "Client sections" })).toBeInTheDocument();
  const overview = screen.getByRole("tab", { name: "Overview" });
  expect(overview).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Trips" })).toHaveAttribute("tabindex", "-1");

  await user.click(overview);
  await user.keyboard("{ArrowRight}");
  const trips = screen.getByRole("tab", { name: "Trips" });
  expect(trips).toHaveAttribute("aria-selected", "true");
  expect(trips).toHaveFocus();
  expect(overview).toHaveAttribute("aria-selected", "false");

  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Quotes" })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowRight}");
  expect(overview).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Quotes" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(overview).toHaveFocus();
});

function renderMenu() {
  const edit = vi.fn();
  const remove = vi.fn();
  render(
    <>
      <Menu
        label="Quote actions"
        trigger="Actions"
        items={[
          { label: "Edit", onSelect: edit, icon: Pencil },
          { label: "Delete", onSelect: remove, icon: Trash2, danger: true },
        ]}
      />
      <p>Outside</p>
      <button type="button">After</button>
    </>,
  );
  return { edit, remove, trigger: screen.getByRole("button", { name: "Quote actions" }) };
}

test("menu opens, navigates and selects", async () => {
  const user = userEvent.setup();
  const { edit, remove, trigger } = renderMenu();
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  const menu = screen.getByRole("menu");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(remove).toHaveBeenCalledOnce();
  expect(edit).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("menu closes on Escape and on an outside click, and wraps with arrow keys", async () => {
  const user = userEvent.setup();
  const { edit, trigger } = renderMenu();
  await user.click(trigger);
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(screen.getByText("Outside"));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(edit).not.toHaveBeenCalled();

  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  // Tab leaves the menu and carries on to the next control; focus is not parked back on the trigger.
  await user.keyboard("{Tab}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
});

test("menu items with duplicate labels keep distinct identities via id", async () => {
  const user = userEvent.setup();
  const first = vi.fn();
  const second = vi.fn();
  render(
    <Menu
      label="Duplicates"
      trigger="More"
      items={[
        { id: "a", label: "Open", onSelect: first },
        { id: "b", label: "Open", onSelect: second },
      ]}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Duplicates" }));
  await user.keyboard("{ArrowDown}{Enter}");
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});

test("the selected tab draws its underline inside the tab and the list never scrolls vertically", () => {
  render(<TabsHarness />);
  const list = screen.getByRole("tablist");
  expect(list.className).toMatch(/\boverflow-y-hidden\b/);
  for (const tab of screen.getAllByRole("tab")) expect(tab.className).not.toMatch(/-mb-px/);
  expect(screen.getByRole("tab", { name: "Overview" }).className).toMatch(/after:bg-primary/);
});

test("avatar initials and stack overflow", () => {
  render(
    <>
      <Avatar name="Priya Sharma" />
      <Avatar name="  Arjun Kumar Rao " />
      <Avatar name="Cher" />
    </>,
  );
  expect(screen.getByRole("img", { name: "Priya Sharma" })).toHaveTextContent("PS");
  expect(screen.getByRole("img", { name: "Arjun Kumar Rao" })).toHaveTextContent("AR");
  expect(screen.getByRole("img", { name: "Cher" })).toHaveTextContent("C");
  const stack = render(<AvatarStack names={["A One", "B Two", "C Three", "D Four", "E Five"]} max={3} />);
  expect(within(stack.container).getByText("+2")).toBeInTheDocument();
});

test("avatar colour is deterministic per name", () => {
  render(
    <>
      <Avatar name="Priya Sharma" />
      <Avatar name="Priya Sharma" size="lg" />
    </>,
  );
  const [a, b] = screen.getAllByRole("img", { name: "Priya Sharma" });
  expect(a?.dataset.colour).toMatch(/^chart-[1-6]$/);
  expect(a?.dataset.colour).toBe(b?.dataset.colour);
});

test("avatar stack shows the first names and a +N overflow", () => {
  render(<AvatarStack names={["Priya Sharma", "Arjun Rao", "Meera Iyer", "Dev Patel", "Sana Khan"]} max={3} />);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  expect(screen.getByText("+2")).toBeInTheDocument();
  expect(screen.getByText(/Dev Patel, Sana Khan/)).toBeInTheDocument();
});

test("empty state action is a link when given `to`", async () => {
  await renderInRouter(
    <div data-testid="router-ready">
      <EmptyState
        icon={Inbox}
        title="No departures yet"
        description="Won trips with upcoming departures show here."
        action={{ label: "Open team", to: "/team" }}
      />
    </div>,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("No departures yet");
  expect(status).toHaveTextContent("Won trips with upcoming departures show here.");
  expect(within(status).getByRole("link", { name: "Open team" })).toHaveAttribute("href", "/team");
});

test("empty state action is a button when given onClick", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<EmptyState icon={Inbox} title="No clients" description="Add your first client." action={{ label: "Add client", onClick }} />);
  await user.click(screen.getByRole("button", { name: "Add client" }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("segmented control is a radio group", async () => {
  const user = userEvent.setup();
  function Harness({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = useState<"7d" | "30d" | "90d">("7d");
    return (
      <SegmentedControl
        label="Range"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        options={[
          { value: "7d", label: "7d" },
          { value: "30d", label: "30d" },
          { value: "90d", label: "90d" },
        ]}
      />
    );
  }
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const group = screen.getByRole("radiogroup", { name: "Range" });
  expect(within(group).getByRole("radio", { name: "7d" })).toBeChecked();
  await user.click(within(group).getByRole("radio", { name: "30d" }));
  expect(onChange).toHaveBeenLastCalledWith("30d");
  expect(within(group).getByRole("radio", { name: "30d" })).toBeChecked();
  expect(within(group).getByRole("radio", { name: "7d" })).not.toBeChecked();
});

test("skeletons are hidden from assistive tech; PanelSkeleton is a busy panel", () => {
  const { container } = render(
    <>
      <Skeleton lines={4} />
      <PanelSkeleton title="Pipeline" />
    </>,
  );
  const skeleton = container.querySelector("[data-skeleton]");
  expect(skeleton).toHaveAttribute("aria-hidden", "true");
  expect(skeleton?.children).toHaveLength(4);
  const panel = screen.getByRole("region", { name: "Pipeline" });
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(panel.querySelectorAll("[data-skeleton] > *")).toHaveLength(3);
});

test("panel variants, dense padding and headerRight", () => {
  render(
    <>
      <Panel title="Glass" variant="glass" headerRight={<button type="button">Refresh</button>}>
        glass body
      </Panel>
      <Panel title="Flat" variant="flat" dense>
        flat body
      </Panel>
    </>,
  );
  const glass = screen.getByRole("region", { name: "Glass" });
  expect(glass).toHaveAttribute("data-variant", "glass");
  expect(within(glass).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  const flat = screen.getByRole("region", { name: "Flat" });
  expect(flat).toHaveAttribute("data-variant", "flat");
  expect(flat.className).toMatch(/\bp-3\b/);
});

test("kbd renders a keyboard element", () => {
  render(
    <p>
      Press <Kbd>⌘K</Kbd>
    </p>,
  );
  expect(screen.getByText("⌘K").tagName).toBe("KBD");
});
