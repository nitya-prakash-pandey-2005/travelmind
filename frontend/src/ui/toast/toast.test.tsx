import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ToastProvider } from "./ToastProvider";
import { useToast, type ToastInput } from "./useToast";

function Trigger({ input }: { input: ToastInput }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(input)}>
      Fire
    </button>
  );
}

function politeRegion() {
  return screen.getByRole("status");
}

function assertiveRegion() {
  const region = document.querySelector<HTMLElement>('[aria-live="assertive"]');
  if (!region) throw new Error("assertive region missing");
  return region;
}

function toastElement(title: string) {
  const element = screen.getByText(title).closest<HTMLElement>("[data-toast]");
  if (!element) throw new Error(`toast ${title} missing`);
  return element;
}

function renderToasts(input: ToastInput) {
  return render(
    <ToastProvider>
      <Trigger input={input} />
    </ToastProvider>,
  );
}

test("live regions are mounted before any toast, so insertions are announced", async () => {
  const user = userEvent.setup();
  renderToasts({ tone: "ok", title: "Saved" });
  const polite = politeRegion();
  const assertive = assertiveRegion();
  expect(polite).toBeEmptyDOMElement();
  expect(polite).toHaveAttribute("aria-live", "polite");
  expect(assertive).toBeEmptyDOMElement();
  await user.click(screen.getByRole("button", { name: "Fire" }));
  expect(politeRegion()).toBe(polite);
  expect(polite).toHaveTextContent("Saved");
  // Toasts themselves are not nested live regions.
  expect(toastElement("Saved")).not.toHaveAttribute("role");
});

test("toasts announce and dismiss", async () => {
  const user = userEvent.setup();
  renderToasts({ tone: "ok", title: "Saved", description: "Quote Q-0003 saved." });
  await user.click(screen.getByRole("button", { name: "Fire" }));
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Saved");
  expect(status).toHaveTextContent("Quote Q-0003 saved.");
  await user.click(within(status).getByRole("button", { name: /dismiss/i }));
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
});

test("danger toasts render in the assertive region", async () => {
  const user = userEvent.setup();
  renderToasts({ tone: "danger", title: "Send failed" });
  await user.click(screen.getByRole("button", { name: "Fire" }));
  expect(assertiveRegion()).toHaveTextContent("Send failed");
  expect(politeRegion()).not.toHaveTextContent("Send failed");
});

test("toasts auto-dismiss after 5 s, pausing while hovered", () => {
  vi.useFakeTimers();
  renderToasts({ tone: "info", title: "Heads up" });
  fireEvent.click(screen.getByRole("button", { name: "Fire" }));
  const toast = toastElement("Heads up");
  expect(politeRegion()).toContainElement(toast);

  act(() => vi.advanceTimersByTime(3000));
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByText("Heads up")).toBeInTheDocument();

  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(1900));
  expect(screen.getByText("Heads up")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
});

test("focus inside a toast pauses its timer", () => {
  vi.useFakeTimers();
  renderToasts({ tone: "warn", title: "Rate limited" });
  fireEvent.click(screen.getByRole("button", { name: "Fire" }));
  const dismiss = screen.getByRole("button", { name: /dismiss/i });
  act(() => dismiss.focus());
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByText("Rate limited")).toBeInTheDocument();
  act(() => dismiss.blur());
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByText("Rate limited")).not.toBeInTheDocument();
});

test("at most three toasts are visible; the oldest leaves first", () => {
  function Many() {
    const { toast } = useToast();
    return (
      <button type="button" onClick={() => [1, 2, 3, 4].forEach((n) => toast({ tone: "info", title: `Toast ${n}` }))}>
        Burst
      </button>
    );
  }
  render(
    <ToastProvider>
      <Many />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Burst" }));
  expect(within(politeRegion()).getAllByRole("button", { name: /dismiss/i })).toHaveLength(3);
  expect(screen.queryByText("Toast 1")).not.toBeInTheDocument();
  expect(screen.getByText("Toast 4")).toBeInTheDocument();
});

test("useToast outside a provider fails loudly", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Trigger input={{ tone: "ok", title: "x" }} />)).toThrow(/ToastProvider/);
});
