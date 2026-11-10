// App controller: owns the filters, routes between sections, draws each section's charts from the API,
// and wires the transactions table, the balances form, merchant identification, import, and chat.
import {
  catLabel, clear, el, emptyState, money, money2, pct, setLabels, subLabel, dayLabel,
} from "./charts/core.js";
import * as flow from "./charts/flow.js";
import * as hier from "./charts/hier.js";
import * as trends from "./charts/trends.js";
import * as dist from "./charts/dist.js";
import * as stab from "./charts/stab.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["overview", "cashflow", "categories", "merchants", "trends", "distributions", "stability", "transactions", "ask"];
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

function filterQuery(extra = {}) {
  const p = new URLSearchParams();
  if (state.from) p.set("from", state.from);
  if (state.to) p.set("to", state.to);
  if (state.account) p.set("account", state.account);
  if (state.category) p.set("category", state.category);
  if (state.subcategory) p.set("subcategory", state.subcategory);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== false && v !== "") p.set(k, String(v));
  return p.toString();
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

// ---------- Dates and filters ----------

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
  syncDateInputs();
  for (const b of document.querySelectorAll("[data-preset]")) b.setAttribute("aria-pressed", String(b.dataset.preset === key));
  refreshAnalytics();
}

function syncDateInputs() {
  $("f-from").value = state.from;
  $("f-to").value = state.to;
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
  for (const [label, value, note] of items) {
    host.append(el("div", { class: "figure" }, [
      el("dt", { text: label }),
      el("dd", {}, [document.createTextNode(value), note ? el("span", { class: "note", text: note }) : null]),
    ]));
  }
}

function renderKpis() {
  const k = state.analytics.kpis;
  const items = [
    ["Earned income", money(k.earned_income), k.other_income ? `plus ${money(k.other_income)} other income` : "salary and benefits"],
    ["Spending", money(k.spending), `${k.transactions} transactions in these dates`],
    ["Debt payments", money(k.debt_service), "loans and finance repayments"],
    ["Net", money(k.net), "money in minus money out, excluding transfers"],
    ["Savings rate", pct(k.savings_rate), "earned income left after spending and debt"],
  ];
  if (k.family_in) items.push(["Family transfers in", money(k.family_in), "shown in cash flow, not counted as earned income"]);
  figureList($("kpis"), items);
}

// Each chart host names its chart in data-chart. The registry maps that name to a draw call.
const CHARTS = {
  "stacked-area": (h, c) => flow.stackedArea(h, c.a.monthly),
  "donut": (h, c) => flow.donut(h, Object.fromEntries(c.a.hierarchy.children.map((k) => [k.id, k.value])), catLabel),
  "waterfall": (h, c) => flow.waterfall(h, c.a.monthly),
  "sankey": (h, c) => flow.sankey(h, c.a.kpis, c.a.hierarchy, catLabel),
  "streamgraph": (h, c) => flow.streamgraph(h, c.a.monthly),
  "percent-bars": (h, c) => flow.percentBars(h, c.a.monthly),
  "chord": (h, c) => flow.chord(h, c.a.transfers),
  "tree": (h, c) => (state.treeMode === "sunburst" ? hier.sunburst : hier.treemap)(h, c.a.hierarchy),
  "radar": (h, c) => hier.radar(h, c.a.monthly),
  "bullet": (h, c) => hier.bullet(h, c.a.monthly),
  "slope": (h, c) => hier.slope(h, c.a.monthly),
  "hbar": (h, c) => hier.hbar(h, c.a.merchants),
  "bubble": (h, c) => hier.bubble(h, c.a.merchants),
  "shops-tree": (h, c) => hier.shopsTree(h, c.a.merchants),
  "network": (h, c) => hier.network(h, c.a.merchants),
  "line": (h, c) => trends.line(h, c.a.monthly),
  "calendar": (h, c) => trends.calendar(h, c.a.daily),
  "small-multiples": (h, c) => trends.smallMultiples(h, c.a.monthly),
  "boxplot": (h, c) => dist.boxplot(h, c.a.amounts_by_category),
  "histogram": (h, c) => dist.histogram(h, c.a.amounts_by_category),
  "dots": (h, c) => dist.dots(h, c.payments),
  "gauge": (h, c) => stab.rateGauge(h, c.s),
  "fund": (h, c) => stab.fundGauge(h, c.s),
  "debt-bars": (h, c) => stab.debtBars(h, c.s),
  "runway": (h, c) => stab.runway(h, c.s),
};

function drawHosts(section, ctx) {
  for (const host of section.querySelectorAll("[data-chart]")) {
    const fn = CHARTS[host.dataset.chart];
    if (!fn) continue;
    try {
      fn(host, ctx);
    } catch (err) {
      console.error(host.dataset.chart, err);
      emptyState(host, "This chart could not be drawn at this width. The table view still has the figures.");
    }
  }
}

function renderStability() {
  const s = state.stability;
  const b = s.baseline;
  const ef = s.emergency_fund;
  const gap = s.monthly_gap_to_target;
  figureList($("stab-figures"), [
    ["Earned income a month", money(b.earned_income_monthly), `average of ${s.window_months.length} complete months`],
    ["Spending a month", money(b.spending_monthly), `essential ${money(b.essential_spend_monthly)}`],
    ["Surplus a month", money(b.surplus_monthly), gap != null && gap > 0 ? `${money(gap)} short of the savings target` : "at or above the savings target"],
    ["Emergency fund", ef.months_cover == null ? "n/a" : `${ef.months_cover.toFixed(1)} months`, ef.source],
  ]);
  setNotice($("stab-notice"), s.limits);
  const fundInput = $("bal-fund");
  if (document.activeElement !== fundInput) fundInput.value = ef.source === "entered by you" ? String(ef.balance) : "";
  const order = s.debt.avalanche_order || [];
  $("bal-help").textContent = order.length
    ? `Avalanche order, highest interest first: ${order.map((l) => `${l.name} (${l.apr}% a year)`).join(", ")}.`
    : s.debt.note || "Add loans one at a time. Saved loans show here in avalanche order (highest interest first).";
}

function renderMerchantsHeading() {
  $("hbar-desc").textContent = state.subcategory
    ? `Shops for ${subLabel(state.subcategory)}, largest spend first.`
    : "Largest spend, by merchant.";
}

async function renderSection(name) {
  if (name === "transactions") return renderTransactions();
  if (name === "ask") return undefined;
  const section = $(`view-${name}`);
  if (name === "stability") renderStability();
  if (name === "overview") renderKpis();
  if (name === "merchants") renderMerchantsHeading();
  if (name === "distributions") await ensurePayments();
  if (state.view !== name) return undefined;
  drawHosts(section, { a: state.analytics, s: state.stability, payments: state.payments || [] });
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
  const select = el("select", { "aria-label": `Category for ${t.merchant} on ${dayLabel(t.date)}` });
  for (const group of subGroupTemplate()) select.append(group.cloneNode(true));
  select.value = t.subcategory_id;
  select.addEventListener("change", () => reclassify(t, select));
  return el("tr", {}, [
    el("td", { text: dayLabel(t.date) }),
    el("td", { title: t.description, text: t.merchant }),
    el("td", { class: "num", text: money2(t.amount) }),
    el("td", {}, [select]),
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

async function reclassify(tx, select) {
  const next = select.value;
  if (next === tx.subcategory_id) return;
  const remember = $("tx-remember").checked;
  select.disabled = true;
  try {
    await getJson("/api/classify", { method: "POST", ...jsonBody({ transaction_id: tx.id, subcategory_id: next, remember }) });
    showToast(remember
      ? `Saved. Future payments to ${tx.merchant} go to ${subLabel(next)}.`
      : `Moved to ${subLabel(next)}.`);
    await loadAll();
  } catch (err) {
    select.value = tx.subcategory_id;
    showToast(`Could not save: ${err.message}`);
  } finally {
    select.disabled = false;
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

// ---------- Wiring ----------

function wire() {
  for (const b of document.querySelectorAll("[data-preset]")) b.addEventListener("click", () => applyPreset(b.dataset.preset));

  $("f-from").addEventListener("change", (e) => { state.from = e.target.value; state.preset = "custom"; markPresetCustom(); refreshAnalytics(); });
  $("f-to").addEventListener("change", (e) => { state.to = e.target.value; state.preset = "custom"; markPresetCustom(); refreshAnalytics(); });
  $("f-account").addEventListener("change", (e) => { state.account = e.target.value; refreshAnalytics(); });
  $("f-category").addEventListener("change", (e) => {
    state.category = e.target.value;
    state.subcategory = "";
    renderSubFilter();
    refreshAnalytics();
  });
  $("f-subcategory").addEventListener("change", (e) => { state.subcategory = e.target.value; refreshAnalytics(); });

  $("btn-theme").addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
  $("btn-import").addEventListener("click", (e) => reread(e.currentTarget).catch(showError));
  $("btn-resolve").addEventListener("click", (e) => askToIdentify(e.currentTarget).catch(showError));

  for (const b of document.querySelectorAll("[data-tree]")) {
    b.addEventListener("click", () => {
      state.treeMode = b.dataset.tree;
      for (const other of document.querySelectorAll("[data-tree]")) other.setAttribute("aria-pressed", String(other === b));
      state.dirty.add("categories");
      renderCurrent();
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

function markPresetCustom() {
  for (const b of document.querySelectorAll("[data-preset]")) b.setAttribute("aria-pressed", "false");
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
    syncDateInputs();
    await loadAll();
  } catch (err) {
    showError(err);
  }
  showView(routeName());
}

boot();
