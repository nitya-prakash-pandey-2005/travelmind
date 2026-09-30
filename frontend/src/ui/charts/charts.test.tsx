import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AreaTrend, BarList, Donut, Funnel, KpiTile, LatencyBand, Sparkline } from "./index";

afterEach(() => vi.unstubAllGlobals());

test("area trend exposes data to assistive tech and keyboard", async () => {
  const user = userEvent.setup();
  render(<AreaTrend label="Enquiries vs quotes" valueFormat={String} series={[
    { key: "e", label: "Enquiries", color: 1, points: [{ date: "2026-09-01", value: 3 }, { date: "2026-09-02", value: 5 }] },
    { key: "q", label: "Quotes", color: 2, points: [{ date: "2026-09-01", value: 1 }, { date: "2026-09-02", value: 4 }] },
  ]} />);
  expect(screen.getByRole("img", { name: /Enquiries vs quotes/ })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Enquiries vs quotes data" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  await user.tab();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Enquiries\s*5/);
});

test("kpi tile shows value, delta and busy state", () => {
  const { rerender } = render(<KpiTile label="Quotes sent" value="24" delta={{ pct: 12, direction: "up", good: true }} series={[1, 2, 3]} />);
  expect(screen.getByText("24")).toBeInTheDocument();
  expect(screen.getByText("12%")).toBeInTheDocument();
  rerender(<KpiTile label="Win rate" value="—" delta={{ pct: null, direction: "flat", good: true }} />);
  expect(screen.getByText("—", { selector: "[data-delta]" })).toBeInTheDocument();
  rerender(<KpiTile label="Quotes sent" value="" loading />);
  expect(screen.getByRole("group", { name: "Quotes sent" })).toHaveAttribute("aria-busy", "true");
});

test("funnel conversion", () => {
  render(<Funnel label="Pipeline" valueFormat={String} stages={[{ label: "New", count: 10 }, { label: "Quoted", count: 4 }, { label: "Won", count: 0 }]} />);
  expect(screen.getByText("40%")).toBeInTheDocument();
  expect(screen.getByText("0%")).toBeInTheDocument();
});

// ── Beyond the brief excerpt ────────────────────────────────────────────────

const ENQUIRIES = { key: "e", label: "Enquiries", color: 1 as const, points: [{ date: "2026-09-01", value: 3 }, { date: "2026-09-02", value: 5 }, { date: "2026-09-03", value: 2 }] };
const TWO_SERIES = [
  ENQUIRIES,
  { key: "q", label: "Quotes", color: 2 as const, points: [{ date: "2026-09-01", value: 1 }, { date: "2026-09-02", value: 4 }, { date: "2026-09-03", value: 0 }] },
];

test("area trend table has a Date column plus one column per series with formatted values", () => {
  render(<AreaTrend label="Volume" valueFormat={(v) => `${v} req`} series={TWO_SERIES} />);
  const table = screen.getByRole("table", { name: "Volume data" });
  expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Date", "Enquiries", "Quotes"]);
  const firstRow = within(table).getByRole("row", { name: /^1 Sep/ });
  expect(within(firstRow).getByRole("rowheader")).toHaveTextContent("1 Sep");
  expect(within(firstRow).getAllByRole("cell").map((td) => td.textContent)).toEqual(["3 req", "1 req"]);
});

test("area trend crosshair moves with arrows, clamps at the ends, jumps with Home/End and clears on blur", async () => {
  const user = userEvent.setup();
  render(
    <>
      <AreaTrend label="Volume" valueFormat={String} series={TWO_SERIES} />
      <button type="button">after</button>
    </>,
  );
  const chart = screen.getByRole("img", { name: /Volume/ });
  await user.tab();
  expect(chart).toHaveFocus();
  expect(screen.getByRole("tooltip")).toHaveTextContent(/1 Sep/);
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Enquiries\s*3.*Quotes\s*1/);
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/1 Sep/);
  await user.keyboard("{End}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/3 Sep.*Enquiries\s*2.*Quotes\s*0/);
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/3 Sep/);
  await user.keyboard("{Home}{ArrowRight}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/2 Sep.*Enquiries\s*5.*Quotes\s*4/);
  await user.tab();
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("area trend draws gridlines, capped date ticks, a legend and one area plus line per series", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, value: i }));
  const { container } = render(
    <AreaTrend label="Month" valueFormat={String} series={[{ key: "a", label: "A", color: 1, points }, { key: "b", label: "B", color: 3, points }]} />,
  );
  expect(container.querySelectorAll("[data-x-tick]").length).toBeLessThanOrEqual(6);
  expect(container.querySelector("[data-x-tick]")).toHaveTextContent("1 Sep");
  expect(container.querySelectorAll("[data-gridline]").length).toBeGreaterThan(1);
  const areas = container.querySelectorAll("[data-area]");
  expect(areas).toHaveLength(2);
  expect(areas[0]).toHaveAttribute("fill", "var(--color-chart-1)");
  expect(areas[0]).toHaveAttribute("fill-opacity", "0.15");
  expect(container.querySelectorAll("[data-line]")[1]).toHaveAttribute("stroke", "var(--color-chart-3)");
  expect(screen.getByRole("list", { name: "Month legend" })).toHaveTextContent(/A.*B/);
});

test("single-series area trend needs no legend", () => {
  render(<AreaTrend label="Solo" valueFormat={String} series={[ENQUIRIES]} />);
  expect(screen.queryByRole("list", { name: "Solo legend" })).not.toBeInTheDocument();
});

test("charts never produce NaN on empty, flat or single-point data", () => {
  const { container } = render(
    <>
      <AreaTrend label="Flat" valueFormat={String} series={[{ key: "a", label: "A", color: 1, points: [{ date: "2026-09-01", value: 0 }, { date: "2026-09-02", value: 0 }] }]} />
      <AreaTrend label="One" valueFormat={String} series={[{ key: "a", label: "A", color: 1, points: [{ date: "2026-09-01", value: 4 }] }]} />
      <Sparkline label="Flat spark" values={[2, 2, 2]} />
      <Sparkline label="One spark" values={[7]} />
      <BarList label="Zeros" valueFormat={String} items={[{ label: "x", value: 0 }, { label: "y", value: 0 }]} />
      <Funnel label="Empty funnel" valueFormat={String} stages={[{ label: "a", count: 0 }, { label: "b", count: 0 }]} />
      <Donut label="Nothing" slices={[{ label: "a", value: 0 }, { label: "b", value: 0 }]} />
      <LatencyBand p50={0} p95={0} max={0} />
    </>,
  );
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});

test("area trend with no points shows an empty message instead of axes", () => {
  render(<AreaTrend label="Nothing yet" valueFormat={String} series={[{ key: "a", label: "A", color: 1, points: [] }]} />);
  expect(screen.getByRole("img", { name: "Nothing yet: no data" })).toHaveTextContent("No data for this period");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("sparkline summarises first and last values, draws a last-point dot and renders nothing when empty", () => {
  const { container, rerender } = render(<Sparkline label="Quotes" values={[4, 9, 6]} tone="ok" />);
  expect(screen.getByRole("img", { name: "Quotes: from 4 to 6" })).toBeInTheDocument();
  expect(container.querySelector("[data-line]")).toHaveAttribute("stroke", "var(--color-ok)");
  expect(container.querySelector("[data-last-dot]")).toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "Quotes data" })).getAllByRole("row")).toHaveLength(4);
  rerender(<Sparkline label="Quotes" values={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("bar list shows labels, mono values and bars scaled to the max", () => {
  const { container } = render(
    <BarList label="Top routes" valueFormat={(v) => `${v} q`} items={[{ label: "DEL → BOM", value: 8, hint: "12 searches" }, { label: "BLR → DXB", value: 2 }]} />,
  );
  expect(screen.getByRole("img", { name: /Top routes/ })).toBeInTheDocument();
  expect(screen.getByText("8 q", { selector: "[data-value]" })).toHaveClass("font-mono");
  expect(screen.getByText("12 searches")).toBeInTheDocument();
  const bars = container.querySelectorAll("[data-bar]");
  expect(bars[0]).toHaveAttribute("width", "100%");
  expect(bars[1]).toHaveAttribute("width", "25%");
  expect(within(screen.getByRole("table", { name: "Top routes data" })).getAllByRole("row")).toHaveLength(3);
});

test("bar list honours an explicit max", () => {
  const { container } = render(<BarList label="Share" max={10} valueFormat={String} items={[{ label: "a", value: 5 }]} />);
  expect(container.querySelector("[data-bar]")).toHaveAttribute("width", "50%");
});

test("funnel shows a dash when the previous stage is empty and lists conversion in its table", () => {
  render(<Funnel label="Leaky" valueFormat={(v) => `$${v}`} stages={[{ label: "New", count: 0 }, { label: "Won", count: 0, value: 30 }]} />);
  expect(screen.getByText("—", { selector: "[data-conversion]" })).toBeInTheDocument();
  expect(screen.getByText("$30", { selector: "[data-value]" })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Leaky data" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
});

test("donut shows a legend with percentages and a custom centre", () => {
  render(<Donut label="Channels" center={<span>42 total</span>} slices={[{ label: "Email", value: 3 }, { label: "Portal", value: 1 }]} />);
  expect(screen.getByRole("img", { name: /Channels/ })).toBeInTheDocument();
  const legend = screen.getByRole("list", { name: "Channels legend" });
  expect(legend).toHaveTextContent(/Email.*75%/);
  expect(legend).toHaveTextContent(/Portal.*25%/);
  expect(screen.getByText("42 total")).toBeInTheDocument();
});

test("donut folds more than six slices into Other", () => {
  const slices = Array.from({ length: 8 }, (_, i) => ({ label: `S${i}`, value: 10 - i }));
  render(<Donut label="Many" slices={slices} />);
  const items = within(screen.getByRole("list", { name: "Many legend" })).getAllByRole("listitem");
  expect(items).toHaveLength(6);
  expect(items[5]).toHaveTextContent(/Other/);
});

test("latency band labels p50 and p95", () => {
  render(<LatencyBand p50={120} p95={480} max={900} />);
  expect(screen.getByText("p50 120 ms · p95 480 ms")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /p50 120 ms.*p95 480 ms.*900 ms/ })).toBeInTheDocument();
});

test("kpi tile summarises value and change in its accessible name and colours the delta by goodness", () => {
  const { rerender } = render(<KpiTile label="Quotes sent" value="24" unit="this week" delta={{ pct: 12, direction: "up", good: true }} />);
  expect(screen.getByRole("group", { name: "Quotes sent: 24 this week, up 12%" })).toBeInTheDocument();
  expect(document.querySelector("[data-delta]")).toHaveClass("text-ok");
  rerender(<KpiTile label="Lost" value="3" delta={{ pct: -8, direction: "down", good: false }} hint="vs last week" />);
  expect(screen.getByRole("group", { name: "Lost: 3, down 8%" })).toBeInTheDocument();
  expect(screen.getByText("8%").closest("[data-delta]")).toHaveClass("text-danger");
  expect(screen.getByText("vs last week")).toBeInTheDocument();
});

test("entrance animation is skipped under reduced motion", () => {
  const reduce = (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} });
  const { container, unmount } = render(<AreaTrend label="Anim" valueFormat={String} series={TWO_SERIES} />);
  expect(container.querySelectorAll("[data-animate]").length).toBeGreaterThan(0);
  unmount();
  vi.stubGlobal("matchMedia", reduce);
  const reduced = render(<AreaTrend label="Anim" valueFormat={String} series={TWO_SERIES} />);
  expect(reduced.container.querySelectorAll("[data-animate]")).toHaveLength(0);
});

// ── Gaps and bad numbers (fix round 1) ──────────────────────────────────────

test("area trend shows null and NaN values as dashes and plots only finite points", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <AreaTrend
      label="Gappy"
      valueFormat={(v) => `${v} x`}
      series={[
        { key: "a", label: "Alpha", color: 1, points: [{ date: "2026-09-01", value: null }, { date: "2026-09-02", value: 4 }, { date: "2026-09-03", value: Number.NaN }] },
        { key: "b", label: "Beta", color: 2, points: [{ date: "2026-09-01", value: Number.NaN }, { date: "2026-09-02", value: null }] },
      ]}
    />,
  );
  const table = screen.getByRole("table", { name: "Gappy data" });
  expect(within(within(table).getByRole("row", { name: /^1 Sep/ })).getAllByRole("cell").map((td) => td.textContent)).toEqual(["—", "—"]);
  expect(within(within(table).getByRole("row", { name: /^2 Sep/ })).getAllByRole("cell").map((td) => td.textContent)).toEqual(["4 x", "—"]);
  const chart = screen.getByRole("img", { name: /Gappy/ });
  expect(chart.getAttribute("aria-label")).toMatch(/Alpha latest —, peak 4 x; Beta no data/);
  await user.tab();
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Alpha\s*—.*Beta\s*—/);
  expect(container.querySelector("[data-line]")).toHaveAttribute("d", expect.stringMatching(/^M[\d.]+ [\d.]+$/));
  expect(container.innerHTML).not.toMatch(/null|NaN|Infinity|undefined/);
});

test("area trend clamps negative values to the baseline", () => {
  const height = 180;
  const { container } = render(
    <AreaTrend label="Neg" height={height} valueFormat={String} series={[{ key: "a", label: "A", color: 1, points: [{ date: "2026-09-01", value: -5 }, { date: "2026-09-02", value: 3 }] }]} />,
  );
  const d = container.querySelector("[data-line]")?.getAttribute("d") ?? "";
  const ys = [...d.matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
  expect(ys).toHaveLength(2);
  const baseline = Number(container.querySelector("[data-gridline]")?.getAttribute("y1")) - 0.5;
  for (const y of ys) expect(y).toBeLessThanOrEqual(baseline);
  expect(ys[0]).toBe(baseline);
});

test("area trend survives an invalid date", () => {
  render(<AreaTrend label="Odd" valueFormat={String} series={[{ key: "a", label: "A", color: 1, points: [{ date: "garbage", value: 1 }] }]} />);
  expect(within(screen.getByRole("table", { name: "Odd data" })).getByRole("row", { name: /^—/ })).toBeInTheDocument();
});

test("kpi tile treats a non-finite change as no comparison", () => {
  const { rerender } = render(<KpiTile label="Rate" value="4" delta={{ pct: Number.NaN, direction: "up", good: true }} />);
  expect(screen.getByText("—", { selector: "[data-delta]" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Rate: 4, no earlier period to compare" })).toBeInTheDocument();
  rerender(<KpiTile label="Rate" value="4" delta={{ pct: Number.POSITIVE_INFINITY, direction: "up", good: true }} />);
  expect(screen.getByText("—", { selector: "[data-delta]" })).toHaveClass("text-dim");
  expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/);
});

test("bar list, funnel, sparkline and latency band never print NaN", () => {
  const { container } = render(
    <>
      <BarList label="Bars" valueFormat={String} items={[{ label: "a", value: Number.NaN }, { label: "b", value: 2 }]} />
      <Funnel label="Stages" valueFormat={String} stages={[{ label: "a", count: Number.NaN, value: Number.NaN }, { label: "b", count: 3 }]} />
      <Sparkline label="Spark" values={[Number.NaN, 2, Number.POSITIVE_INFINITY, 5]} />
      <LatencyBand p50={Number.NaN} p95={200} max={400} />
    </>,
  );
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(screen.getAllByText("—", { selector: "[data-value]" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("img", { name: "Spark: from 2 to 5" })).toBeInTheDocument();
  expect(container.querySelectorAll("[data-bar]")).toHaveLength(1);
});

test("latency bands take their own label for distinct accessible names", () => {
  render(
    <>
      <LatencyBand label="Supplier A latency" p50={100} p95={300} max={500} />
      <LatencyBand label="Supplier B latency" p50={80} p95={200} max={500} />
    </>,
  );
  expect(screen.getByRole("img", { name: /^Supplier A latency: p50 100 ms/ })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Supplier B latency data" })).toBeInTheDocument();
});

test("a tiny bar is clipped to its own width, with no square cap overstating it", () => {
  const { container } = render(<BarList label="Skewed" valueFormat={String} items={[{ label: "big", value: 1000 }, { label: "tiny", value: 1 }]} />);
  const tiny = container.querySelectorAll("[data-bar]")[1];
  expect(tiny?.tagName.toLowerCase()).toBe("svg");
  expect(tiny).toHaveAttribute("width", "0.1%");
  expect(tiny).toHaveAttribute("overflow", "hidden");
  expect(tiny?.parentElement?.querySelectorAll("rect")).toHaveLength(1);
});
