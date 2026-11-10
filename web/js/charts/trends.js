// Trend family: monthly line with a three-month average, daily calendar heatmap, small multiples.
// Trend charts use complete months only, so the partial current month cannot look like a fall.
// Each chart takes ctx = { select }: a click filters the whole page to a month, a day or a category-month.
import { catColor, catLabel, compactMoney, dayLabel, emptyState, frame, hitTarget, KIND_COLOR, markPicked, isPicked, measure, money, monthLabel, svgRoot } from "./core.js";
import { completeMonths } from "./hier.js";

const WEEK = 7 * 86400000;
const M = { top: 14, right: 16, bottom: 28, left: 56 };

// ---- Line: monthly spending, with a trailing three-month average ----
export function line(host, monthly, ctx) {
  const done = completeMonths(monthly);
  if (done.length < 2) return emptyState(host, "Needs at least two complete months in these dates.");
  const rows = done.map((m, i) => {
    const win = done.slice(Math.max(0, i - 2), i + 1);
    return { month: m.month, spending: m.spending, average: win.length === 3 ? d3.mean(win, (w) => w.spending) : null };
  });
  const width = measure(host);
  const height = 280;
  const x = d3.scalePoint().domain(rows.map((r) => r.month)).range([M.left, width - M.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.spending) || 1]).nice().range([height - M.bottom, M.top]);
  const plot = frame(host, {
    label: "Line chart of monthly spending with a three-month average",
    legend: [
      { label: "Spending", color: KIND_COLOR.spending },
      { label: "Three-month average", color: "var(--ink)", shape: "line" },
    ],
    table: {
      caption: "Monthly spending",
      headers: ["Month", "Spent", "Three-month average"],
      rows: rows.map((r) => [monthLabel(r.month), money(r.spending), r.average == null ? "n/a" : money(r.average)]),
      numeric: [1, 2],
      actions: rows.map((r) => () => ctx.select({ month: r.month })),
    },
  });
  const svg = svgRoot(plot, width, height, "Line chart of monthly spending with a three-month average");
  svg.append("g").attr("class", "axis grid").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(compactMoney).tickSize(-(width - M.left - M.right)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  const every = Math.max(1, Math.ceil(rows.length / 8));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(rows.map((r) => r.month).filter((_, i) => i % every === 0)).tickFormat(monthLabel).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());
  const spendLine = d3.line().x((r) => x(r.month)).y((r) => y(r.spending));
  svg.append("path").datum(rows).attr("fill", "none").attr("stroke", KIND_COLOR.spending).attr("stroke-width", 2).attr("d", spendLine);
  const avgRows = rows.filter((r) => r.average != null);
  if (avgRows.length) {
    const avgLine = d3.line().x((r) => x(r.month)).y((r) => y(r.average));
    svg.append("path").datum(avgRows).attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 2).attr("d", avgLine);
  }
  svg.append("g").selectAll("circle").data(rows).join("circle")
    .attr("cx", (r) => x(r.month)).attr("cy", (r) => y(r.spending)).attr("r", 4).attr("fill", KIND_COLOR.spending)
    .each(function (r) {
      hitTarget(d3.select(this), {
        title: monthLabel(r.month),
        rows: [
          { label: "Spent", color: KIND_COLOR.spending, value: money(r.spending) },
          { label: "Three-month average", value: r.average == null ? "n/a" : money(r.average) },
        ],
        onSelect: () => ctx.select({ month: r.month }),
      });
      markPicked(d3.select(this), isPicked(ctx.filters, { month: r.month }));
    });
}

// ---- Calendar heatmap: one square per day, Monday at the top, weeks across ----
export function calendar(host, daily, ctx) {
  if (!daily.length) return emptyState(host);
  const values = new Map(daily.map((d) => [d.date, d.value]));
  const first = new Date(`${daily[0].date}T00:00:00`);
  const last = new Date(`${daily[daily.length - 1].date}T00:00:00`);
  const monday = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const origin = monday(first);
  const weekOf = (d) => Math.round((monday(d) - origin) / WEEK);
  const days = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weeks = weekOf(last) + 1;
  const width = measure(host);
  const pitch = Math.max(8, Math.min(18, Math.floor((width - 40) / weeks)));
  const size = pitch - 3;
  const height = 7 * pitch + 22;
  const max = d3.max(daily, (d) => d.value) || 1;
  const fill = (v) => {
    if (v <= 0) return "var(--grid)";
    const step = Math.min(5, Math.ceil((v / max) * 5));
    return `color-mix(in oklab, var(--series-2) ${step * 20}%, var(--surface))`;
  };
  const plot = frame(host, {
    label: "Calendar heatmap of daily spending",
    table: {
      caption: "Daily spending",
      headers: ["Day", "Spent"],
      rows: daily.map((d) => [dayLabel(d.date), money(d.value)]),
      numeric: [1],
      actions: daily.map((d) => () => ctx.select({ day: d.date })),
    },
  });
  const svg = svgRoot(plot, width, height, "Calendar heatmap of daily spending. Darker squares are days with more spending.");
  const g = svg.append("g").attr("transform", "translate(36,18)");
  [[0, "Mon"], [2, "Wed"], [4, "Fri"]].forEach(([row, label]) => {
    g.append("text").attr("x", -6).attr("y", row * pitch + size / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(label);
  });
  days.filter((d) => d.getDate() === 1 || keyOf(d) === daily[0].date).forEach((d) => {
    g.append("text").attr("x", weekOf(d) * pitch).attr("y", -6).text(monthLabel(keyOf(d).slice(0, 7)));
  });
  g.selectAll("rect").data(days).join("rect")
    .attr("x", (d) => weekOf(d) * pitch)
    .attr("y", (d) => ((d.getDay() + 6) % 7) * pitch)
    .attr("width", size).attr("height", size).attr("rx", 2)
    .style("fill", (d) => fill(values.get(keyOf(d)) || 0))
    .each(function (d) {
      const key = keyOf(d);
      const v = values.get(key) || 0;
      hitTarget(d3.select(this), { title: dayLabel(key), rows: [{ label: "Spent", value: money(v) }], onSelect: v > 0 ? () => ctx.select({ day: key }) : null });
      markPicked(d3.select(this), isPicked(ctx.filters, { day: key }));
    });
}

// ---- Small multiples: the top categories, one mini bar chart each, on one shared scale ----
export function smallMultiples(host, monthly, ctx) {
  const done = completeMonths(monthly);
  if (done.length < 2) return emptyState(host, "Needs at least two complete months in these dates.");
  const totals = {};
  for (const m of done) for (const [c, v] of Object.entries(m.by_category)) totals[c] = (totals[c] || 0) + v;
  const cats = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 6);
  if (!cats.length) return emptyState(host);
  const max = d3.max(done, (m) => d3.max(cats, (c) => m.by_category[c] || 0)) || 1;
  const width = measure(host);
  const cols = width >= 640 ? 3 : 2;
  const gap = 18;
  const cellW = (width - gap * (cols - 1)) / cols;
  const cellH = 120;
  const height = Math.ceil(cats.length / cols) * (cellH + gap) - gap;
  const x = d3.scaleBand().domain(done.map((m) => m.month)).range([0, cellW]).padding(0.2);
  const y = d3.scaleLinear().domain([0, max]).range([cellH - 22, 18]);
  const plot = frame(host, {
    label: "Small multiples of spending by category, month by month",
    table: {
      caption: "Spending by category and month",
      headers: ["Category", "Month", "Spent"],
      rows: cats.flatMap((c) => done.map((m) => [catLabel(c), monthLabel(m.month), money(m.by_category[c] || 0)])),
      numeric: [2],
      actions: cats.flatMap((c) => done.map((m) => () => ctx.select({ category: c, month: m.month }))),
    },
  });
  const svg = svgRoot(plot, width, height, "Small multiples: spending by category, month by month, on one shared scale");
  cats.forEach((c, i) => {
    const g = svg.append("g").attr("transform", `translate(${(i % cols) * (cellW + gap)},${Math.floor(i / cols) * (cellH + gap)})`);
    g.append("text").attr("x", 0).attr("y", 12).attr("class", "label-strong").attr("font-size", 12).text(catLabel(c));
    g.append("text").attr("x", cellW).attr("y", 12).attr("text-anchor", "end").text(`${compactMoney(totals[c] / done.length)} a month`);
    g.append("line").attr("x1", 0).attr("x2", cellW).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "var(--axis)");
    g.selectAll("rect").data(done).join("rect")
      .attr("x", (m) => x(m.month)).attr("width", x.bandwidth())
      .attr("y", (m) => y(m.by_category[c] || 0))
      .attr("height", (m) => Math.max(0, y(0) - y(m.by_category[c] || 0)))
      .attr("rx", 1).attr("fill", catColor(c))
      .each(function (m) {
        hitTarget(d3.select(this), {
          title: `${catLabel(c)}, ${monthLabel(m.month)}`,
          rows: [{ label: "Spent", value: money(m.by_category[c] || 0) }],
          onSelect: () => ctx.select({ category: c, month: m.month }),
        });
      });
    g.append("text").attr("x", 0).attr("y", cellH - 6).text(monthLabel(done[0].month));
    g.append("text").attr("x", cellW).attr("y", cellH - 6).attr("text-anchor", "end").text(monthLabel(done[done.length - 1].month));
  });
}
