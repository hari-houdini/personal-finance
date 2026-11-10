// Shared chart plumbing: formatting, stable colours, tooltips, legend, table twin, and click-to-filter.
// Every chart is built from these so the rules (labels, colours, table view, selection) hold everywhere.
// All text goes in with textContent. Category and merchant names come from the statements.

const GBP0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const GBP2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
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
export const monthLongLabel = (ym) => MONTH_LONG.format(new Date(`${ym}-01T00:00:00`));
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

// Sub-categories inherit their category's colour, lightened step by step. The palette is not extended.
export function tintFor(categoryId, index) {
  const pctStrength = Math.max(35, 100 - index * 14);
  const i = CATEGORY_SLOTS.indexOf(categoryId);
  const base = i === -1 ? "var(--ink-3)" : `var(--series-${i + 1})`;
  return `color-mix(in oklab, ${base} ${pctStrength}%, var(--surface))`;
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

// ---- Selection: a filter is "picked" when every key in the patch already matches the shared filter ----
export function isPicked(filters, patch) {
  return Object.entries(patch).every(([key, value]) => {
    if (key === "amount") return filters.minAmount === value.min && filters.maxAmount === value.max;
    return filters[key] === value;
  });
}

// Mark a chart element as the current selection (accent outline) without changing its data.
export function markPicked(selection, picked) {
  selection.classed("is-selected", !!picked);
}

// Build the standard frame: the figure, a legend, and a table view. Returns the svg-host node.
export function frame(host, { label, legend = [], table = null } = {}) {
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
      ul.append(el("li", { "data-tip": item.tip || null }, [swatch, document.createTextNode(item.label)]));
    }
    figure.append(ul);
  }
  if (table) figure.append(tableView(table));
  host.append(figure);
  return plot;
}

// Table twin. Rows with an entry in `actions` get a button in their first cell that runs the action,
// so keyboard and screen-reader users can filter the page the same way a click does.
export function tableView({ caption = "Values", headers, rows, numeric = [], actions = [] }) {
  const thead = el("thead", {}, [el("tr", {}, headers.map((h, i) => el("th", { scope: "col", class: numeric.includes(i) ? "num" : "", text: h })))]);
  const tbody = el("tbody", {}, rows.map((row, r) => {
    const action = actions[r];
    const cells = row.map((cell, i) => {
      const text = String(cell ?? "");
      const cls = numeric.includes(i) ? "num" : "";
      if (action && i === 0) {
        const button = el("button", { type: "button", class: "row-action", text });
        button.addEventListener("click", () => action());
        return el("td", { class: cls }, [button]);
      }
      return el("td", { class: cls, text });
    });
    return el("tr", action ? { class: "is-action" } : {}, cells);
  }));
  const table = el("table", { class: "data" }, [el("caption", { class: "visually-hidden", text: caption }), thead, tbody]);
  return el("details", { class: "table-view" }, [el("summary", { text: "Table view" }), el("div", { class: "table-twin" }, [table])]);
}

// ---- Tooltip: one shared element; positioned by script; title and rows are text only ----
const tip = () => document.getElementById("tooltip");

function placeAt(x, y) {
  const node = tip();
  if (!node) return;
  const pad = 14;
  const rect = node.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
}

// Where to put a tip: at the pointer when there is one, otherwise above the focused element.
function anchorPoint(event) {
  if (event && typeof event.clientX === "number" && (event.clientX || event.clientY)) return [event.clientX, event.clientY];
  const target = event?.currentTarget || event?.target;
  if (target?.getBoundingClientRect) {
    const r = target.getBoundingClientRect();
    return [r.left + r.width / 2, r.top];
  }
  return [0, 0];
}

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
  placeAt(...anchorPoint(event));
}

// Plain-language tip: a sentence for a child, not a data table.
export function showText(event, text) {
  const node = tip();
  if (!node || !text) return;
  clear(node);
  node.append(el("div", { class: "tt-body", text }));
  node.classList.add("show");
  placeAt(...anchorPoint(event));
}

export function hideTip() {
  tip()?.classList.remove("show");
}

// One delegated listener set for every element with data-tip, so new elements need no wiring.
export function initTooltips() {
  const find = (target) => (target instanceof Element ? target.closest("[data-tip]") : null);
  document.addEventListener("pointerover", (e) => {
    const node = find(e.target);
    if (node) showText(e, node.dataset.tip);
  });
  document.addEventListener("pointerout", (e) => {
    const node = find(e.target);
    if (node && !node.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const node = find(e.target);
    if (node) showText(e, node.dataset.tip);
  });
  document.addEventListener("focusout", (e) => {
    if (find(e.target)) hideTip();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
}

// Make a chart mark keyboard reachable with the same tooltip as hover. With onSelect, the mark also
// filters the page on click, Enter or Space.
export function hitTarget(selection, { title, rows, onSelect = null }) {
  selection
    .attr("tabindex", 0)
    .attr("data-hit", "")
    .attr("aria-label", () => `${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}${onSelect ? ". Select to filter the page" : ""}`)
    .on("pointerenter pointermove focus", (event) => showTip(event, title, rows))
    .on("pointerleave blur", () => hideTip());
  if (onSelect) {
    selection
      .attr("role", "button")
      .classed("is-action", true)
      .on("click", (event) => {
        hideTip();
        onSelect(event);
      })
      .on("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          hideTip();
          onSelect(event);
        }
      });
  } else {
    selection.attr("role", "img");
  }
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
export const labels = { category: {}, sub: {}, categoryHelp: {}, subHelp: {}, subCategory: {} };
export function setLabels(taxonomy) {
  for (const c of taxonomy.categories) {
    labels.category[c.id] = c.name;
    if (c.help) labels.categoryHelp[c.id] = c.help;
    for (const s of c.subcategories) {
      labels.sub[s.id] = s.name;
      labels.subCategory[s.id] = c.id;
      if (s.help) labels.subHelp[s.id] = s.help;
    }
  }
}
export function catLabel(id) {
  return labels.category[id] || id;
}
export function subLabel(id) {
  return labels.sub[id] || id;
}
export function categoryOfSub(id) {
  return labels.subCategory[id] || "";
}
// Plain-English help for an id, when the taxonomy has one.
export function helpFor(id) {
  return labels.subHelp[id] || labels.categoryHelp[id] || "";
}
