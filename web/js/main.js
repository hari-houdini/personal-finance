// App controller: owns the shared filter, routes between sections, draws each section's charts from the API,
// and wires the filter chips, KPI explanations, transactions table, balances form, merchant identification,
// import, and chat. Every chart click calls select() (filter the page) or go() (filter and open a view).
import {
  catLabel, clear, el, emptyState, money, money2, pct, setLabels, subLabel, dayLabel, monthLabel,
  categoryOfSub, helpFor, initTooltips, isPicked, measure,
} from "./charts/core.js";
import * as flow from "./charts/flow.js";
import * as hier from "./charts/hier.js";
import * as trends from "./charts/trends.js";
import * as dist from "./charts/dist.js";
import * as stab from "./charts/stab.js";
import { CHART_HINTS, KIND_NAMES, KPI_COPY, RAIL_TIPS, STAB_TIPS, UI_TIPS } from "./copy.js";
import { renderBudget } from "./budget.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["overview", "cashflow", "categories", "merchants", "trends", "distributions", "stability", "budget", "transactions", "ask"];
const SPEND_KINDS = new Set(["essential", "discretionary", "fee", "tax"]);
const PAGE_SIZE = 50;
const ACCOUNT_LABEL = { "debit-card": "Current account", "credit-card": "Credit card" };

const state = {
  meta: null,
  analytics: null,
  stability: null,
  payments: null,
  paymentsKey: null,
  subGroups: null,
  preset: "3m",
  from: "",
  to: "",
  account: "",
  category: "",
  subcategory: "",
  merchant: "",
  kind: "",
  minAmount: "",
  maxAmount: "",
  month: "",
  day: "",
  savedRange: null,
  kpiOpen: "",
  treeMode: "treemap",
  txMode: "all",
  txQuery: "",
  txOffset: 0,
  txTotal: 0,
  txToken: 0,
  view: "overview",
  dirty: new Set(VIEWS),
  session: null,
};

// ---------- HTTP ----------

async function getJson(url, options = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Not JSON: keep the status text.
    }
    throw new Error(detail);
  }
  return res.json();
}

const jsonBody = (payload) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

// The one filter every view reads. Empty values are left out of the query.
function filterQuery(extra = {}) {
  const p = new URLSearchParams();
  const set = (key, value) => { if (value !== "" && value != null) p.set(key, String(value)); };
  set("from", state.from);
  set("to", state.to);
  set("account", state.account);
  set("category", state.category);
  set("subcategory", state.subcategory);
  set("merchant", state.merchant);
  set("kind", state.kind);
  set("min_amount", state.minAmount);
  set("max_amount", state.maxAmount);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== false && v !== "" && v != null) p.set(k, String(v));
  return p.toString();
}

// The filter as plain values, for charts that compare each mark with what is picked.
function filtersView() {
  return {
    category: state.category,
    subcategory: state.subcategory,
    merchant: state.merchant,
    kind: state.kind,
    account: state.account,
    minAmount: state.minAmount,
    maxAmount: state.maxAmount,
    month: state.month,
    day: state.day,
  };
}

// ---------- Feedback ----------

let toastTimer = null;
function showToast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function setNotice(host, message) {
  clear(host);
  if (message) host.append(el("div", { class: "notice", role: "status", text: message }));
}

async function busy(button, task) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

// ---------- Data ----------

async function loadAll() {
  const [meta, analytics, stability] = await Promise.all([
    getJson("/api/meta"),
    getJson(`/api/analytics?${filterQuery()}`).catch((e) => ({ error: e.message })),
    getJson("/api/stability").catch((e) => ({ error: e.message })),
  ]);
  state.meta = meta;
  setLabels(meta.taxonomy);
  state.analytics = analytics.error ? null : analytics;
  state.stability = stability.error ? null : stability;
  state.payments = null;
  state.paymentsKey = null;
  if (!meta.ready) setNotice($("notice-host"), "No transactions have been read yet. Press Re-read statements.");
  else setNotice($("notice-host"), analytics.error || stability.error ? `Some figures could not be loaded: ${analytics.error || stability.error}` : "");
  const count = $("count-review");
  count.textContent = meta.needs_review ? String(meta.needs_review) : "";
  count.classList.toggle("attention", meta.needs_review > 0);
  markAllDirty();
  renderCurrent();
}

async function ensurePayments() {
  const key = filterQuery();
  if (state.payments && state.paymentsKey === key) return;
  const items = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await getJson(`/api/transactions?${filterQuery({ limit: 2000, offset })}`);
    total = page.total;
    if (!page.items.length) break;
    items.push(...page.items);
    offset += page.items.length;
  }
  state.payments = items.filter((t) => t.amount < 0 && SPEND_KINDS.has(t.kind));
  state.paymentsKey = key;
}

// ---------- Dates and presets ----------

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Ranges end at the latest transaction, not today, so an import from last month still fills the charts.
function presetRange(key) {
  const end = state.meta?.last_date || isoDay(new Date());
  const [y, m] = end.split("-").map(Number);
  const monthsBack = (n) => isoDay(new Date(y, m - 1 - n, 1));
  switch (key) {
    case "1m": return { from: monthsBack(0), to: end };
    case "3m": return { from: monthsBack(2), to: end };
    case "6m": return { from: monthsBack(5), to: end };
    case "12m": return { from: monthsBack(11), to: end };
    case "ytd": return { from: `${y}-01-01`, to: end };
    default: return { from: "", to: "" };
  }
}

function applyPreset(key) {
  const range = presetRange(key);
  state.preset = key;
  state.from = range.from;
  state.to = range.to;
  clearFocusSilently();
  afterFilterChange();
}

function clearFocusSilently() {
  state.month = "";
  state.day = "";
  state.savedRange = null;
}

// A click on a month or a day sets the dates to match. Clicking it again restores the earlier range.
function setFocus(key, value) {
  if (!state.month && !state.day) state.savedRange = { from: state.from, to: state.to, preset: state.preset };
  if (key === "month") {
    const [y, m] = value.split("-").map(Number);
    state.month = value;
    state.day = "";
    state.from = `${value}-01`;
    state.to = isoDay(new Date(y, m, 0));
  } else {
    state.day = value;
    state.month = "";
    state.from = value;
    state.to = value;
  }
  state.preset = "custom";
}

function clearFocus() {
  if (state.savedRange) {
    state.from = state.savedRange.from;
    state.to = state.savedRange.to;
    state.preset = state.savedRange.preset;
  }
  clearFocusSilently();
}

function syncDateInputs() {
  $("f-from").value = state.from;
  $("f-to").value = state.to;
  for (const b of document.querySelectorAll("[data-preset]")) {
    b.setAttribute("aria-pressed", String(!state.month && !state.day && b.dataset.preset === state.preset));
  }
}

function fillCategoryFilters() {
  const cat = $("f-category");
  clear(cat);
  cat.append(el("option", { value: "", text: "All" }));
  for (const c of state.meta.taxonomy.categories) cat.append(el("option", { value: c.id, text: c.name }));
  cat.value = state.category;
  renderSubFilter();
}

function renderSubFilter() {
  const sub = $("f-subcategory");
  clear(sub);
  sub.append(el("option", { value: "", text: "All" }));
  for (const c of state.meta.taxonomy.categories) {
    if (state.category && c.id !== state.category) continue;
    const group = el("optgroup", { label: c.name });
    for (const s of c.subcategories) group.append(el("option", { value: s.id, text: s.name }));
    sub.append(group);
  }
  sub.value = state.subcategory;
}

// Sub-category option groups, built once and cloned into each transaction row's select.
function subGroupTemplate() {
  if (!state.subGroups) {
    state.subGroups = state.meta.taxonomy.categories.map((c) => {
      const group = el("optgroup", { label: c.name });
      for (const s of c.subcategories) group.append(el("option", { value: s.id, text: s.name }));
      return group;
    });
  }
  return state.subGroups;
}

// ---------- Shared filter: select (toggle), go (set and open a view) ----------

function isActive(key, value) {
  if (key === "amount") return state.minAmount === value.min && state.maxAmount === value.max;
  return state[key] === value;
}

// Apply a patch to the shared filter. With toggle, a value that is already picked is cleared.
function applyPatch(patch, toggle) {
  for (const [key, value] of Object.entries(patch)) {
    const active = toggle && isActive(key, value);
    switch (key) {
      case "amount":
        state.minAmount = active ? "" : value.min;
        state.maxAmount = active ? "" : (value.max ?? "");
        break;
      case "month":
      case "day":
        if (active) clearFocus();
        else setFocus(key, value);
        break;
      case "category":
        if (active) {
          state.category = "";
        } else {
          state.category = value;
        }
        break;
      case "subcategory":
        if (active) {
          state.subcategory = "";
        } else {
          state.subcategory = value;
          const cat = categoryOfSub(value);
          if (cat) state.category = cat;
        }
        break;
      case "account":
      case "merchant":
      case "kind":
        state[key] = active ? "" : value;
        break;
      default:
        break;
    }
  }
  state.txOffset = 0;
  afterFilterChange();
}

// Clicking a chart filters the whole page. Clicking the same value again clears it.
function select(patch) {
  applyPatch(patch, true);
}

// Filter the page, then open a view that shows the result.
function go(view, patch = {}) {
  applyPatch(patch, false);
  if (location.hash === `#${view}`) {
    state.dirty.add(view);
    renderCurrent();
  } else {
    location.hash = view;
  }
}

// Level 0 = all categories, 1 = a category, 2 = a sub-category. Used by the donut crumbs.
function drillTo(level) {
  if (level <= 0) { state.category = ""; state.subcategory = ""; state.merchant = ""; }
  if (level === 1) { state.subcategory = ""; state.merchant = ""; }
  if (level === 2) { state.merchant = ""; }
  state.txOffset = 0;
  afterFilterChange();
}

function afterFilterChange() {
  if (!state.category) state.subcategory = "";
  syncControls();
  refreshAnalytics();
}

function syncControls() {
  syncDateInputs();
  $("f-account").value = state.account;
  $("f-category").value = state.category;
  renderSubFilter();
  renderChips();
  renderCrumbs();
}

// Removable chips: one per active filter. Each chip's × runs the same toggle that cleared it.
function activeChips() {
  const chips = [];
  if (state.category) chips.push({ patch: { category: state.category }, label: "Category", value: catLabel(state.category), tip: helpFor(state.category) });
  if (state.subcategory) chips.push({ patch: { subcategory: state.subcategory }, label: "Sub-category", value: subLabel(state.subcategory), tip: helpFor(state.subcategory) });
  if (state.merchant) chips.push({ patch: { merchant: state.merchant }, label: "Shop", value: state.merchant });
  if (state.kind) chips.push({ patch: { kind: state.kind }, label: "Showing", value: KIND_NAMES[state.kind] || state.kind });
  if (state.minAmount !== "" || state.maxAmount !== "") {
    const min = state.minAmount === "" ? 0 : state.minAmount;
    const max = state.maxAmount === "" ? null : state.maxAmount;
    const value = max == null ? `£${min} and over` : `£${min} to £${max}`;
    chips.push({ patch: { amount: { min: state.minAmount, max: state.maxAmount } }, label: "Amount", value });
  }
  if (state.month) chips.push({ patch: { month: state.month }, label: "Month", value: monthLabel(state.month) });
  if (state.day) chips.push({ patch: { day: state.day }, label: "Day", value: dayLabel(state.day) });
  return chips;
}

function renderChips() {
  const host = $("chips");
  clear(host);
  const chips = activeChips();
  if (!chips.length) return;
  host.append(el("span", { class: "chips-label", text: "Showing only:" }));
  for (const c of chips) {
    const button = el("button", {
      type: "button",
      class: "chip",
      "aria-label": `Remove filter ${c.label}: ${c.value}`,
      "data-tip": c.tip || `Remove this filter and show everything for ${c.label.toLowerCase()} again.`,
    }, [el("span", { text: `${c.label}: ${c.value}` }), glyph("M4 4l8 8M12 4l-8 8", 12, "chip-x")]);
    button.addEventListener("click", () => select(c.patch));
    host.append(button);
  }
  const clearAll = el("button", { type: "button", class: "btn ghost", text: "Clear all" });
  clearAll.addEventListener("click", () => clearEverything());
  host.append(clearAll);
}

function clearEverything() {
  state.category = "";
  state.subcategory = "";
  state.merchant = "";
  state.kind = "";
  state.minAmount = "";
  state.maxAmount = "";
  state.txOffset = 0;
  if (state.month || state.day) clearFocus();
  afterFilterChange();
}

// Breadcrumb for the donut: All categories, then the category, then the sub-category, then the shop.
function renderCrumbs() {
  const host = $("donut-crumbs");
  clear(host);
  const crumbs = [{ label: "All categories", level: 0, active: !state.category }];
  if (state.category) crumbs.push({ label: catLabel(state.category), level: 1, active: !state.subcategory });
  if (state.subcategory) crumbs.push({ label: subLabel(state.subcategory), level: 2, active: !state.merchant });
  if (state.merchant) crumbs.push({ label: state.merchant, level: 3, active: true });
  crumbs.forEach((c, i) => {
    if (i > 0) host.append(glyph("M6 3.5 10.5 8 6 12.5", 12, "crumb-sep"));
    if (c.active || c.level === 3) {
      host.append(el("span", { class: "crumb current", "aria-current": "location", text: c.label }));
    } else {
      const button = el("button", { type: "button", class: "crumb", text: c.label, "data-tip": "Zoom back out to here." });
      button.addEventListener("click", () => drillTo(c.level));
      host.append(button);
    }
  });
}

function refreshAnalytics() {
  loadAll().catch(showError);
}

function showError(err) {
  console.error(err);
  setNotice($("notice-host"), `Something went wrong: ${err.message}`);
}

// ---------- Rendering ----------

function markAllDirty() {
  state.dirty = new Set(VIEWS);
}

function figureList(host, items) {
  clear(host);
  for (const [label, value, note, tip] of items) {
    host.append(el("div", { class: "figure" }, [
      el("dt", { text: label, tabindex: tip ? 0 : null, "data-tip": tip || null }),
      el("dd", { class: "figure-value", text: value }),
      note ? el("dd", { class: "figure-meta", text: note }) : null,
    ]));
  }
}

// ---- KPI figures: arrows show the change, colour shows whether that change is good ----

// Drawn icons (SVG paths, stroke in currentColor). DESIGN.md bans text glyphs as icons.
function glyph(d, size, cls) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", cls);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function arrowIcon(up) {
  return glyph(up ? "M8 13V3M3.5 7.5 8 3l4.5 4.5" : "M8 3v10M3.5 8.5 8 13l4.5-4.5", 14, "arrow");
}

function kpiItems() {
  const k = state.analytics.kpis;
  const items = [
    { key: "earned", field: "earned_income", value: money(k.earned_income), current: k.earned_income, note: k.other_income ? `plus ${money(k.other_income)} other income` : "salary and benefits" },
    { key: "spending", field: "spending", value: money(k.spending), current: k.spending, note: `${k.transactions} transactions in these dates` },
    { key: "debt", field: "debt_service", value: money(k.debt_service), current: k.debt_service, note: "loans and finance repayments" },
    { key: "net", field: "net", value: money(k.net), current: k.net, note: "money in minus money out, excluding transfers" },
    { key: "savings", field: "savings_rate", value: pct(k.savings_rate), current: k.savings_rate, note: "earned income left after spending and debt", points: true },
  ];
  if (k.family_in) items.push({ key: "family", value: money(k.family_in), current: null, note: "shown in cash flow, not counted as earned income" });
  return items;
}

// Compare with the previous period of the same length. Returns what to say and how to draw it.
function deltaFor(item) {
  const prev = state.analytics.previous;
  if (!prev) {
    return { tone: "none", text: state.preset === "all" ? "Pick a date range to compare with the period before." : "No earlier data to compare with." };
  }
  const before = prev.kpis[item.field];
  const now = item.current;
  if (before == null || now == null) return { tone: "none", text: "Not enough data to compare." };
  const diff = now - before;
  const flat = item.points ? Math.abs(diff) < 0.0005 : Math.abs(diff) < 0.5;
  if (flat) return { tone: "none", text: "About the same as before." };
  const up = diff > 0;
  const good = KPI_COPY[item.key].good === (up ? "up" : "down");
  const amount = item.points ? `${Math.round(Math.abs(diff) * 100)} points` : money(Math.abs(diff));
  return { up, tone: good ? "good" : "bad", text: `${good ? "Better" : "Worse"}: ${amount} ${up ? "more" : "less"} than before` };
}

function deltaNode(d) {
  const node = el("span", { class: `delta ${d.tone}` });
  if (d.up !== undefined) node.append(arrowIcon(d.up));
  node.append(el("span", { text: d.text }));
  return node;
}

function renderKpis() {
  const host = $("kpis");
  clear(host);
  for (const item of kpiItems()) {
    const copy = KPI_COPY[item.key];
    const open = state.kpiOpen === item.key;
    const label = el("button", {
      type: "button",
      class: "kpi-btn",
      text: copy.label,
      "data-kpi": item.key,
      "aria-expanded": String(open),
      "aria-controls": "kpi-detail",
      "data-tip": copy.tip,
    });
    label.addEventListener("click", () => toggleKpi(item.key));
    host.append(el("div", { class: "figure" }, [
      el("dt", {}, [label]),
      el("dd", { class: "figure-value", text: item.value }),
      item.key === "family" ? null : el("dd", { class: "figure-delta" }, [deltaNode(deltaFor(item))]),
      el("dd", { class: "figure-meta", text: item.note }),
    ]));
  }
}

function toggleKpi(key) {
  state.kpiOpen = state.kpiOpen === key ? "" : key;
  renderKpis();
  renderKpiDetail();
  document.querySelector(`[data-kpi="${key}"]`)?.focus();
}

// The "what makes this figure" panel. Every row filters the page to that row when clicked.
const KPI_ACTIONS = {
  earned: [{ label: "Show only money in", patch: { kind: "income" } }],
  spending: [{ label: "Show only spending", patch: { kind: "spending" } }],
  debt: [{ label: "Show only debt payments", patch: { kind: "debt" } }],
  net: [{ label: "Show money in", patch: { kind: "income" } }, { label: "Show money out", patch: { kind: "outflow" } }],
  savings: [{ label: "Show money out", patch: { kind: "outflow" } }],
  family: [{ label: "Show family transfers", patch: { subcategory: "transfers.family_in" } }],
};

function kpiRow(label, value, patch, indent = false) {
  const body = [el("span", { text: label }), el("b", { text: value })];
  const li = el("li", { class: indent ? "indent" : "" });
  if (patch) {
    const button = el("button", { type: "button", class: "kpi-row", "aria-pressed": String(isPicked(filtersView(), patch)) }, body);
    button.addEventListener("click", () => select(patch));
    li.append(button);
  } else {
    li.append(el("div", { class: "kpi-row static" }, body));
  }
  return li;
}

function kpiSection(title, rows) {
  return el("section", { class: "kpi-section" }, [
    el("h3", { text: title }),
    el("ul", { class: "kpi-rows" }, rows),
  ]);
}

function renderKpiDetail() {
  const host = $("kpi-detail");
  clear(host);
  const key = state.kpiOpen;
  host.hidden = !key;
  if (!key || !state.analytics) return;
  const copy = KPI_COPY[key];
  const b = state.analytics.breakdown;
  const k = state.analytics.kpis;
  host.append(el("h2", { id: "kpi-detail-title", text: `What makes up ${copy.label.toLowerCase()}` }));
  host.append(el("p", { class: "help", text: copy.explain }));

  const sections = [];
  if (key === "earned") {
    sections.push(kpiSection("Where it came from", b.earned_income.by_source.map((s) => kpiRow(subLabel(s.id), money(s.value), { subcategory: s.id }))));
    sections.push(kpiSection("Biggest payments in", b.earned_income.largest.map((r) => kpiRow(r.merchant, `${dayLabel(r.date)} · ${money(r.amount)}`, { merchant: r.merchant }))));
  } else if (key === "spending") {
    sections.push(kpiSection("By category", b.spending.by_category.flatMap((c) => [
      kpiRow(catLabel(c.id), money(c.value), { category: c.id }),
      ...c.children.map((s) => kpiRow(subLabel(s.id), money(s.value), { subcategory: s.id }, true)),
    ])));
  } else if (key === "debt") {
    sections.push(kpiSection("By type", b.debt_service.by_subcategory.map((s) => kpiRow(subLabel(s.id), money(s.value), { subcategory: s.id }))));
  } else if (key === "net") {
    sections.push(kpiSection("Money in", [
      kpiRow("All money in (excluding transfers)", money(b.net.money_in), null),
      ...b.net.largest_in.map((r) => kpiRow(r.merchant, `${dayLabel(r.date)} · ${money(r.amount)}`, { merchant: r.merchant })),
    ]));
    sections.push(kpiSection("Money out", [
      kpiRow("All money out (excluding transfers)", money(b.net.money_out), null),
      ...b.net.largest_out.map((r) => kpiRow(r.merchant, `${dayLabel(r.date)} · ${money(Math.abs(r.amount))}`, { merchant: r.merchant })),
    ]));
  } else if (key === "savings") {
    const income = k.earned_income + k.other_income;
    const left = income - k.spending - k.debt_service;
    sections.push(kpiSection("The sum", [
      kpiRow("Money in (earned and other)", money(income), null),
      kpiRow("Minus spending", money(k.spending), null),
      kpiRow("Minus debt payments", money(k.debt_service), null),
      kpiRow("Left over", money(left), null),
      kpiRow("Left over as a share of money in", pct(k.savings_rate), null),
    ]));
  }
  for (const s of sections) host.append(s);

  const actions = KPI_ACTIONS[key] || [];
  if (actions.length) {
    const row = el("div", { class: "kpi-actions" });
    for (const a of actions) {
      const button = el("button", { type: "button", class: "btn", text: a.label, "aria-pressed": String(isPicked(filtersView(), a.patch)) });
      button.addEventListener("click", () => select(a.patch));
      row.append(button);
    }
    host.append(row);
  }
  const close = el("button", { type: "button", class: "btn ghost kpi-close", text: "Close this" });
  close.addEventListener("click", () => toggleKpi(key));
  host.append(close);
}

function renderOverviewFigures() {
  renderKpis();
  renderKpiDetail();
}

function renderStability() {
  const s = state.stability;
  const b = s.baseline;
  const ef = s.emergency_fund;
  const gap = s.monthly_gap_to_target;
  figureList($("stab-figures"), [
    ["Earned income a month", money(b.earned_income_monthly), `average of ${s.window_months.length} complete months`, STAB_TIPS.earnedMonthly],
    ["Spending a month", money(b.spending_monthly), `essential ${money(b.essential_spend_monthly)}`, STAB_TIPS.spendingMonthly],
    ["Surplus a month", money(b.surplus_monthly), gap != null && gap > 0 ? `${money(gap)} short of the savings target` : "at or above the savings target", STAB_TIPS.surplusMonthly],
    ["Emergency fund", ef.months_cover == null ? "n/a" : `${ef.months_cover.toFixed(1)} months`, ef.source, STAB_TIPS.emergencyFund],
  ]);
  setNotice($("stab-notice"), s.limits);
  const fundInput = $("bal-fund");
  if (document.activeElement !== fundInput) fundInput.value = ef.source === "entered by you" ? String(ef.balance) : "";
  const order = s.debt.avalanche_order || [];
  $("bal-help").textContent = order.length
    ? `Avalanche order, highest interest first: ${order.map((l) => `${l.name} (${l.apr}% a year)`).join(", ")}.`
    : s.debt.note || "Add loans one at a time. Saved loans show here in avalanche order (highest interest first).";
}

// ---------- Budget plan ----------

// The slider and the motorbike switch both reload the plan from the API. Only the values they change are sent.
const budgetQuery = { saving: null, bike_sold: null };

async function loadBudget(change = {}) {
  Object.assign(budgetQuery, change);
  const params = new URLSearchParams();
  if (budgetQuery.saving != null) params.set("saving", String(budgetQuery.saving));
  if (budgetQuery.bike_sold != null) params.set("bike_sold", String(budgetQuery.bike_sold));
  try {
    const data = await getJson(`/api/budget?${params}`);
    renderBudget($("budget-root"), data, (next) => loadBudget(next));
  } catch (e) {
    setNotice($("notice-host"), `The budget plan could not be loaded: ${e.message}`);
  }
}

function renderMerchantsHeading() {
  $("hbar-desc").textContent = state.subcategory
    ? `Shops for ${subLabel(state.subcategory)}, largest spend first.`
    : "Largest spend, by merchant.";
}

// Each chart host names its chart in data-chart. The registry maps that name to a draw call.
// Every chart receives ctx: the analytics, the filter, and select / go / refresh.
const CHARTS = {
  "stacked-area": (h, c) => flow.stackedArea(h, c.a.monthly, c),
  "donut": (h, c) => flow.donut(h, { hierarchy: c.a.hierarchy, filters: c.filters, select: c.select, refresh: c.refresh }),
  "waterfall": (h, c) => flow.waterfall(h, c.a.monthly, c),
  "sankey": (h, c) => flow.sankey(h, c.a.kpis, c.a.hierarchy, catLabel, c),
  "streamgraph": (h, c) => flow.streamgraph(h, c.a.monthly, c),
  "percent-bars": (h, c) => flow.percentBars(h, c.a.monthly, c),
  "chord": (h, c) => flow.chord(h, c.a.transfers, c),
  "tree": (h, c) => (state.treeMode === "sunburst" ? hier.sunburst : hier.treemap)(h, c.a.hierarchy, c),
  "radar": (h, c) => hier.radar(h, c.a.monthly, c),
  "bullet": (h, c) => hier.bullet(h, c.a.monthly, c),
  "slope": (h, c) => hier.slope(h, c.a.monthly, c),
  "hbar": (h, c) => hier.hbar(h, c.a.merchants, c),
  "bubble": (h, c) => hier.bubble(h, c.a.merchants, c),
  "shops-tree": (h, c) => hier.shopsTree(h, c.a.merchants, c),
  "network": (h, c) => hier.network(h, c.a.merchants, c),
  "line": (h, c) => trends.line(h, c.a.monthly, c),
  "calendar": (h, c) => trends.calendar(h, c.a.daily, c),
  "small-multiples": (h, c) => trends.smallMultiples(h, c.a.monthly, c),
  "boxplot": (h, c) => dist.boxplot(h, c.a.amounts_by_category, c),
  "histogram": (h, c) => dist.histogram(h, c.a.amounts_by_category, c),
  "dots": (h, c) => dist.dots(h, c.payments, c),
  "gauge": (h, c) => stab.rateGauge(h, c.s, c),
  "fund": (h, c) => stab.fundGauge(h, c.s, c),
  "debt-bars": (h, c) => stab.debtBars(h, c.s, c),
  "runway": (h, c) => stab.runway(h, c.s, c),
};

function refreshView() {
  state.dirty.add(state.view);
  renderCurrent();
}

function drawHosts(section, ctx) {
  for (const host of section.querySelectorAll("[data-chart]")) {
    const name = host.dataset.chart;
    const fn = CHARTS[name];
    if (!fn) continue;
    const title = host.closest("article")?.querySelector("h2");
    if (title && CHART_HINTS[name]) {
      title.dataset.tip = CHART_HINTS[name];
      title.tabIndex = 0;
    }
    try {
      fn(host, ctx);
    } catch (err) {
      console.error(name, err);
      emptyState(host, "This chart could not be drawn at this width. The table view still has the figures.");
    }
  }
}

async function renderSection(name) {
  if (name === "transactions") return renderTransactions();
  if (name === "budget") return loadBudget();
  if (name === "ask") return undefined;
  const section = $(`view-${name}`);
  if (name === "stability") renderStability();
  if (name === "overview") renderOverviewFigures();
  if (name === "merchants") renderMerchantsHeading();
  if (name === "distributions") await ensurePayments();
  if (state.view !== name) return undefined;
  const ctx = {
    a: state.analytics,
    s: state.stability,
    payments: state.payments || [],
    filters: filtersView(),
    select,
    go,
    refresh: refreshView,
  };
  drawHosts(section, ctx);
  return undefined;
}

function renderCurrent() {
  if (!state.meta || !state.analytics) return;
  if (state.view === "stability" && !state.stability) return;
  if (!state.dirty.has(state.view)) return;
  state.dirty.delete(state.view);
  renderSection(state.view).catch(showError);
}

// ---------- Transactions ----------

function accountLabel(account) {
  return ACCOUNT_LABEL[account] || account;
}

function txRow(t) {
  const select1 = el("select", { "aria-label": `Category for ${t.merchant} on ${dayLabel(t.date)}` });
  for (const group of subGroupTemplate()) select1.append(group.cloneNode(true));
  select1.value = t.subcategory_id;
  select1.addEventListener("change", () => reclassify(t, select1));
  return el("tr", {}, [
    el("td", { text: dayLabel(t.date) }),
    el("td", { "data-tip": t.description, text: t.merchant }),
    el("td", { class: "num", text: money2(t.amount) }),
    el("td", {}, [select1]),
    el("td", {}, [
      el("span", { class: "badge", text: accountLabel(t.account) }),
      t.flags.needs_review ? el("span", { class: "badge review", text: "check the category" }) : null,
    ]),
  ]);
}

async function renderTransactions() {
  const token = ++state.txToken;
  const page = await getJson(`/api/transactions?${filterQuery({
    review: state.txMode === "review",
    q: state.txQuery,
    limit: PAGE_SIZE,
    offset: state.txOffset,
  })}`);
  if (token !== state.txToken) return;
  state.txTotal = page.total;
  const body = $("tx-body");
  clear(body);
  if (!page.items.length) {
    body.append(el("tr", {}, [el("td", { colspan: "5", class: "help", text: "Nothing to show for these filters." })]));
  }
  for (const t of page.items) body.append(txRow(t));
  const from = page.total ? state.txOffset + 1 : 0;
  const to = Math.min(state.txOffset + PAGE_SIZE, page.total);
  $("tx-range").textContent = page.total ? `${from} to ${to} of ${page.total}` : "No transactions";
  $("tx-prev").disabled = state.txOffset === 0;
  $("tx-next").disabled = state.txOffset + PAGE_SIZE >= page.total;
  for (const b of document.querySelectorAll("[data-tx-mode]")) {
    const on = b.dataset.txMode === state.txMode;
    b.setAttribute("aria-selected", String(on));
  }
}

async function reclassify(tx, select1) {
  const next = select1.value;
  if (next === tx.subcategory_id) return;
  const remember = $("tx-remember").checked;
  select1.disabled = true;
  try {
    await getJson("/api/classify", { method: "POST", ...jsonBody({ transaction_id: tx.id, subcategory_id: next, remember }) });
    showToast(remember
      ? `Saved. Future payments to ${tx.merchant} go to ${subLabel(next)}.`
      : `Moved to ${subLabel(next)}.`);
    await loadAll();
  } catch (err) {
    select1.value = tx.subcategory_id;
    showToast(`Could not save: ${err.message}`);
  } finally {
    select1.disabled = false;
  }
}

// ---------- Merchant identification (only approved names leave the machine) ----------

async function askToIdentify(button) {
  const { count, fragments } = await getJson("/api/resolve/candidates");
  if (!count) {
    showToast("No merchant names are waiting to be identified.");
    return;
  }
  const host = $("notice-host");
  const approve = el("button", { type: "button", class: "btn primary", text: `Search ${count} names` });
  const cancel = el("button", { type: "button", class: "btn ghost", text: "Cancel" });
  cancel.addEventListener("click", () => setNotice(host, ""));
  approve.addEventListener("click", () => identify(fragments, approve, host));
  clear(host);
  host.append(el("div", { class: "notice", role: "region", "aria-label": "Identify merchants" }, [
    el("p", { text: `${count} merchant names will be sent to web search, one at a time, to find the brand behind each.` }),
    el("p", { class: "help", text: "Only the brand word is sent. Amounts, dates, card details and locations stay on this machine." }),
    el("ul", { class: "help", style: "max-height:12rem;overflow:auto;margin:0.4rem 0" }, fragments.map((f) => el("li", { text: f }))),
    el("div", { class: "forms", style: "grid-template-columns:none;grid-auto-flow:column;justify-content:start" }, [approve, cancel]),
  ]));
  button.focus();
}

async function identify(fragments, button, host) {
  await busy(button, async () => {
    let resolved = 0;
    for (let i = 0; i < fragments.length; i += 200) {
      const result = await getJson("/api/resolve", { method: "POST", ...jsonBody({ fragments: fragments.slice(i, i + 200) }) });
      resolved += result.resolved;
    }
    showToast(`Identified ${resolved} brand${resolved === 1 ? "" : "s"}.`);
    setNotice(host, "");
    await loadAll();
  });
}

// ---------- Import ----------

async function reread(button) {
  await busy(button, async () => {
    const result = await getJson("/api/import", { method: "POST" });
    const failed = Array.isArray(result.failures) ? result.failures.length : result.failures || 0;
    showToast(`Read ${result.statements} statements: ${result.records} transactions, ${result.needs_review} to check${failed ? `, ${failed} could not be read` : ""}.`);
    await loadAll();
  });
}

// ---------- Balances (stability plan) ----------

async function saveBalances(event) {
  event.preventDefault();
  const loans = {};
  for (const loan of state.stability?.debt?.avalanche_order || []) {
    const { name, ...info } = loan;
    loans[name] = info;
  }
  const name = $("bal-loan-name").value.trim();
  const balance = $("bal-loan-balance").value;
  const apr = $("bal-loan-apr").value;
  if (name) {
    if (balance === "" || apr === "") {
      showToast("Enter both the balance and the interest rate for the loan.");
      return;
    }
    loans[name] = { balance: Number(balance), apr: Number(apr) };
  }
  const fund = $("bal-fund").value.trim();
  await getJson("/api/stability/balances", {
    method: "PUT",
    ...jsonBody({ emergency_fund_balance: fund === "" ? null : Number(fund), loan_balances: loans }),
  });
  for (const id of ["bal-loan-name", "bal-loan-balance", "bal-loan-apr"]) $(id).value = "";
  showToast("Balances saved. The stability figures are updated.");
  await loadAll();
}

// ---------- Chat and advice ----------

function appendMessage(who, text, cls) {
  const log = $("chat-log");
  log.append(el("div", { class: cls }, [el("span", { class: "meta", text: who }), document.createTextNode(text)]));
  log.scrollTop = log.scrollHeight;
}

function openAdvice(result, question) {
  const body = $("advice-body");
  clear(body);
  if (question) body.append(el("p", { class: "help", text: `About: ${question}` }));
  body.append(el("p", { class: "answer", text: result.answer || "" }));
  if (result.highlights?.length) {
    const list = el("dl", { class: "highlights" });
    for (const h of result.highlights) {
      list.append(el("div", {}, [el("dt", { text: String(h.label ?? "") }), el("dd", { text: String(h.value ?? "") })]));
    }
    body.append(el("h3", { text: "Key figures" }), list);
  }
  if (result.actions?.length) {
    const steps = el("ol", {});
    for (const a of result.actions) {
      steps.append(el("li", {}, [el("strong", { text: String(a.title ?? "") }), el("span", { text: String(a.detail ?? "") })]));
    }
    body.append(el("h3", { text: "Next steps" }), steps);
  }
  const dialog = $("advice");
  if (!dialog.open) dialog.showModal();
  $("advice-close").focus();
}

async function sendChat() {
  const input = $("chat-input");
  const message = input.value.trim();
  if (!message) return;
  const send = $("chat-send");
  input.value = "";
  appendMessage("You", message, "msg you");
  await busy(send, async () => {
    try {
      const result = await getJson("/api/chat", { method: "POST", ...jsonBody({ message, session_id: state.session }) });
      state.session = result.session_id || state.session;
      const summary = (result.answer || "").split("\n").find((line) => line.trim()) || "Answer ready.";
      appendMessage("Claude", summary.length > 180 ? `${summary.slice(0, 177)}...` : summary, "msg");
      const again = el("button", { type: "button", class: "btn ghost", text: "Open the advice again" });
      again.addEventListener("click", () => openAdvice(result, message));
      $("chat-log").lastElementChild.append(again);
      openAdvice(result, message);
    } catch (err) {
      appendMessage("Claude", `I could not answer: ${err.message}`, "msg");
    }
  });
}

// ---------- Navigation and theme ----------

function routeName() {
  const name = location.hash.replace("#", "") || "overview";
  return VIEWS.includes(name) ? name : "overview";
}

function showView(name) {
  state.view = name;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.title = `${document.querySelector(`#view-${name} h1`)?.textContent || "Personal finance"} · Personal finance`;
  renderCurrent();
}

function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  const dark = mode === "dark";
  $("btn-theme").textContent = dark ? "Light" : "Dark";
  $("btn-theme").setAttribute("aria-pressed", String(dark));
  try {
    localStorage.setItem("pf-theme", mode);
  } catch {
    // Storage can be unavailable; the theme still applies for this visit.
  }
}

function restoreTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem("pf-theme");
  } catch {
    stored = null;
  }
  if (stored === "light" || stored === "dark") setTheme(stored);
  else $("btn-theme").setAttribute("aria-pressed", String(effectiveTheme() === "dark"));
}

// ---------- Plain-English tooltips on the static controls ----------

function attachStaticTips() {
  for (const a of document.querySelectorAll("[data-nav]")) a.dataset.tip = RAIL_TIPS[a.dataset.nav] || "";
  for (const b of document.querySelectorAll("[data-preset]")) {
    b.dataset.tip = UI_TIPS.presets;
  }
  const map = {
    "f-from": UI_TIPS.from,
    "f-to": UI_TIPS.to,
    "f-account": UI_TIPS.account,
    "f-category": UI_TIPS.category,
    "f-subcategory": UI_TIPS.subcategory,
    "btn-theme": UI_TIPS.dark,
    "btn-import": UI_TIPS.reread,
    "btn-resolve": UI_TIPS.identify,
    "tx-search": UI_TIPS.txSearch,
  };
  for (const [id, text] of Object.entries(map)) {
    const node = $(id);
    if (node) node.dataset.tip = text;
  }
  for (const [id, text] of [["tab-all", UI_TIPS.txAll], ["tab-review", UI_TIPS.txReview]]) $(id).dataset.tip = text;
  $("tx-remember").closest("label").dataset.tip = UI_TIPS.txRemember;
  $("bal-fund").dataset.tip = UI_TIPS.fundInput;
  $("bal-loan-name").closest("label").dataset.tip = UI_TIPS.loanInput;
  for (const b of document.querySelectorAll("[data-tree]")) b.dataset.tip = UI_TIPS.chartTree;
}

// ---------- Wiring ----------

function wire() {
  initTooltips();
  attachStaticTips();
  for (const b of document.querySelectorAll("[data-preset]")) b.addEventListener("click", () => applyPreset(b.dataset.preset));

  $("f-from").addEventListener("change", (e) => {
    state.from = e.target.value;
    state.preset = "custom";
    clearFocusSilently();
    afterFilterChange();
  });
  $("f-to").addEventListener("change", (e) => {
    state.to = e.target.value;
    state.preset = "custom";
    clearFocusSilently();
    afterFilterChange();
  });
  $("f-account").addEventListener("change", (e) => { state.account = e.target.value; afterFilterChange(); });
  $("f-category").addEventListener("change", (e) => {
    state.category = e.target.value;
    state.subcategory = "";
    afterFilterChange();
  });
  $("f-subcategory").addEventListener("change", (e) => {
    const value = e.target.value;
    state.subcategory = value;
    if (value) state.category = categoryOfSub(value) || state.category;
    afterFilterChange();
  });

  $("btn-theme").addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
  $("btn-import").addEventListener("click", (e) => reread(e.currentTarget).catch(showError));
  $("btn-resolve").addEventListener("click", (e) => askToIdentify(e.currentTarget).catch(showError));

  for (const b of document.querySelectorAll("[data-tree]")) {
    b.addEventListener("click", () => {
      state.treeMode = b.dataset.tree;
      for (const other of document.querySelectorAll("[data-tree]")) other.setAttribute("aria-pressed", String(other === b));
      refreshView();
    });
  }

  for (const b of document.querySelectorAll("[data-tx-mode]")) {
    b.addEventListener("click", () => {
      state.txMode = b.dataset.txMode;
      state.txOffset = 0;
      renderTransactions().catch(showError);
    });
  }
  let searchTimer = null;
  $("tx-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.txQuery = e.target.value.trim();
      state.txOffset = 0;
      renderTransactions().catch(showError);
    }, 250);
  });
  $("tx-prev").addEventListener("click", () => { state.txOffset = Math.max(0, state.txOffset - PAGE_SIZE); renderTransactions().catch(showError); });
  $("tx-next").addEventListener("click", () => { state.txOffset += PAGE_SIZE; renderTransactions().catch(showError); });

  $("balances-form").addEventListener("submit", (e) => {
    saveBalances(e).catch((err) => showToast(`Could not save: ${err.message}`));
  });

  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat().catch(showError); });
  $("chat-input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      sendChat().catch(showError);
    }
  });

  const advice = $("advice");
  $("advice-close").addEventListener("click", () => advice.close());
  advice.addEventListener("click", (e) => { if (e.target === advice) advice.close(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.kpiOpen) toggleKpi(state.kpiOpen);
  });

  window.addEventListener("hashchange", () => showView(routeName()));
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      state.dirty.add(state.view);
      renderCurrent();
    }, 150);
  });
}

async function boot() {
  wire();
  restoreTheme();
  try {
    const meta = await getJson("/api/meta");
    if (!meta.ready) {
      setNotice($("notice-host"), "Reading your statements for the first time. This takes a moment.");
      state.meta = meta;
      setLabels(meta.taxonomy);
      await getJson("/api/import", { method: "POST" });
    }
    state.meta = await getJson("/api/meta");
    setLabels(state.meta.taxonomy);
    fillCategoryFilters();
    state.preset = "3m";
    const range = presetRange("3m");
    state.from = range.from;
    state.to = range.to;
    syncControls();
    await loadAll();
  } catch (err) {
    showError(err);
  }
  showView(routeName());
}

boot();
