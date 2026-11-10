// Distribution family: box plot by category, histogram of payment sizes, dot plot of every payment.
import { catColor, catLabel, CATEGORY_SLOTS, compactMoney, dayLabel, emptyState, frame, hitTarget, measure, money, OTHER_COLOR, svgRoot } from "./core.js";

// Fixed buckets read better than automatic bins for money: each one is a size a person recognises.
const BUCKETS = [
  { lo: 0, hi: 10, short: "£0–9", label: "£0 to £9" },
  { lo: 10, hi: 25, short: "£10–24", label: "£10 to £24" },
  { lo: 25, hi: 50, short: "£25–49", label: "£25 to £49" },
  { lo: 50, hi: 100, short: "£50–99", label: "£50 to £99" },
  { lo: 100, hi: 250, short: "£100–249", label: "£100 to £249" },
  { lo: 250, hi: 500, short: "£250–499", label: "£250 to £499" },
  { lo: 500, hi: 1000, short: "£500–999", label: "£500 to £999" },
  { lo: 1000, hi: Infinity, short: "£1k+", label: "£1,000 and over" },
];

// ---- Box plot: middle half of payments per category, median line, whiskers at 1.5 IQR ----
export function boxplot(host, amountsByCategory) {
  const rows = Object.entries(amountsByCategory)
    .filter(([, v]) => v.length)
    .map(([id, v]) => {
      const s = [...v].sort((a, b) => a - b);
      const q1 = d3.quantileSorted(s, 0.25);
      const med = d3.quantileSorted(s, 0.5);
      const q3 = d3.quantileSorted(s, 0.75);
      const iqr = q3 - q1;
      const lo = s.find((x) => x >= q1 - 1.5 * iqr) ?? s[0];
      const hi = [...s].reverse().find((x) => x <= q3 + 1.5 * iqr) ?? s[s.length - 1];
      return { id, s, q1, med, q3, lo, hi, outliers: s.filter((x) => x < lo || x > hi), total: d3.sum(s) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  if (!rows.length) return emptyState(host);
  const width = measure(host);
  const rowH = 36;
  const labelW = Math.min(150, width * 0.3);
  const height = rows.length * rowH + 30;
  const maxVal = d3.max(rows, (r) => r.s[r.s.length - 1]) || 1;
  const x = d3.scaleSymlog().domain([0, maxVal]).nice().range([labelW, width - 16]);
  const plot = frame(host, {
    label: "Box plot of payment sizes by category",
    table: {
      caption: "Payment sizes by category",
      headers: ["Category", "Payments", "Median", "Middle half", "Largest"],
      rows: rows.map((r) => [catLabel(r.id), r.s.length, money(r.med), `${money(r.q1)} to ${money(r.q3)}`, money(r.s[r.s.length - 1])]),
      numeric: [1, 2, 4],
    },
  });
  const svg = svgRoot(plot, width, height, "Box plot of payment sizes by category");
  rows.forEach((r, i) => {
    const cy = i * rowH + rowH / 2;
    const color = catColor(r.id);
    const g = svg.append("g");
    g.append("text").attr("x", 0).attr("y", cy).attr("dy", "0.35em").attr("class", "label-strong").attr("font-size", 12).text(catLabel(r.id));
    g.append("line").attr("x1", x(r.lo)).attr("x2", x(r.hi)).attr("y1", cy).attr("y2", cy).attr("stroke", "var(--ink-3)");
    [r.lo, r.hi].forEach((v) => {
      g.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", cy - 6).attr("y2", cy + 6).attr("stroke", "var(--ink-3)");
    });
    g.append("rect")
      .attr("x", x(r.q1)).attr("y", cy - 9).attr("width", Math.max(2, x(r.q3) - x(r.q1))).attr("height", 18).attr("rx", 2)
      .attr("fill", color).attr("fill-opacity", 0.3).attr("stroke", color)
      .each(function () {
        hitTarget(d3.select(this), {
          title: catLabel(r.id),
          rows: [
            { label: "Payments", value: String(r.s.length) },
            { label: "Median", value: money(r.med) },
            { label: "Middle half", value: `${money(r.q1)} to ${money(r.q3)}` },
            { label: "Largest", value: money(r.s[r.s.length - 1]) },
          ],
        });
      });
    g.append("line").attr("x1", x(r.med)).attr("x2", x(r.med)).attr("y1", cy - 9).attr("y2", cy + 9).attr("stroke", "var(--ink)").attr("stroke-width", 2);
    g.selectAll("circle").data(r.outliers).join("circle")
      .attr("cx", (v) => x(v)).attr("cy", cy).attr("r", 2.5).attr("fill", "var(--ink-3)").attr("fill-opacity", 0.6);
  });
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - 24})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(compactMoney).tickSize(0).tickPadding(6))
    .call((g) => g.select(".domain").remove());
}

// ---- Histogram: how many payments fall in each size band ----
export function histogram(host, amountsByCategory) {
  const all = Object.values(amountsByCategory).flat();
  if (!all.length) return emptyState(host);
  const counts = BUCKETS.map((b) => ({ ...b, count: all.filter((v) => v >= b.lo && v < b.hi).length }));
  const width = measure(host);
  const height = 240;
  const top = 18;
  const bottom = 40;
  const x = d3.scaleBand().domain(counts.map((c) => c.short)).range([36, width - 8]).padding(0.18);
  const y = d3.scaleLinear().domain([0, d3.max(counts, (c) => c.count) || 1]).nice().range([height - bottom, top]);
  const plot = frame(host, {
    label: "Histogram of spending payments by size",
    table: {
      caption: "Payments by size",
      headers: ["Size", "Payments"],
      rows: counts.map((c) => [c.label, c.count]),
      numeric: [1],
    },
  });
  const svg = svgRoot(plot, width, height, "Histogram of spending payments by size");
  svg.append("g").attr("class", "axis grid").attr("transform", "translate(36,0)")
    .call(d3.axisLeft(y).ticks(4).tickSize(-(width - 44)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - bottom})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());
  const bars = svg.append("g");
  counts.forEach((c) => {
    const bar = bars.append("rect")
      .attr("x", x(c.short)).attr("width", x.bandwidth())
      .attr("y", y(c.count)).attr("height", Math.max(0, y(0) - y(c.count)))
      .attr("rx", 2).attr("fill", "var(--series-1)");
    hitTarget(bar, { title: c.label, rows: [{ label: "Payments", value: String(c.count) }] });
    bars.append("text").attr("x", x(c.short) + x.bandwidth() / 2).attr("y", y(c.count) - 4).attr("text-anchor", "middle")
      .attr("font-size", 11).text(c.count);
  });
}

// ---- Dot plot: one dot per payment, by date (across) and size (up, symmetric log scale) ----
export function dots(host, payments) {
  if (!payments.length) return emptyState(host);
  const parse = (d) => new Date(`${d}T00:00:00`);
  const width = measure(host);
  const height = Math.round(Math.min(360, Math.max(240, width * 0.42)));
  const x = d3.scaleTime().domain(d3.extent(payments, (p) => parse(p.date))).range([46, width - 12]);
  const y = d3.scaleSymlog().domain([0, d3.max(payments, (p) => -p.amount) || 1]).nice().range([height - 24, 10]);
  const present = new Set(payments.map((p) => p.category_id));
  const legend = CATEGORY_SLOTS.filter((c) => present.has(c)).map((c) => ({ label: catLabel(c), color: catColor(c) }));
  if ([...present].some((c) => !CATEGORY_SLOTS.includes(c))) legend.push({ label: "Other", color: OTHER_COLOR });
  const plot = frame(host, {
    label: "Dot plot of every spending payment by date and size",
    legend,
    table: {
      caption: "Every payment",
      headers: ["Date", "Merchant", "Category", "Amount"],
      rows: payments.map((p) => [dayLabel(p.date), p.merchant, catLabel(p.category_id), money(-p.amount)]),
      numeric: [3],
    },
  });
  const svg = svgRoot(plot, width, height, "Dot plot of every spending payment by date and size");
  svg.append("g").attr("class", "axis grid").attr("transform", "translate(46,0)")
    .call(d3.axisLeft(y).ticks(4).tickFormat(compactMoney).tickSize(-(width - 58)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - 24})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat("%b %y")).tickSize(0).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  svg.append("g").selectAll("circle").data(payments).join("circle")
    .attr("cx", (p) => x(parse(p.date))).attr("cy", (p) => y(-p.amount)).attr("r", 3)
    .attr("fill", (p) => catColor(p.category_id)).attr("fill-opacity", 0.6)
    .each(function (p) {
      hitTarget(d3.select(this), {
        title: p.merchant,
        rows: [
          { label: "Date", value: dayLabel(p.date) },
          { label: "Amount", value: money(-p.amount) },
          { label: "Category", value: catLabel(p.category_id) },
        ],
      });
    });
}
