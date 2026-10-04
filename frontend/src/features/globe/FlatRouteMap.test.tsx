import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import FlatRouteMap from "./FlatRouteMap";

test("draws each route once, highlighted ones in the accent, with a label per airport", () => {
  const { container } = render(
    <FlatRouteMap
      arcs={[
        { from: AIRPORTS.DEL, to: AIRPORTS.BOM, active: true },
        { from: AIRPORTS.LHR, to: AIRPORTS.JFK, active: false },
      ]}
    />,
  );
  expect(screen.getByRole("img")).toHaveAccessibleName("Map of 2 routes: DEL to BOM (highlighted), LHR to JFK");
  expect(container.querySelectorAll('[data-arc="active"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-arc="other"]')).toHaveLength(1);
  for (const code of ["DEL", "BOM", "LHR", "JFK"]) expect(screen.getByText(code)).toBeInTheDocument();
  expect(container.innerHTML).not.toMatch(/NaN|undefined/);
});

test("with no routes it shows the whole world", () => {
  const { container } = render(<FlatRouteMap arcs={[]} />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Map with no routes yet");
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 360 142");
});
