// Stability family: savings-rate and emergency-fund gauges, debt payments, and monthly surplus against target.
// Every figure comes from /api/stability. Balances the user enters replace the transfer-based estimates.
import { emptyState, frame, hitTarget, KIND_COLOR, measure, money, monthLabel, pct, subLabel, svgRoot, compactMoney } from "./core.js";
import { completeMonths } from "./hier.js";

// Half-circle gauge. Angles run from 9 o'clock (min) to 3 o'clock (max) over the top.
function gauge(host, { value, min, max, ticks = [], label, centre, table }) {
  const width = measure(host);
  const size = Math.min(width, 320);
  const r = size / 2 - 14;
  const height = r + 50;
  const angle = d3.scaleLinear().domain([min, max]).range([-Math.PI / 2, Math.PI / 2]).clamp(true);
  const plot = frame(host, { label, table });
  const svg = svgRoot(plot, size, height, label);
  const g = svg.append("g").attr("transform", `translate(${size / 2},${r + 14})`);
  const arc = d3.arc().innerRadius(r - 16).outerRadius(r);
  g.append("path").attr("d", arc({ startAngle: -Math.PI / 2, endAngle: Math.PI / 2 })).attr("fill", "var(--grid)");
  g.append("path").attr("d", arc({ startAngle: -Math.PI / 2, endAngle: angle(value) })).attr("fill", "var(--series-1)")
    .each(function () { hitTarget(d3.select(this), { title: label, rows: [{ label: "Now", value: centre }] }); });
  for (const t of ticks) {
    const a = angle(t.value);
    const sx = Math.sin(a);
    const cy = -Math.cos(a);
    g.append("line").attr("x1", sx * (r - 22)).attr("x2", sx * (r + 4)).attr("y1", cy * (r - 22)).attr("y2", cy * (r + 4))
      .attr("stroke", "var(--ink)").attr("stroke-width", 2);
    g.append("text").attr("x", sx * (r + 14)).attr("y", cy * (r + 14) + 4).attr("text-anchor", "middle").attr("font-size", 11).text(t.label);
  }
  g.append("text").attr("y", -r * 0.22).attr("text-anchor", "middle").attr("class", "label-strong").style("font-size", "1.5rem").text(centre);
}

// ---- Savings rate: share of earned income left after spending and debt ----
export function rateGauge(host, stab) {
  const rate = stab.savings_rate;
  const target = stab.savings_rate_target ?? 0.2;
  if (rate == null) return emptyState(host, "No earned income in the baseline window, so the rate cannot be worked out.");
  const gap = stab.monthly_gap_to_target ?? 0;
  gauge(host, {
    value: rate,
    min: Math.min(0, rate),
    max: Math.max(0.5, target * 1.25, rate),
    ticks: [{ value: target, label: `${Math.round(target * 100)}% target` }],
    label: "Gauge of savings rate against the target",
    centre: pct(rate),
    table: {
      caption: "Savings rate",
      headers: ["Measure", "Value"],
      rows: [
        ["Savings rate", pct(rate)],
        ["Target", pct(target)],
        ["Surplus a month", money(stab.baseline.surplus_monthly)],
        ["Gap to target a month", money(gap)],
      ],
      numeric: [1],
    },
  });
}

// ---- Emergency fund: months of essential spending the balance covers, against the 3 and 6 month targets ----
export function fundGauge(host, stab) {
  const ef = stab.emergency_fund;
  if (ef.months_cover == null) return emptyState(host, "Needs essential spending in the baseline window.");
  gauge(host, {
    value: ef.months_cover,
    min: 0,
    max: Math.max(ef.target_full_months, ef.months_cover) * 1.15,
    ticks: [
      { value: ef.target_start_months, label: `${ef.target_start_months} mo` },
      { value: ef.target_full_months, label: `${ef.target_full_months} mo` },
    ],
    label: "Gauge of emergency fund months covered",
    centre: `${ef.months_cover.toFixed(1)} mo`,
    table: {
      caption: "Emergency fund",
      headers: ["Measure", "Value"],
      rows: [
        ["Balance", money(ef.balance)],
        ["Source", ef.source],
        ["Months covered", ef.months_cover.toFixed(1)],
        [`Target ${ef.target_start_months} months`, money(ef.target_start_amount)],
        [`Target ${ef.target_full_months} months`, money(ef.target_full_amount)],
      ],
      numeric: [],
    },
  });
}

// ---- Debt payments: average monthly payment per debt type over the baseline window ----
export function debtBars(host, stab) {
  const items = stab.debt?.monthly_payments || [];
  if (!items.length) return emptyState(host, "No debt payments in the baseline window.");
  const width = measure(host);
  const rowH = 46;
  const barH = 14;
  const height = items.length * rowH + 4;
  const max = d3.max(items, (d) => d.monthly_payment) || 1;
  const x = d3.scaleLinear().domain([0, max]).nice().range([0, width - 64]);
  const plot = frame(host, {
    label: "Bars of monthly debt payments by type",
    table: {
      caption: "Debt payments a month",
      headers: ["Debt type", "Monthly payment"],
      rows: items.map((d) => [subLabel(d.subcategory_id), money(d.monthly_payment)]),
      numeric: [1],
    },
  });
  const svg = svgRoot(plot, width, height, "Bars of monthly debt payments by type");
  items.forEach((d, i) => {
    const y = i * rowH + 2;
    svg.append("text").attr("x", 0).attr("y", y + 12).attr("class", "label-strong").attr("font-size", 12).text(subLabel(d.subcategory_id));
    const bar = svg.append("rect").attr("x", 0).attr("y", y + 18).attr("width", Math.max(2, x(d.monthly_payment))).attr("height", barH).attr("rx", 2).attr("fill", KIND_COLOR.debt);
    hitTarget(bar, { title: subLabel(d.subcategory_id), rows: [{ label: "A month", value: money(d.monthly_payment) }] });
    svg.append("text").attr("x", x(d.monthly_payment) + 6).attr("y", y + 18 + barH - 3).attr("font-size", 11).text(compactMoney(d.monthly_payment));
  });
}

// ---- Monthly surplus: earned income minus spending and debt, per complete month, against the savings target ----
export function runway(host, stab) {
  const done = completeMonths(stab.series || []);
  if (!done.length) return emptyState(host, "Needs at least one complete month.");
  const target = stab.savings_rate_target ?? 0.2;
  const rows = done.map((m) => ({
    month: m.month,
    earned: m.earned_income,
    spending: m.spending,
    debt: m.debt_service,
    surplus: m.earned_income - m.spending - m.debt_service,
    target: m.earned_income * target,
  }));
  const width = measure(host);
  const height = 260;
  const M = { top: 14, right: 12, bottom: 28, left: 56 };
  const x = d3.scaleBand().domain(rows.map((r) => r.month)).range([M.left, width - M.right]).padding(0.25);
  const lo = Math.min(0, d3.min(rows, (r) => r.surplus));
  const hi = Math.max(0, d3.max(rows, (r) => Math.max(r.surplus, r.target)));
  const y = d3.scaleLinear().domain([lo, hi || 1]).nice().range([height - M.bottom, M.top]);
  const plot = frame(host, {
    label: "Bars of monthly surplus against the savings target",
    legend: [
      { label: "Surplus", color: KIND_COLOR.income },
      { label: "Deficit", color: KIND_COLOR.debt },
      { label: "Savings target", color: "var(--ink)", shape: "line" },
    ],
    table: {
      caption: "Monthly surplus",
      headers: ["Month", "Earned", "Spending", "Debt", "Surplus", "Target"],
      rows: rows.map((r) => [monthLabel(r.month), money(r.earned), money(r.spending), money(r.debt), money(r.surplus), money(r.target)]),
      numeric: [1, 2, 3, 4, 5],
    },
  });
  const svg = svgRoot(plot, width, height, "Bars of monthly surplus against the savings target");
  svg.append("g").attr("class", "axis grid").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(compactMoney).tickSize(-(width - M.left - M.right)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  svg.append("line").attr("x1", M.left).attr("x2", width - M.right).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "var(--ink-3)");
  rows.forEach((r) => {
    const top = y(Math.max(r.surplus, 0));
    const bottom = y(Math.min(r.surplus, 0));
    const bar = svg.append("rect").attr("x", x(r.month)).attr("width", x.bandwidth())
      .attr("y", top).attr("height", Math.max(1, bottom - top)).attr("rx", 2)
      .attr("fill", r.surplus >= 0 ? KIND_COLOR.income : KIND_COLOR.debt);
    hitTarget(bar, {
      title: monthLabel(r.month),
      rows: [{ label: "Surplus", value: money(r.surplus) }, { label: "Savings target", value: money(r.target) }],
    });
    svg.append("line").attr("x1", x(r.month) - 2).attr("x2", x(r.month) + x.bandwidth() + 2)
      .attr("y1", y(r.target)).attr("y2", y(r.target)).attr("stroke", "var(--ink)").attr("stroke-width", 2);
  });
  const step = Math.max(1, Math.ceil(44 / x.bandwidth()));
  const monthTicks = rows.map((r) => r.month).filter((_, i) => i % step === 0);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(monthTicks).tickFormat(monthLabel).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());
}
