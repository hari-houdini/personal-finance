// Hierarchy and merchant family: treemap, sunburst, shop tree, network, radar, bullet, slope,
// top-merchant bars, and the frequency-versus-average bubble chart.
import {
  catColor, catLabel, compactMoney, emptyState, frame, hitTarget, measure, money, subLabel, svgRoot,
} from "./core.js";

const todayMonth = () => new Date().toISOString().slice(0, 7);

// Only months that have finished. The current month is partial and would skew averages.
export function completeMonths(monthly) {
  const now = todayMonth();
  return monthly.filter((m) => m.month < now);
}

// Colour for any node: the category it belongs to, so a sub-category or merchant reads as part of it.
function nodeCategory(d) {
  let node = d;
  while (node.depth > 1) node = node.parent;
  return node.data.id;
}

function nodeLabel(d) {
  if (d.depth === 1) return catLabel(d.data.id);
  if (d.depth === 2) return subLabel(d.data.id);
  return d.data.id;
}

function flatten(root) {
  const rows = [];
  root.leaves().forEach((leaf) => {
    const path = leaf.ancestors().reverse().slice(1).map(nodeLabel);
    rows.push([path.join(" › "), money(leaf.value)]);
  });
  return rows;
}

function treeTable(root, caption) {
  return {
    caption,
    headers: ["Path", "Spent"],
    rows: flatten(root),
    numeric: [1],
  };
}

// ---- Treemap: category -> sub-category -> merchant, area = spending ----
export function treemap(host, data, caption = "Spending tree") {
  if (!data || !data.children || !data.children.length) return emptyState(host);
  const width = measure(host);
  const height = Math.round(Math.min(560, Math.max(320, width * 0.5)));
  const root = d3.hierarchy(data).sum((d) => (d.children ? 0 : d.value)).sort((a, b) => b.value - a.value);
  d3.treemap().size([width, height]).paddingOuter(3).paddingTop((d) => (d.depth === 1 ? 20 : 2)).paddingInner(2).round(true)(root);
  const legend = root.children.slice(0, 8).map((c) => ({ label: catLabel(c.data.id), color: catColor(c.data.id) }));
  const plot = frame(host, { label: caption, legend, table: treeTable(root, caption) });
  const svg = svgRoot(plot, width, height, `${caption}: treemap of spending`);
  const nodes = root.descendants().filter((d) => d.depth > 0);
  const g = svg.append("g").selectAll("g").data(nodes).join("g").attr("transform", (d) => `translate(${d.x0},${d.y0})`);
  g.append("rect")
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("rx", 2)
    .attr("fill", (d) => catColor(nodeCategory(d)))
    .attr("fill-opacity", (d) => (d.depth === 1 ? 0.22 : d.depth === 2 ? 0.55 : 0.85))
    .attr("stroke", "var(--surface)")
    .each(function (d) {
      hitTarget(d3.select(this), { title: nodeLabel(d), rows: [{ label: "Spent", color: catColor(nodeCategory(d)), value: money(d.value) }] });
    });
  g.filter((d) => d.depth === 1).append("text")
    .attr("x", 6).attr("y", 14).attr("class", "label-strong").attr("font-weight", 600)
    .text((d) => ((d.x1 - d.x0) > 80 ? nodeLabel(d) : ""));
  g.filter((d) => d.depth > 1).append("text")
    .attr("x", 4).attr("y", 13).attr("class", "label-strong").attr("font-size", 11)
    .text((d) => ((d.x1 - d.x0) > 64 && (d.y1 - d.y0) > 22 ? nodeLabel(d) : ""));
}

// ---- Sunburst: the same tree, radially ----
export function sunburst(host, data, caption = "Spending tree") {
  if (!data || !data.children || !data.children.length) return emptyState(host);
  const width = measure(host);
  const size = Math.min(width, 460);
  const radius = size / 2;
  const root = d3.hierarchy(data).sum((d) => (d.children ? 0 : d.value)).sort((a, b) => b.value - a.value);
  d3.partition().size([2 * Math.PI, radius * radius / 1.6])(root);
  const arc = d3.arc()
    .startAngle((d) => d.x0).endAngle((d) => d.x1)
    .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
    .padRadius(radius / 2)
    .innerRadius((d) => Math.sqrt(d.y0)).outerRadius((d) => Math.max(Math.sqrt(d.y0), Math.sqrt(d.y1) - 1));
  const legend = root.children.slice(0, 8).map((c) => ({ label: catLabel(c.data.id), color: catColor(c.data.id) }));
  const plot = frame(host, { label: caption, legend, table: treeTable(root, caption) });
  const svg = svgRoot(plot, size, size, `${caption}: sunburst of spending`);
  svg.attr("viewBox", `${-radius} ${-radius} ${size} ${size}`).style("max-width", "100%");
  svg.append("g").selectAll("path").data(root.descendants().filter((d) => d.depth > 0)).join("path")
    .attr("d", arc)
    .attr("fill", (d) => catColor(nodeCategory(d)))
    .attr("fill-opacity", (d) => (d.depth === 1 ? 0.9 : d.depth === 2 ? 0.6 : 0.4))
    .attr("stroke", "var(--surface)")
    .each(function (d) {
      hitTarget(d3.select(this), { title: nodeLabel(d), rows: [{ label: "Spent", color: catColor(nodeCategory(d)), value: money(d.value) }] });
    });
}

// ---- Shop tree: merchants only, sized by spend ----
export function shopsTree(host, merchants) {
  if (!merchants.length) return emptyState(host);
  const width = measure(host);
  const height = Math.round(Math.min(360, Math.max(220, width * 0.36)));
  const root = d3.hierarchy({ id: "shops", children: merchants.map((m) => ({ id: m.merchant, value: m.value })) })
    .sum((d) => d.value || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([width, height]).paddingInner(2).round(true)(root);
  const leaves = root.leaves();
  const plot = frame(host, {
    label: "Shops",
    table: { caption: "Shops", headers: ["Shop", "Spent"], rows: leaves.map((l) => [l.data.id, money(l.value)]), numeric: [1] },
  });
  const svg = svgRoot(plot, width, height, "Treemap of spending by shop");
  const g = svg.append("g").selectAll("g").data(leaves).join("g").attr("transform", (d) => `translate(${d.x0},${d.y0})`);
  g.append("rect").attr("width", (d) => d.x1 - d.x0).attr("height", (d) => d.y1 - d.y0).attr("rx", 2)
    .attr("fill", "var(--series-1)").attr("fill-opacity", (d, i) => Math.max(0.35, 0.9 - i * 0.02))
    .attr("stroke", "var(--surface)")
    .each(function (d) { hitTarget(d3.select(this), { title: d.data.id, rows: [{ label: "Spent", value: money(d.value) }] }); });
  g.append("text").attr("x", 5).attr("y", 14).attr("class", "label-strong").attr("font-size", 11)
    .text((d) => ((d.x1 - d.x0) > 70 && (d.y1 - d.y0) > 24 ? d.data.id : ""));
}

// ---- Network: merchants linked to the sub-categories they are filed under ----
export function network(host, merchants) {
  const top = merchants.slice(0, 18);
  if (!top.length) return emptyState(host);
  const width = measure(host);
  const height = Math.round(Math.min(460, Math.max(320, width * 0.5)));
  const subs = [...new Set(top.flatMap((m) => m.subcategories))];
  const nodes = [
    ...top.map((m) => ({ id: `m:${m.merchant}`, label: m.merchant, kind: "merchant", value: m.value })),
    ...subs.map((s) => ({ id: `s:${s}`, label: subLabel(s), kind: "sub", value: 0, sub: s })),
  ];
  const links = top.flatMap((m) => m.subcategories.map((s) => ({ source: `m:${m.merchant}`, target: `s:${s}` })));
  const maxVal = d3.max(top, (m) => m.value) || 1;
  const radius = (n) => (n.kind === "sub" ? 7 : 4 + Math.sqrt(n.value / maxVal) * 12);
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(70).strength(0.6))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius((n) => radius(n) + 6))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  const plot = frame(host, {
    label: "Network of merchants and sub-categories",
    legend: [{ label: "Merchant (size = spend)", color: "var(--series-1)" }, { label: "Sub-category", color: "var(--ink-3)" }],
    table: {
      caption: "Merchants and their sub-categories",
      headers: ["Merchant", "Spent", "Sub-categories"],
      rows: top.map((m) => [m.merchant, money(m.value), m.subcategories.map(subLabel).join(", ")]),
      numeric: [1],
    },
  });
  const svg = svgRoot(plot, width, height, "Network of merchants linked to sub-categories");
  svg.append("g").attr("stroke", "var(--ink-3)").attr("stroke-opacity", 0.4).selectAll("line").data(links).join("line")
    .attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
  const g = svg.append("g").selectAll("g").data(nodes).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`);
  g.append("circle").attr("r", radius).attr("fill", (d) => (d.kind === "sub" ? "var(--surface)" : "var(--series-1)"))
    .attr("fill-opacity", (d) => (d.kind === "sub" ? 1 : 0.8))
    .attr("stroke", (d) => (d.kind === "sub" ? "var(--ink-3)" : "var(--series-1)")).attr("stroke-width", 1.5)
    .each(function (d) {
      hitTarget(d3.select(this), { title: d.label, rows: d.kind === "merchant" ? [{ label: "Spent", value: money(d.value) }] : [{ label: "Sub-category", value: d.label }] });
    });
  g.filter((d) => d.kind === "merchant").append("text").attr("y", (d) => -radius(d) - 4).attr("text-anchor", "middle")
    .attr("class", "label-strong").attr("font-size", 11).text((d) => (d.value >= maxVal * 0.5 ? d.label : ""));
}

// ---- Radar: per-category monthly average, recent three vs earlier three ----
export function radar(host, monthly) {
  const done = completeMonths(monthly);
  if (done.length < 2) return emptyState(host, "Needs at least two complete months in these dates.");
  const recent = done.slice(-3);
  const earlier = done.slice(-6, -3);
  const avg = (rows, cat) => (rows.length ? d3.mean(rows, (m) => m.by_category[cat] || 0) : 0);
  const totals = {};
  for (const m of done) for (const [c, v] of Object.entries(m.by_category)) totals[c] = (totals[c] || 0) + v;
  const axes = Object.keys(totals).filter((c) => CATEGORY_SLOTS_ARR.includes(c)).sort((a, b) => totals[b] - totals[a]).slice(0, 8);
  if (axes.length < 3) return emptyState(host, "Needs at least three categories.");
  const width = measure(host);
  const size = Math.min(width, 380);
  const r = size / 2 - 56;
  const maxVal = Math.max(1, ...axes.map((a) => Math.max(avg(recent, a), avg(earlier, a))));
  const angle = (i) => (i / axes.length) * Math.PI * 2 - Math.PI / 2;
  const pt = (i, v) => [Math.cos(angle(i)) * (v / maxVal) * r, Math.sin(angle(i)) * (v / maxVal) * r];
  const series = [
    { key: "recent", label: "Last three months", color: "var(--series-1)", values: axes.map((a) => avg(recent, a)) },
    { key: "earlier", label: "Three before", color: "var(--ink-3)", values: axes.map((a) => avg(earlier, a)) },
  ];
  const plot = frame(host, {
    label: "Radar of average monthly spending by category",
    legend: series.map((s) => ({ label: s.label, color: s.color })),
    table: {
      caption: "Average monthly spending by category",
      headers: ["Category", "Last three months", "Three before"],
      rows: axes.map((a, i) => [catLabel(a), money(series[0].values[i]), money(series[1].values[i])]),
      numeric: [1, 2],
    },
  });
  const svg = svgRoot(plot, size, size, "Radar chart of average monthly spending by category");
  svg.attr("viewBox", `0 0 ${size} ${size}`).style("max-width", "100%");
  const g = svg.append("g").attr("transform", `translate(${size / 2},${size / 2})`);
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    g.append("circle").attr("r", r * frac).attr("fill", "none").attr("stroke", "var(--grid)");
  }
  axes.forEach((a, i) => {
    const [x, y] = pt(i, maxVal);
    g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", x).attr("y2", y).attr("stroke", "var(--grid)");
    const lx = Math.cos(angle(i)) * (r + 22);
    const ly = Math.sin(angle(i)) * (r + 22);
    g.append("text").attr("x", lx).attr("y", ly).attr("dy", "0.35em")
      .attr("text-anchor", Math.abs(lx) < 6 ? "middle" : lx > 0 ? "start" : "end").attr("class", "label-strong").attr("font-size", 11).text(catLabel(a));
  });
  for (const s of series) {
    const points = s.values.map((v, i) => pt(i, v));
    const path = `M${points.map((p) => p.join(",")).join("L")}Z`;
    g.append("path").attr("d", path).attr("fill", s.color).attr("fill-opacity", s.key === "recent" ? 0.18 : 0.04)
      .attr("stroke", s.color).attr("stroke-width", s.key === "recent" ? 2 : 1.25);
    points.forEach((p, i) => {
      g.append("circle").attr("cx", p[0]).attr("cy", p[1]).attr("r", 4).attr("fill", s.color)
        .each(function () {
          hitTarget(d3.select(this), { title: catLabel(axes[i]), rows: [{ label: s.label, color: s.color, value: money(s.values[i]) }] });
        });
    });
  }
}

const CATEGORY_SLOTS_ARR = ["housing", "food", "transport", "eating_out", "shopping", "subscriptions", "health", "entertainment"];

// ---- Bullet: latest complete month per category against the three before it ----
export function bullet(host, monthly) {
  const done = completeMonths(monthly);
  if (done.length < 2) return emptyState(host, "Needs at least two complete months in these dates.");
  const latest = done[done.length - 1];
  const prior = done.slice(-4, -1);
  const cats = Object.keys(latest.by_category).sort((a, b) => (latest.by_category[b] || 0) - (latest.by_category[a] || 0)).slice(0, 10);
  if (!cats.length) return emptyState(host);
  const rows = cats.map((c) => ({
    id: c,
    value: latest.by_category[c] || 0,
    typical: prior.length ? d3.mean(prior, (m) => m.by_category[c] || 0) : 0,
  }));
  const width = measure(host);
  const rowH = 30;
  const labelW = 130;
  const height = rows.length * rowH + 28;
  const max = d3.max(rows, (r) => Math.max(r.value, r.typical)) * 1.1 || 1;
  const x = d3.scaleLinear().domain([0, max]).range([labelW, width - 16]);
  const plot = frame(host, {
    label: "Bullet chart of latest month against typical",
    legend: [{ label: "Latest complete month", color: "var(--series-1)" }, { label: "Three-month average", color: "var(--ink)", shape: "line" }],
    table: {
      caption: "Latest month against typical",
      headers: ["Category", "Latest month", "Typical"],
      rows: rows.map((r) => [catLabel(r.id), money(r.value), money(r.typical)]),
      numeric: [1, 2],
    },
  });
  const svg = svgRoot(plot, width, height, "Bullet chart of latest month spending against the three-month average");
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    svg.append("text").attr("x", 0).attr("y", y + 12).attr("class", "label-strong").attr("font-size", 12).text(catLabel(r.id));
    svg.append("rect").attr("x", labelW).attr("y", y).attr("width", x(max) - labelW).attr("height", 14).attr("rx", 2).attr("fill", "var(--grid)")
      .each(function () { hitTarget(d3.select(this), { title: catLabel(r.id), rows: [{ label: "Latest month", value: money(r.value) }, { label: "Typical", value: money(r.typical) }] }); });
    svg.append("rect").attr("x", labelW).attr("y", y + 3).attr("width", Math.max(1, x(r.value) - labelW)).attr("height", 8).attr("rx", 2).attr("fill", catColor(r.id));
    svg.append("rect").attr("x", x(r.typical) - 1.5).attr("y", y - 2).attr("width", 3).attr("height", 18).attr("fill", "var(--ink)");
  });
}

// ---- Slope: change per category from the month before to the latest complete month ----
export function slope(host, monthly) {
  const done = completeMonths(monthly);
  if (done.length < 2) return emptyState(host, "Needs at least two complete months in these dates.");
  const a = done[done.length - 2];
  const b = done[done.length - 1];
  const cats = [...new Set([...Object.keys(a.by_category), ...Object.keys(b.by_category)])]
    .sort((p, q) => (b.by_category[q] || 0) - (b.by_category[p] || 0)).slice(0, 8);
  if (!cats.length) return emptyState(host);
  const width = measure(host);
  const height = Math.max(260, cats.length * 34 + 40);
  const max = d3.max(cats, (c) => Math.max(a.by_category[c] || 0, b.by_category[c] || 0)) || 1;
  const y = d3.scaleLinear().domain([0, max]).nice().range([height - 24, 24]);
  const xL = width * 0.3;
  const xR = width * 0.7;
  const plot = frame(host, {
    label: "Slope chart of spending change by category",
    legend: cats.map((c) => ({ label: catLabel(c), color: catColor(c) })),
    table: {
      caption: "Change by category",
      headers: ["Category", "Earlier month", "Latest month", "Change"],
      rows: cats.map((c) => {
        const p = a.by_category[c] || 0;
        const q = b.by_category[c] || 0;
        return [catLabel(c), money(p), money(q), money(q - p)];
      }),
      numeric: [1, 2, 3],
    },
  });
  const svg = svgRoot(plot, width, height, "Slope chart from the earlier month to the latest complete month");
  svg.append("text").attr("x", xL).attr("y", 14).attr("text-anchor", "middle").attr("font-size", 11).text(b && a ? monthText(a.month) : "");
  svg.append("text").attr("x", xR).attr("y", 14).attr("text-anchor", "middle").attr("font-size", 11).text(monthText(b.month));
  cats.forEach((c) => {
    const p = a.by_category[c] || 0;
    const q = b.by_category[c] || 0;
    const color = catColor(c);
    svg.append("line").attr("x1", xL).attr("x2", xR).attr("y1", y(p)).attr("y2", y(q))
      .attr("stroke", color).attr("stroke-width", 2).attr("stroke-linecap", "round")
      .each(function () { hitTarget(d3.select(this), { title: catLabel(c), rows: [{ label: "Earlier", value: money(p) }, { label: "Latest", value: money(q) }] }); });
    svg.append("circle").attr("cx", xL).attr("cy", y(p)).attr("r", 4).attr("fill", color);
    svg.append("circle").attr("cx", xR).attr("cy", y(q)).attr("r", 4).attr("fill", color);
    svg.append("text").attr("x", xL - 8).attr("y", y(p)).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", 11).text(`${catLabel(c)} ${compactMoney(p)}`);
    svg.append("text").attr("x", xR + 8).attr("y", y(q)).attr("dy", "0.35em").attr("font-size", 11).attr("class", "label-strong").text(`${compactMoney(q)}`);
  });
}

function monthText(ym) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(new Date(`${ym}-01T00:00:00`));
}

// ---- Top merchants: horizontal bars ----
export function hbar(host, merchants) {
  const top = merchants.slice(0, 15);
  if (!top.length) return emptyState(host);
  const width = measure(host);
  const rowH = 26;
  const labelW = Math.min(170, width * 0.36);
  const height = top.length * rowH + 20;
  const x = d3.scaleLinear().domain([0, top[0].value]).nice().range([labelW, width - 60]);
  const plot = frame(host, {
    label: "Top merchants by spend",
    table: { caption: "Top merchants", headers: ["Merchant", "Spent", "Visits", "Average"], rows: top.map((m) => [m.merchant, money(m.value), m.count, money(m.average)]), numeric: [1, 2, 3] },
  });
  const svg = svgRoot(plot, width, height, "Horizontal bars of the top merchants by spend");
  top.forEach((m, i) => {
    const y = i * rowH + 6;
    svg.append("text").attr("x", labelW - 8).attr("y", y + 11).attr("text-anchor", "end").attr("class", "label-strong").attr("font-size", 12).text(truncate(m.merchant, 26));
    svg.append("rect").attr("x", labelW).attr("y", y).attr("width", Math.max(2, x(m.value) - labelW)).attr("height", 16).attr("rx", 2)
      .attr("fill", "var(--series-1)")
      .each(function () { hitTarget(d3.select(this), { title: m.merchant, rows: [{ label: "Spent", value: money(m.value) }, { label: "Visits", value: String(m.count) }, { label: "Average", value: money(m.average) }] }); });
    svg.append("text").attr("x", x(m.value) + 6).attr("y", y + 12).attr("font-size", 11).text(compactMoney(m.value));
  });
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---- Bubble: visits against average amount, area = total spend ----
export function bubble(host, merchants) {
  const pts = merchants.filter((m) => m.count > 0);
  if (!pts.length) return emptyState(host);
  const width = measure(host);
  const height = Math.round(Math.min(380, Math.max(260, width * 0.5)));
  const x = d3.scaleLinear().domain([0, d3.max(pts, (m) => m.count) * 1.1 || 1]).nice().range([46, width - 16]);
  const y = d3.scaleLinear().domain([0, d3.max(pts, (m) => m.average) * 1.1 || 1]).nice().range([height - 28, 12]);
  const rScale = d3.scaleSqrt().domain([0, d3.max(pts, (m) => m.value) || 1]).range([3, 26]);
  const plot = frame(host, {
    label: "Bubble chart of visits against average amount per merchant",
    table: { caption: "Merchants by visits and average", headers: ["Merchant", "Visits", "Average", "Total"], rows: pts.map((m) => [m.merchant, m.count, money(m.average), money(m.value)]), numeric: [1, 2, 3] },
  });
  const svg = svgRoot(plot, width, height, "Bubble chart of merchants");
  svg.append("g").attr("class", "axis grid").attr("transform", `translate(46,0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(compactMoney).tickSize(-(width - 62)).tickPadding(6)).call((g) => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - 28})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(0)).call((g) => g.select(".domain").remove());
  svg.append("text").attr("x", width / 2).attr("y", height - 2).attr("text-anchor", "middle").attr("font-size", 11).text("Visits");
  const g = svg.append("g");
  pts.forEach((m, i) => {
    const cx = x(m.count);
    const cy = y(m.average);
    const cell = g.append("g");
    cell.append("circle").attr("cx", cx).attr("cy", cy).attr("r", rScale(m.value)).attr("fill", "var(--series-1)").attr("fill-opacity", 0.55).attr("stroke", "var(--series-1)");
    cell.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 14).attr("fill", "transparent")
      .each(function () { hitTarget(d3.select(this), { title: m.merchant, rows: [{ label: "Visits", value: String(m.count) }, { label: "Average", value: money(m.average) }, { label: "Total", value: money(m.value) }] }); });
    // Labels near the right edge flip to the left of their bubble so they stay inside the plot.
    const nearRight = cx > width * 0.7;
    if (i < 5) cell.append("text")
      .attr("x", nearRight ? cx - rScale(m.value) - 4 : cx + rScale(m.value) + 4)
      .attr("y", cy).attr("dy", "0.35em").attr("font-size", 11).attr("class", "label-strong")
      .attr("text-anchor", nearRight ? "end" : "start")
      .text(truncate(m.merchant, 22));
  });
}
