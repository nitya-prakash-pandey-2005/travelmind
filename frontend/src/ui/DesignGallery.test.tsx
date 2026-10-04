import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { DesignGallery } from "./DesignGallery";
import { ToastProvider } from "./toast/ToastProvider";

test("the design gallery documents every token and component family", () => {
  render(
    <ToastProvider>
      <DesignGallery />
    </ToastProvider>,
  );
  for (const section of [
    "Themes",
    "Colour tokens",
    "Chart palette",
    "Charts",
    "Typography",
    "Controls",
    "Fields",
    "Signals",
    "Status pills",
    "Avatars",
    "Readouts",
    "Panels",
    "Navigation",
    "Overlays",
    "Data table",
    "Loading and empty",
    "Keyboard",
  ]) {
    expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
  }
  for (const token of ["--tm-bg", "--tm-surface", "--tm-primary", "--tm-ai", "--tm-warn", "--tm-danger", "--tm-ok", "--tm-chart-1", "--tm-chart-6"]) {
    expect(screen.getByText(token)).toBeInTheDocument();
  }
  expect(screen.getByRole("table", { name: "Specimen enquiries" })).toBeInTheDocument();
  expect(screen.getByRole("tablist", { name: "Specimen sections" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /^Specimen trend/ })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Specimen funnel data" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Metric C" })).toHaveAttribute("aria-busy", "true");
  // One preview per theme, each with a button that applies it.
  expect(within(screen.getByRole("list", { name: "Theme previews" })).getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Use Aurora" })).toHaveAttribute("aria-pressed", "true");
});

test("a theme preview applies its theme", async () => {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <DesignGallery />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Use Contrast" }));
  expect(document.documentElement.dataset.theme).toBe("contrast");
  expect(screen.getByRole("button", { name: "Use Contrast" })).toHaveAttribute("aria-pressed", "true");
});
