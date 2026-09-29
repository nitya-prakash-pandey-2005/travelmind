import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import type { GlobeArc } from "./RouteGlobe";

const webgl = vi.hoisted(() => ({ available: true }));
const globeBehaviour = vi.hoisted(() => ({ crash: false }));

vi.mock("./webgl", () => ({ hasWebGL: () => webgl.available }));
vi.mock("./RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => {
    if (globeBehaviour.crash) throw new Error("WebGL context lost");
    return <div data-testid="globe">{arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}`).join(",")}</div>;
  },
}));

const { GlobePanel } = await import("./GlobePanel");
const ARCS: GlobeArc[] = [{ from: AIRPORTS.DEL, to: AIRPORTS.BOM, active: true }];

test("renders the globe with the route arcs", async () => {
  webgl.available = true;
  globeBehaviour.crash = false;
  render(<GlobePanel arcs={ARCS} />);
  expect(await screen.findByTestId("globe")).toHaveTextContent("DEL-BOM*");
});

test("shows a fallback when WebGL is unavailable", () => {
  webgl.available = false;
  render(<GlobePanel arcs={ARCS} />);
  expect(screen.getByText(/3D globe isn't available on this device/)).toBeInTheDocument();
  expect(screen.queryByTestId("globe")).not.toBeInTheDocument();
});

test("contains a globe crash", async () => {
  webgl.available = true;
  globeBehaviour.crash = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<GlobePanel arcs={ARCS} />);
  expect(await screen.findByText(/orbital view went offline/i)).toBeInTheDocument();
});
