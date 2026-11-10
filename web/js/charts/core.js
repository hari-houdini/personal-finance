// Shared chart plumbing: formatting, stable colours, tooltip, legend, table twin.
// Every chart is built from these so the rules (labels, colours, table view) hold everywhere.
// All text goes in with textContent. Category and merchant names come from the statements.

const GBP0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const GBP2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const money = (v) => GBP0.format(v || 0);
export const money2 = (v) => GBP2.format(v || 0);
export const pct = (v) => (v == null ? "n/a" : PCT.format(v));
export const compactMoney = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1000) return `£${((v || 0) / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `£${Math.round(v || 0)}`;
};
export const monthLabel = (ym) => MONTH.format(new Date(`${ym}-01T00:00:00`));
export const dayLabel = (iso) => DAY.format(new Date(`${iso}T00:00:00`));

// Categories take a fixed slot in this order, so a colour always means the same category.
// Anything beyond eight folds into "Other" (the palette has eight categorical slots; a ninth
// generated hue is banned).
export const CATEGORY_SLOTS = [
  "housing", "food", "transport", "eating_out", "shopping", "subscriptions", "health", "entertainment",
];
export const OTHER_COLOR = "var(--ink-3)";

export function catKey(id) {
  return CATEGORY_SLOTS.includes(id) ? id : "other";
}
export function catColor(id) {
  const i = CATEGORY_SLOTS.indexOf(id);
  return i === -1 ? OTHER_COLOR : `var(--series-${i + 1})`;
}

export const KIND_COLOR = {
  income: "var(--series-1)",
  spending: "var(--series-2)",
  essential: "var(--series-2)",
  discretionary: "var(--series-2)",
  fee: "var(--series-2)",
  tax: "var(--series-2)",
  debt: "var(--series-5)",
  savings: "var(--series-3)",
  refund: "var(--series-4)",
  transfer: "var(--ink-3)",
};
export const KIND_LABEL = {
  income: "Income",
  spending: "Spending",
  debt: "Debt",
  savings: "Savings",
  transfer: "Transfers",
};

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

// Width the chart should draw at. Falls back for hidden hosts so layout never reads 0.
export function measure(host, fallback = 640) {
  const w = host.clientWidth || host.parentElement?.clientWidth || fallback;
  return Math.max(260, Math.floor(w));
}

export function emptyState(host, text = "Nothing to show for these filters.") {
  clear(host);
  host.append(el("p", { class: "help", text, role: "note" }));
}

// Build the standard frame: the figure, a legend, and a table view. Returns the svg-host node.
export function frame(host, { label, legend = [], table = null, height = null } = {}) {
  clear(host);
  const figure = el("figure", { style: "margin:0" });
  if (label) figure.setAttribute("aria-label", label);
  const plot = el("div", { class: "plot" });
  figure.append(plot);
  if (legend.length >= 2) {
    const ul = el("ul", { class: "legend", "aria-label": "Legend" });
    for (const item of legend) {
      const swatch = el("i", { class: item.shape === "line" ? "line" : "" });
      swatch.style.background = item.color;
      if (item.shape === "line") swatch.style.height = "2px";
      ul.append(el("li", {}, [swatch, document.createTextNode(item.label)]));
    }
    figure.append(ul);
  }
  if (table) figure.append(tableView(table));
  host.append(figure);
  return plot;
}

export function tableView({ caption = "Values", headers, rows, numeric = [] }) {
  const thead = el("thead", {}, [el("tr", {}, headers.map((h, i) => el("th", { scope: "col", class: numeric.includes(i) ? "num" : "", text: h })))]);
  const tbody = el("tbody", {}, rows.map((row) =>
    el("tr", {}, row.map((cell, i) => el("td", { class: numeric.includes(i) ? "num" : "", text: String(cell ?? "") }))),
  ));
  const table = el("table", { class: "data" }, [el("caption", { class: "visually-hidden", text: caption }), thead, tbody]);
  return el("details", { class: "table-view" }, [el("summary", { text: "Table view" }), el("div", { class: "table-twin" }, [table])]);
}

// ---- Tooltip: one shared element; title and rows are text only ----
const tip = () => document.getElementById("tooltip");

export function showTip(event, title, rows = []) {
  const node = tip();
  if (!node) return;
  clear(node);
  if (title) node.append(el("div", { class: "tt-title", text: title }));
  for (const r of rows) {
    const key = el("span", { class: "tt-key" });
    if (r.color) key.style.background = r.color;
    const left = el("span", {}, [key, document.createTextNode(r.label)]);
    node.append(el("div", { class: "tt-row" }, [left, el("b", { text: r.value })]));
  }
  node.classList.add("show");
  placeTip(event);
}

export function placeTip(event) {
  const node = tip();
  if (!node || !event) return;
  const pad = 14;
  const { clientX: x, clientY: y } = event;
  const rect = node.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  tip()?.classList.remove("show");
}

// Make a mark keyboard reachable with the same tooltip as hover.
export function hitTarget(selection, { title, rows }) {
  selection
    .attr("tabindex", 0)
    .attr("role", "img")
    .attr("aria-label", () => `${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`)
    .attr("data-hit", "")
    .on("pointerenter pointermove focus", (event) => showTip(event, title, rows))
    .on("pointerleave blur", () => hideTip());
  return selection;
}

export function svgRoot(plot, width, height, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("width", "100%");
  plot.append(svg);
  return d3.select(svg);
}

export function emptySvg(plot, width, height, label) {
  const svg = svgRoot(plot, width, height, label);
  svg.append("text").attr("class", "empty").attr("x", 12).attr("y", 24).text("Nothing to show for these filters.");
  return svg;
}

// Chart colour for an arbitrary series count, with the eight-slot limit enforced.
export function slotFor(index) {
  return index < 8 ? `var(--series-${index + 1})` : OTHER_COLOR;
}

export const MONTH_RE = /^\d{4}-\d{2}$/;

// Human labels from config/taxonomy.json, set once by the app on load.
export const labels = { category: {}, sub: {} };
export function setLabels(taxonomy) {
  for (const c of taxonomy.categories) {
    labels.category[c.id] = c.name;
    for (const s of c.subcategories) labels.sub[s.id] = s.name;
  }
}
export function catLabel(id) {
  return labels.category[id] || id;
}
export function subLabel(id) {
  return labels.sub[id] || id;
}
