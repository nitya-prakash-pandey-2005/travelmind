import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Readout } from "./Readout";
import { StatusDot } from "./StatusDot";
import { TextField } from "./TextField";
import { cn } from "./cn";

test("cn joins truthy class names", () => {
  expect(cn("a", false, null, undefined, "b")).toBe("a b");
});

test("Panel is a region named by its title and shows the eyebrow", () => {
  render(
    <Panel eyebrow="Orbital view" title="Route globe">
      body
    </Panel>,
  );
  expect(screen.getByRole("region", { name: "Route globe" })).toHaveTextContent("body");
  expect(screen.getByText("Orbital view")).toBeInTheDocument();
});

test("Button defaults to type=button and clicks", async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Engage</Button>);
  const button = screen.getByRole("button", { name: "Engage" });
  expect(button).toHaveAttribute("type", "button");
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test("a loading Button is busy and cannot be clicked", async () => {
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Engage
    </Button>,
  );
  const button = screen.getByRole("button", { name: /engage/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

test("TextField links its label, hint and error", () => {
  const { rerender } = render(<TextField label="Password" hint="At least 10 characters" />);
  const input = screen.getByLabelText("Password");
  expect(input).toHaveAccessibleDescription("At least 10 characters");
  expect(input).not.toHaveAttribute("aria-invalid");

  rerender(<TextField label="Password" hint="At least 10 characters" error="Too short" />);
  expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Too short");
});

test("Readout shows label, value and unit", () => {
  render(
    <dl>
      <Readout label="Distance" value="1,138" unit="km" hint="615 nmi" />
    </dl>,
  );
  expect(screen.getByText("Distance")).toBeInTheDocument();
  expect(screen.getByText("1,138")).toBeInTheDocument();
  expect(screen.getByText("km")).toBeInTheDocument();
  expect(screen.getByText("615 nmi")).toBeInTheDocument();
});

test("StatusDot exposes its label as text", () => {
  render(<StatusDot status="down" label="API offline" />);
  expect(screen.getByText("API offline")).toBeInTheDocument();
});

test("Badge renders its content", () => {
  render(<Badge tone="ai">owner</Badge>);
  expect(screen.getByText("owner")).toBeInTheDocument();
});
