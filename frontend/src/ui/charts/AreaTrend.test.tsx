import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { resolvePalette } from "../../theme";
import { AreaTrend, type TrendBand, type TrendSeries } from "./AreaTrend";

const AURORA_DARK = resolvePalette({ theme: "aurora", mode: "dark", contrast: false });

const MEDIAN: TrendSeries = {
  key: "median",
  label: "Median",
  color: 1,
  area: false,
  points: [
    { date: "2026-09-01", value: 50 },
    { date: "2026-09-02", value: 60 },
    { date: "2026-09-03", value: 55 },
  ],
};

const RANGE: TrendBand = {
  label: "Middle half",
  color: 1,
  points: [
    { date: "2026-09-01", low: 40, high: 70 },
    { date: "2026-09-02", low: 45, high: 90 },
    { date: "2026-09-03", low: null, high: null },
  ],
};

test("a band draws one shaded range between its low and high points", () => {
  const { container } = render(<AreaTrend label="Fares" valueFormat={String} series={[MEDIAN]} band={RANGE} />);
  const bands = container.querySelectorAll("[data-band]");
  expect(bands).toHaveLength(1);
  const band = bands[0] as SVGPathElement;
  expect(band.getAttribute("fill")).toBe(AURORA_DARK.chart1);
  expect(band.getAttribute("d")).toMatch(/^M.+Z$/);
  expect(band.getAttribute("d")).not.toMatch(/NaN/);
  // The series asked for no area of its own: only its line is drawn.
  expect(container.querySelectorAll("[data-area]")).toHaveLength(0);
  expect(container.querySelectorAll("[data-line]")).toHaveLength(1);
});

test("the band's high values set the y-axis top", () => {
  const { container } = render(<AreaTrend label="Fares" valueFormat={String} series={[MEDIAN]} band={RANGE} />);
  const ticks = [...container.querySelectorAll("text")].map((t) => t.textContent);
  expect(ticks).toContain("100");
});

test("the band is in the legend, the tooltip and the data table, with gaps as dashes", async () => {
  const user = userEvent.setup();
  render(<AreaTrend label="Fares" valueFormat={(v) => `₹${v}`} series={[MEDIAN]} band={RANGE} />);
  const legend = screen.getByRole("list", { name: "Fares legend" });
  expect(within(legend).getByText("Median")).toBeInTheDocument();
  expect(within(legend).getByText("Middle half")).toBeInTheDocument();

  const table = screen.getByRole("table", { name: "Fares data" });
  expect(within(table).getByRole("columnheader", { name: "Middle half" })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /2 Sep ₹60 ₹45–₹90/ })).toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /3 Sep ₹55 —/ })).toBeInTheDocument();

  await user.tab();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Middle half\s*₹45–₹90/);
  expect(screen.getByRole("img", { name: /Middle half/ })).toBeInTheDocument();
});

test("a band alone still plots, and a band with no values draws nothing", () => {
  const { container, rerender } = render(<AreaTrend label="Band" valueFormat={String} series={[]} band={RANGE} />);
  expect(container.querySelectorAll("[data-band]")).toHaveLength(1);
  rerender(
    <AreaTrend
      label="Band"
      valueFormat={String}
      series={[MEDIAN]}
      band={{ label: "Empty", color: 2, points: [{ date: "2026-09-01", low: null, high: null }] }}
    />,
  );
  expect(container.querySelectorAll("[data-band]")).toHaveLength(0);
});

test("a band split by a gap draws one shaded piece per run of days", () => {
  const { container } = render(
    <AreaTrend
      label="Split"
      valueFormat={String}
      series={[]}
      band={{
        label: "Range",
        color: 1,
        points: [
          { date: "2026-09-01", low: 1, high: 3 },
          { date: "2026-09-02", low: 2, high: 4 },
          { date: "2026-09-03", low: null, high: null },
          { date: "2026-09-04", low: 1, high: 5 },
        ],
      }}
    />,
  );
  const pieces = container.querySelectorAll("[data-band]");
  expect(pieces).toHaveLength(2);
  for (const piece of pieces) expect(piece.getAttribute("d")).not.toMatch(/NaN/);
});

test("without a band the chart is unchanged: areas under every series, no band", () => {
  const { container } = render(
    <AreaTrend label="Plain" valueFormat={String} series={[{ ...MEDIAN, area: undefined }]} />,
  );
  expect(container.querySelectorAll("[data-band]")).toHaveLength(0);
  expect(container.querySelectorAll("[data-area]")).toHaveLength(1);
});

test("a series that breaks at gaps draws one line piece per run, with a dot for a lone day", () => {
  const { container } = render(
    <AreaTrend
      label="Broken"
      valueFormat={String}
      series={[
        {
          key: "m",
          label: "Median",
          color: 1,
          breakAtGaps: true,
          points: [
            { date: "2026-09-01", value: 4 },
            { date: "2026-09-02", value: 5 },
            { date: "2026-09-03", value: null },
            { date: "2026-09-04", value: 6 },
            { date: "2026-09-05", value: null },
            { date: "2026-09-06", value: 7 },
            { date: "2026-09-07", value: 8 },
          ],
        },
      ]}
    />,
  );
  const line = container.querySelector("[data-line]");
  expect(line?.getAttribute("d")?.match(/M/g)).toHaveLength(3);
  expect(container.querySelectorAll("[data-lone-point]")).toHaveLength(1);
  const area = container.querySelector("[data-area]");
  expect(area?.getAttribute("d")?.match(/M/g)).toHaveLength(3);
  expect(container.innerHTML).not.toMatch(/NaN|undefined/);
});

test("by default a line still joins the points either side of a gap", () => {
  const { container } = render(
    <AreaTrend
      label="Joined"
      valueFormat={String}
      series={[{ key: "a", label: "A", color: 1, points: [{ date: "2026-09-01", value: 1 }, { date: "2026-09-02", value: null }, { date: "2026-09-03", value: 2 }] }]}
    />,
  );
  expect(container.querySelector("[data-line]")?.getAttribute("d")?.match(/M/g)).toHaveLength(1);
  expect(container.querySelectorAll("[data-lone-point]")).toHaveLength(0);
});
