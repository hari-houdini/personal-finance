// Cash-flow family: stacked area, streamgraph, waterfall, 100% bars, Sankey, chord, donut.
// Each chart takes ctx = { select, go, filters, refresh }. A click calls select(patch), which filters the
// whole page (and toggles off when the same value is clicked again). go(view, patch) filters and opens a view.
import {
  CATEGORY_SLOTS, KIND_COLOR, OTHER_COLOR, catColor, catLabel, compactMoney, emptyState, frame,
  hitTarget, isPicked, markPicked, measure, money, monthLabel, subLabel, svgRoot, slotFor, tintFor,
} from "./core.js";

const M = { top: 12, right: 12, bottom: 28, left: 52 };

function xBand(months, width) {
  return d3.scalePoint().domain(months).range([M.left, width - M.right]).padding(0);
}

function yScale(max, height, min = 0) {
  return d3.scaleLinear().domain([min, max || 1]).nice().range([height - M.bottom, M.top]);
}

function drawXAxis(svg, x, height, months) {
  const tickEvery = Math.max(1, Math.ceil(months.length / 8));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(months.filter((_, i) => i % tickEvery === 0)).tickFormat(monthLabel).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());
}

function drawYAxis(svg, y, width) {
  svg.append("g").attr("class", "axis grid")
    .attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(compactMoney).tickSize(-(width - M.left - M.right)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
}

// A full-height, transparent column per month. Clicking anywhere in the month's column selects it.
function monthColumns(svg, x, months, width, height, ctx, rows) {
  const step = months.length > 1 ? x(months[1]) - x(months[0]) : width - M.left - M.right;
  svg.append("g").selectAll("rect").data(months).join("rect")
    .attr("x", (m) => x(m) - step / 2).attr("y", M.top).attr("width", step).attr("height", height - M.top - M.bottom)
    .attr("fill", "transparent")
    .each(function (m) {
      const row = rows.find((r) => r.month === m);
      hitTarget(d3.select(this), {
        title: monthLabel(m),
        rows: row ? [{ label: "Spending", value: money(row.spending) }] : [],
        onSelect: () => ctx.select({ month: m }),
      });
    });
}

// ---- Stacked area: spending, debt, savings stacked; income as a line ----
export function stackedArea(host, monthly, ctx) {
  if (!monthly.length) return emptyState(host);
  const width = measure(host);
  const height = 260;
  const months = monthly.map((m) => m.month);
  const keys = ["spending", "debt_service", "savings_out"];
  const colors = { spending: KIND_COLOR.spending, debt_service: KIND_COLOR.debt, savings_out: KIND_COLOR.savings };
  const labels = { spending: "Spending", debt_service: "Debt", savings_out: "Savings" };
  const data = monthly.map((m) => ({ month: m.month, spending: m.spending, debt_service: m.debt_service, savings_out: m.savings_out, income: m.earned_income + m.other_income }));
  const stacked = d3.stack().keys(keys)(data);
  const max = Math.max(d3.max(data, (d) => d.income) || 0, d3.max(stacked, (s) => d3.max(s, (d) => d[1])) || 0);
  const x = xBand(months, width);
  const y = yScale(max, height);
  const plot = frame(host, {
    label: "Monthly spending, debt and savings, with income",
    legend: [
      ...keys.map((k) => ({ label: labels[k], color: colors[k] })),
      { label: "Income", color: KIND_COLOR.income, shape: "line" },
    ],
    table: {
      caption: "Monthly cash flow",
      headers: ["Month", "Income", "Spending", "Debt", "Savings"],
      rows: data.map((d) => [monthLabel(d.month), money(d.income), money(d.spending), money(d.debt_service), money(d.savings_out)]),
      numeric: [1, 2, 3, 4],
      actions: data.map((d) => () => ctx.select({ month: d.month })),
    },
  });
  const svg = svgRoot(plot, width, height, "Stacked area of monthly spending, debt and savings with income line");
  drawYAxis(svg, y, width);
  drawXAxis(svg, x, height, months);
  const area = d3.area().x((d) => x(d.data.month)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(stacked).join("path")
    .attr("fill", (s) => colors[s.key]).attr("fill-opacity", 0.85).attr("d", area)
    .attr("stroke", "var(--surface)").attr("stroke-width", 1);
  const line = d3.line().x((d) => x(d.month)).y((d) => y(d.income)).curve(d3.curveMonotoneX);
  svg.append("path").datum(data).attr("fill", "none").attr("stroke", KIND_COLOR.income).attr("stroke-width", 2).attr("d", line);
  svg.append("g").selectAll("circle").data(data).join("circle")
    .attr("cx", (d) => x(d.month)).attr("cy", (d) => y(d.income)).attr("r", 4)
    .attr("fill", "var(--surface)").attr("stroke", KIND_COLOR.income).attr("stroke-width", 2)
    .each(function (d) {
      hitTarget(d3.select(this), {
        title: monthLabel(d.month),
        rows: [
          { label: "Income", color: KIND_COLOR.income, value: money(d.income) },
          { label: "Spending", color: KIND_COLOR.spending, value: money(d.spending) },
          { label: "Debt", color: KIND_COLOR.debt, value: money(d.debt_service) },
          { label: "Savings", color: KIND_COLOR.savings, value: money(d.savings_out) },
        ],
        onSelect: () => ctx.select({ month: d.month }),
      });
    });
  monthColumns(svg, x, months, width, height, ctx, data);
}

// ---- Streamgraph: spending by category over months, wiggle-offset ----
export function streamgraph(host, monthly, ctx) {
  if (!monthly.length) return emptyState(host);
  const width = measure(host);
  const height = 280;
  const months = monthly.map((m) => m.month);
  const totals = {};
  for (const m of monthly) for (const [c, v] of Object.entries(m.by_category)) totals[c] = (totals[c] || 0) + v;
  const ranked = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const top = ranked.filter((c) => CATEGORY_SLOTS.includes(c)).slice(0, 8);
  const keys = [...top];
  const rest = ranked.filter((c) => !top.includes(c));
  if (rest.length) keys.push("__other__");
  if (!keys.length) return emptyState(host);
  const data = monthly.map((m) => {
    const row = { month: m.month };
    for (const k of top) row[k] = m.by_category[k] || 0;
    row.__other__ = rest.reduce((s, c) => s + (m.by_category[c] || 0), 0);
    return row;
  });
  const stacked = d3.stack().keys(keys).offset(d3.stackOffsetWiggle)(data);
  const ymin = d3.min(stacked, (s) => d3.min(s, (d) => d[0]));
  const ymax = d3.max(stacked, (s) => d3.max(s, (d) => d[1]));
  const x = xBand(months, width);
  const y = yScale(ymax, height, ymin);
  const colorOf = (k) => (k === "__other__" ? OTHER_COLOR : catColor(k));
  const nameOf = (k) => (k === "__other__" ? "Other" : catLabel(k));
  const plot = frame(host, {
    label: "Streamgraph of spending by category over time",
    legend: keys.map((k) => ({ label: nameOf(k), color: colorOf(k) })),
    table: {
      caption: "Spending by category by month",
      headers: ["Month", ...keys.map(nameOf)],
      rows: data.map((d) => [monthLabel(d.month), ...keys.map((k) => money(d[k]))]),
      numeric: keys.map((_, i) => i + 1),
      actions: data.map((d) => () => ctx.select({ month: d.month })),
    },
  });
  const svg = svgRoot(plot, width, height, "Streamgraph of spending by category by month");
  const area = d3.area().x((d) => x(d.data.month)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
  svg.append("g").selectAll("path").data(stacked).join("path")
    .attr("fill", (s) => colorOf(s.key)).attr("fill-opacity", 0.9).attr("d", area)
    .attr("stroke", "var(--surface)").attr("stroke-width", 0.5)
    .each(function (s) {
      const name = nameOf(s.key);
      const category = s.key === "__other__" ? "" : s.key;
      hitTarget(d3.select(this), {
        title: name,
        rows: [{ label: "Spent", color: colorOf(s.key), value: money(totals[s.key] || 0) }],
        onSelect: category ? () => ctx.select({ category }) : null,
      });
    });
  drawXAxis(svg, x, height, months);
}

// ---- Waterfall: monthly net as floating steps, running total line ----
export function waterfall(host, monthly, ctx) {
  if (!monthly.length) return emptyState(host);
  const width = measure(host);
  const height = 240;
  const months = monthly.map((m) => m.month);
  let running = 0;
  const steps = monthly.map((m) => {
    const start = running;
    running += m.net;
    return { month: m.month, start, end: running, delta: m.net };
  });
  const lo = Math.min(0, d3.min(steps, (s) => Math.min(s.start, s.end)));
  const hi = Math.max(0, d3.max(steps, (s) => Math.max(s.start, s.end)));
  const x = xBand(months, width);
  const y = yScale(hi, height, lo);
  const band = (width - M.left - M.right) / months.length;
  const bw = Math.max(4, Math.min(22, band * 0.6));
  const plot = frame(host, {
    label: "Waterfall of monthly net",
    legend: [{ label: "Net up", color: "var(--series-1)" }, { label: "Net down", color: "var(--series-2)" }],
    table: {
      caption: "Monthly net",
      headers: ["Month", "Net", "Running total"],
      rows: steps.map((s) => [monthLabel(s.month), money(s.delta), money(s.end)]),
      numeric: [1, 2],
      actions: steps.map((s) => () => ctx.select({ month: s.month })),
    },
  });
  const svg = svgRoot(plot, width, height, "Waterfall of monthly net with running total");
  drawYAxis(svg, y, width);
  drawXAxis(svg, x, height, months);
  svg.append("line").attr("x1", M.left).attr("x2", width - M.right).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "var(--axis)");
  svg.append("g").selectAll("rect").data(steps).join("rect")
    .attr("x", (d) => x(d.month) - bw / 2)
    .attr("y", (d) => y(Math.max(d.start, d.end)))
    .attr("width", bw)
    .attr("height", (d) => Math.max(1, Math.abs(y(d.start) - y(d.end))))
    .attr("rx", 2)
    .attr("fill", (d) => (d.delta >= 0 ? "var(--series-1)" : "var(--series-2)"))
    .each(function (d) {
      hitTarget(d3.select(this), {
        title: monthLabel(d.month),
        rows: [{ label: "Net", value: money(d.delta) }, { label: "Running total", value: money(d.end) }],
        onSelect: () => ctx.select({ month: d.month }),
      });
    });
  svg.append("path").datum(steps)
    .attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 1)
    .attr("d", d3.line().x((d) => x(d.month)).y((d) => y(d.end)).curve(d3.curveStepAfter));
}

// ---- 100% stacked bars of kind mix by month ----
export function percentBars(host, monthly, ctx) {
  if (!monthly.length) return emptyState(host);
  const width = measure(host);
  const height = 240;
  const keys = ["spending", "debt_service", "savings_out"];
  const colors = [KIND_COLOR.spending, KIND_COLOR.debt, KIND_COLOR.savings];
  const names = ["Spending", "Debt", "Savings"];
  const data = monthly.map((m) => {
    const total = keys.reduce((s, k) => s + Math.max(0, m[k]), 0) || 1;
    const row = { month: m.month };
    for (const k of keys) row[k] = Math.max(0, m[k]) / total;
    row.raw = keys.map((k) => m[k]);
    return row;
  });
  const stacked = d3.stack().keys(keys)(data);
  const x = d3.scaleBand().domain(data.map((d) => d.month)).range([M.left, width - M.right]).padding(0.25);
  const y = d3.scaleLinear().domain([0, 1]).range([height - M.bottom, M.top]);
  const plot = frame(host, {
    label: "Share of spending, debt and savings by month",
    legend: names.map((n, i) => ({ label: n, color: colors[i] })),
    table: {
      caption: "Kind mix by month",
      headers: ["Month", ...names],
      rows: data.map((d) => [monthLabel(d.month), ...d.raw.map((v) => money(v))]),
      numeric: [1, 2, 3],
      actions: data.map((d) => () => ctx.select({ month: d.month })),
    },
  });
  const svg = svgRoot(plot, width, height, "100 percent stacked bars of kind mix by month");
  drawXAxis(svg, d3.scalePoint().domain(data.map((d) => d.month)).range([M.left + x.bandwidth() / 2, width - M.right - x.bandwidth() / 2]), height, data.map((d) => d.month));
  svg.append("g").attr("class", "axis grid").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")).tickSize(-(width - M.left - M.right)).tickPadding(6))
    .call((g) => g.select(".domain").remove());
  svg.append("g").selectAll("g").data(stacked).join("g").attr("fill", (s) => colors[s.index])
    .selectAll("rect").data((s) => s.map((d) => ({ ...d, key: s.key, idx: s.index })))
    .join("rect")
    .attr("x", (d) => x(d.data.month))
    .attr("y", (d) => y(d[1]))
    .attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])))
    .attr("width", x.bandwidth())
    .attr("rx", 2)
    .each(function (d) {
      const name = names[d.idx];
      hitTarget(d3.select(this), {
        title: `${monthLabel(d.data.month)}`,
        rows: [{ label: name, color: colors[d.idx], value: money(d.data.raw[d.idx]) }],
        onSelect: () => ctx.select({ month: d.data.month }),
      });
    });
}

// ---- Donut: where the money goes. Zooms in by filter: categories, then sub-categories, then shops. ----
// The level comes from the shared filter, so the donut, the crumbs and the rest of the page always agree.
// `openOther` keeps the "Other" group expanded after a click.
let openOther = false;

export function donut(host, { hierarchy, filters, select, refresh }) {
  const level = filters.subcategory ? 3 : filters.category ? 2 : 1;
  const root = hierarchy;
  let items = [];
  let centreLabel = "spent";
  let caption = "Spending by category";
  let total = root.value || 0;
  let parentId = "";

  if (level === 1) {
    items = root.children.map((c) => ({ id: c.id, value: c.value, name: catLabel(c.id), color: catColor(c.id), patch: { category: c.id } }));
  } else if (level === 2) {
    const cat = root.children[0];
    if (!cat) return emptyState(host);
    total = cat.value;
    centreLabel = "in this category";
    caption = `Spending in ${catLabel(cat.id)}, by sub-category`;
    items = (cat.children || []).map((s, i) => ({ id: s.id, value: s.value, name: subLabel(s.id), color: tintFor(cat.id, i), patch: { subcategory: s.id } }));
  } else {
    const cat = root.children[0];
    const sub = cat?.children?.[0];
    if (!sub) return emptyState(host);
    total = sub.value;
    centreLabel = "at this sub-category";
    caption = `Spending in ${subLabel(sub.id)}, by shop`;
    items = (sub.children || []).map((m, i) => ({ id: m.id, value: m.value, name: m.id, color: tintFor(cat.id, i), patch: { merchant: m.id } }));
  }

  // Level 1 only: the smallest categories fold into "Other" unless it has been expanded.
  let otherGroup = null;
  if (level === 1 && items.length > 8 && !openOther) {
    const top = items.slice(0, 7);
    const rest = items.slice(7);
    otherGroup = { id: "__other__", value: rest.reduce((s, d) => s + d.value, 0), name: "Other", color: OTHER_COLOR, members: rest };
    items = [...top, otherGroup];
  }
  items = items.filter((d) => d.value > 0);
  if (!items.length) return emptyState(host);

  const width = measure(host);
  const size = Math.min(width, 300);
  const r = size / 2 - 4;
  const share = (v) => `${((v / (total || 1)) * 100).toFixed(1)}%`;
  const actionFor = (d) => {
    if (d.id === "__other__") return () => { openOther = true; refresh(); };
    return () => select(d.patch);
  };
  const plot = frame(host, {
    label: caption,
    legend: items.map((s) => ({ label: `${s.name} (${Math.round((s.value / (total || 1)) * 100)}%)`, color: s.color })),
    table: {
      caption,
      headers: ["Name", "Spent", "Share"],
      rows: items.map((s) => [s.name, money(s.value), share(s.value)]),
      numeric: [1, 2],
      actions: items.map(actionFor),
    },
  });
  const svg = svgRoot(plot, size, size, caption);
  svg.attr("viewBox", `0 0 ${size} ${size}`).attr("width", size).style("max-width", "100%");
  const g = svg.append("g").attr("transform", `translate(${size / 2},${size / 2})`);
  const arc = d3.arc().innerRadius(r * 0.6).outerRadius(r);
  const pie = d3.pie().value((d) => d.value).sort(null).padAngle(0.012);
  g.selectAll("path").data(pie(items)).join("path")
    .attr("d", arc).attr("fill", (d) => d.data.color).attr("stroke", "var(--surface)").attr("stroke-width", 2)
    .each(function (d) {
      const isOther = d.data.id === "__other__";
      hitTarget(d3.select(this), {
        title: isOther ? (openOther ? "Other (select to fold back)" : "Other (select to show all)") : d.data.name,
        rows: [
          { label: "Spent", color: d.data.color, value: money(d.data.value) },
          { label: "Share", value: share(d.data.value) },
        ],
        onSelect: isOther ? () => { openOther = !openOther; refresh(); } : () => select(d.data.patch),
      });
      markPicked(d3.select(this), isPicked(filters, d.data.patch || {}));
    });
  g.append("text").attr("text-anchor", "middle").attr("y", -2).attr("class", "label-strong").style("font-size", "1.25rem").text(money(total));
  g.append("text").attr("text-anchor", "middle").attr("y", 16).text(centreLabel);
}

// ---- Sankey: income -> money in -> kinds -> categories, built from stated totals ----
const SANKEY_PATCH = {
  "kind:spending": { kind: "spending" },
  "kind:debt": { kind: "debt" },
  "kind:savings": { kind: "savings" },
};

export function sankey(host, kpis, hierarchy, labelFor, ctx) {
  const earned = (kpis.earned_income || 0) + (kpis.other_income || 0);
  if (earned <= 0 && !(kpis.spending > 0)) return emptyState(host, "Nothing to show: no income or spending in these dates.");
  if (typeof d3.sankey !== "function") return emptyState(host, "The Sankey layout did not load.");
  const width = measure(host);
  const height = Math.max(340, Math.min(560, (hierarchy.children || []).length * 26 + 120));
  const nodes = [];
  const links = [];
  const add = (id, label, color) => { nodes.push({ id, label, color }); };
  add("in", "Money in", "var(--ink-2)");
  add("src:earned", "Earned income", KIND_COLOR.income);
  if ((kpis.other_income || 0) > 0) add("src:other", "Other income", "var(--series-4)");
  links.push({ source: "src:earned", target: "in", value: Math.max(1, kpis.earned_income || 0) });
  if ((kpis.other_income || 0) > 0) links.push({ source: "src:other", target: "in", value: kpis.other_income });
  const spend = kpis.spending || 0;
  const debt = kpis.debt_service || 0;
  const savings = kpis.savings_out || 0;
  const left = Math.max(0, earned - spend - debt - savings);
  add("kind:spending", "Spending", KIND_COLOR.spending);
  add("kind:debt", "Debt", KIND_COLOR.debt);
  add("kind:savings", "Savings", KIND_COLOR.savings);
  if (left > 0) add("kind:left", "Left over", "var(--ink-3)");
  if (spend > 0) links.push({ source: "in", target: "kind:spending", value: spend });
  if (debt > 0) links.push({ source: "in", target: "kind:debt", value: debt });
  if (savings > 0) links.push({ source: "in", target: "kind:savings", value: savings });
  if (left > 0) links.push({ source: "in", target: "kind:left", value: left });
  for (const c of hierarchy.children || []) {
    if (c.value <= 0) continue;
    const id = `cat:${c.id}`;
    add(id, labelFor(c.id), catColor(c.id));
    links.push({ source: "kind:spending", target: id, value: c.value });
  }
  const graph = d3.sankey().nodeId((d) => d.id).nodeWidth(12).nodePadding(10).nodeAlign(d3.sankeyLeft)
    .extent([[1, 6], [width - 1, height - 6]]);
  const { nodes: n, links: l } = graph({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });
  const total = d3.sum(n.filter((d) => d.id === "in"), (d) => d.value) || 1;
  const nodePatch = (id) => {
    if (id.startsWith("cat:")) return { category: id.slice(4) };
    if (id.startsWith("src:")) return { kind: "income" };
    return SANKEY_PATCH[id] || null;
  };
  const plot = frame(host, {
    label: "Sankey diagram from income to categories",
    table: {
      caption: "Flows",
      headers: ["From", "To", "Amount"],
      rows: links.map((k) => [nodes.find((x) => x.id === k.source).label, nodes.find((x) => x.id === k.target).label, money(k.value)]),
      numeric: [2],
      actions: links.map((k) => {
        const p = nodePatch(k.target);
        return p ? () => ctx.select(p) : null;
      }),
    },
  });
  const svg = svgRoot(plot, width, height, "Sankey of income to categories");
  svg.append("g").attr("fill", "none").selectAll("path").data(l).join("path")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => (d.target.color && d.target.color.startsWith("var") ? d.target.color : "var(--ink-3)"))
    .attr("stroke-opacity", 0.35).attr("stroke-width", (d) => Math.max(1, d.width))
    .each(function (d) {
      hitTarget(d3.select(this), { title: `${d.source.label} to ${d.target.label}`, rows: [{ label: "Amount", value: money(d.value) }, { label: "Share of money in", value: `${((d.value / total) * 100).toFixed(1)}%` }] });
    });
  const node = svg.append("g").selectAll("g").data(n).join("g");
  node.append("rect").attr("x", (d) => d.x0).attr("y", (d) => d.y0).attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => Math.max(1, d.y1 - d.y0)).attr("rx", 2).attr("fill", (d) => d.color)
    .each(function (d) {
      const p = nodePatch(d.id);
      hitTarget(d3.select(this), {
        title: d.label,
        rows: [{ label: "Amount", value: money(d.value) }],
        onSelect: p ? () => ctx.select(p) : null,
      });
    });
  node.append("text").attr("x", (d) => (d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6))
    .attr("y", (d) => (d.y1 + d.y0) / 2).attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.x0 < width / 2 ? "start" : "end"))
    .attr("class", "label-strong").text((d) => `${d.label} ${compactMoney(d.value)}`);
}

// ---- Chord: transfers between accounts and kinds ----
const ACCOUNT_NAMES = new Set(["debit-card", "credit-card"]);

export function chord(host, transfers, ctx) {
  const { names, matrix } = transfers;
  const sum = matrix.flat().reduce((s, v) => s + v, 0);
  if (!names.length || sum <= 0) return emptyState(host, "No transfers in these dates.");
  const width = measure(host);
  const size = Math.min(width, 420);
  const r = size / 2 - 40;
  const label = (n) => ({ "debit-card": "Current account", "credit-card": "Credit card", "transfers.card_repayment": "Card repayment", "transfers.own_accounts": "Own accounts", "transfers.to_people": "Sent to people", "transfers.family_in": "Family in", "transfers.family_out": "Family out", "transfers.cash_withdrawal": "Cash withdrawals", "transfers.reimbursement_sent": "Reimbursements" }[n] || n);
  // Accounts open Transactions for that account; transfer kinds open Transactions for that kind.
  const goFor = (n) => (ACCOUNT_NAMES.has(n) ? { account: n } : { subcategory: n });
  const chords = d3.chord().padAngle(0.04)(matrix);
  const colors = names.map((_, i) => slotFor(i));
  // Table rows and their actions come from the same list, so they stay aligned.
  const pairs = names.flatMap((a, i) => names.map((b, j) => ({ a, b, value: matrix[i][j] }))).filter((p) => p.value > 0);
  const plot = frame(host, {
    label: "Chord diagram of transfers",
    legend: names.map((n, i) => ({ label: label(n), color: colors[i] })),
    table: {
      caption: "Transfers",
      headers: ["From", "To", "Amount"],
      rows: pairs.map((p) => [label(p.a), label(p.b), money(p.value)]),
      numeric: [2],
      actions: pairs.map((p) => () => ctx.go("transactions", goFor(p.a))),
    },
  });
  const svg = svgRoot(plot, size, size, "Chord diagram of transfers between accounts and kinds");
  svg.attr("viewBox", `0 0 ${size} ${size}`).style("max-width", "100%");
  const g = svg.append("g").attr("transform", `translate(${size / 2},${size / 2})`);
  g.append("g").selectAll("path").data(chords.groups).join("path")
    .attr("d", d3.arc().innerRadius(r).outerRadius(r + 8))
    .attr("fill", (d) => colors[d.index])
    .each(function (d) {
      hitTarget(d3.select(this), {
        title: label(names[d.index]),
        rows: [{ label: "Total moved", value: money(d.value) }],
        onSelect: () => ctx.go("transactions", goFor(names[d.index])),
      });
    });
  g.append("g").attr("fill-opacity", 0.7).selectAll("path").data(chords).join("path")
    .attr("d", d3.ribbon().radius(r))
    .attr("fill", (d) => colors[d.source.index])
    .attr("stroke", "var(--surface)").attr("stroke-width", 0.5)
    .each(function (d) {
      hitTarget(d3.select(this), {
        title: `${label(names[d.source.index])} to ${label(names[d.target.index])}`,
        rows: [{ label: "Amount", value: money(d.source.value) }],
        onSelect: () => ctx.go("transactions", goFor(names[d.source.index])),
      });
    });
  // d3 chord groups carry startAngle and endAngle; the label sits at the middle of the arc.
  const mid = (d) => (d.startAngle + d.endAngle) / 2;
  g.append("g").selectAll("text").data(chords.groups).join("text")
    .attr("x", (d) => Math.sin(mid(d)) * (r + 14))
    .attr("y", (d) => -Math.cos(mid(d)) * (r + 14))
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (Math.sin(mid(d)) > 0.2 ? "start" : Math.sin(mid(d)) < -0.2 ? "end" : "middle"))
    .attr("class", "label-strong").attr("font-size", 11)
    .text((d) => label(names[d.index]));
}
