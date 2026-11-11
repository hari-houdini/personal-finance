// Budget tab: fixed, protected and variable allowances for the monthly saving the slider chooses.
// The maths is done by the API (app/budget.py). This module draws the plan and sends the saving slider, the bike switch
// and any category the owner sets by hand. Every category slider is a pin: the other variable categories share what is left.
import { clear, el, money, money2 } from "./charts/core.js";
import { BUDGET_TIPS } from "./copy.js";

const CATEGORY_STEP = 5;
let ui = null;

export function renderBudget(host, data, onChange) {
  if (!ui || ui.host !== host) ui = build(host, onChange);
  update(ui, data);
}

function panel(id, title, tip, wide = false) {
  const body = el("ul", { class: "budget-rows" });
  const node = el("article", { class: wide ? "panel wide" : "panel half", "aria-labelledby": id }, [
    el("header", {}, [el("div", {}, [el("h2", { id, text: title }), el("p", { class: "desc", text: tip })])]),
    body,
  ]);
  return { node, body };
}

function build(host, onChange) {
  clear(host);
  const state = { pins: {}, timer: null };
  const notice = el("ul", { class: "budget-flags", "aria-live": "polite" });
  const figures = el("dl", { class: "figures", "aria-label": "Budget figures" });
  const output = el("output", { class: "budget-output", for: "budget-saving" });
  const maxLabel = el("span", {});
  const slider = el("input", { type: "range", id: "budget-saving", min: "0", step: "10", value: "0", "aria-describedby": "budget-saving-help" });
  const bike = el("input", { type: "checkbox", id: "budget-bike" });
  const reset = el("button", { type: "button", class: "budget-reset", id: "budget-reset", text: "Reset sliders" });
  const controls = el("article", { class: "panel wide", "aria-labelledby": "b-saving" }, [
    el("header", {}, [
      el("div", {}, [el("h2", { id: "b-saving", text: "Monthly saving" }), el("p", { class: "desc", id: "budget-saving-help", text: BUDGET_TIPS.saving })]),
      output,
    ]),
    slider,
    el("div", { class: "budget-scale" }, [el("span", { text: money(0) }), maxLabel]),
    el("label", { class: "budget-bike" }, [bike, el("span", { text: BUDGET_TIPS.bike })]),
    el("div", { class: "budget-actions" }, [reset, el("small", { class: "help", text: BUDGET_TIPS.reset })]),
  ]);
  const mandatory = panel("b-mandatory", "Fixed costs", BUDGET_TIPS.mandatory);
  const protectedPanel = panel("b-protected", "Protected spending", BUDGET_TIPS.protected);
  const discretionary = panel("b-discretionary", "Everything else", BUDGET_TIPS.discretionary, true);
  const stability = panel("b-stability", "Emergency fund and debts", BUDGET_TIPS.stability);
  const limits = el("p", { class: "help", id: "budget-limits" });
  host.append(
    notice,
    figures,
    controls,
    el("div", { class: "panels" }, [mandatory.node, protectedPanel.node, stability.node, discretionary.node]),
    limits,
  );

  const send = () => {
    state.timer = null;
    onChange({ saving: Number(slider.value), bike_sold: bike.checked, allocations: { ...state.pins } });
  };
  const later = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(send, 150);
  };
  slider.addEventListener("input", () => {
    output.textContent = money(Number(slider.value));
    later();
  });
  bike.addEventListener("change", send);
  reset.addEventListener("click", () => {
    state.pins = {};
    clearTimeout(state.timer);
    send();
  });

  return {
    host,
    state,
    later,
    notice,
    figures,
    output,
    maxLabel,
    slider,
    bike,
    reset,
    limits,
    controls: new Map(),
    mandatory: mandatory.body,
    protectedRows: protectedPanel.body,
    discretionary: discretionary.body,
    stability: stability.body,
  };
}

function figure(label, value, hint) {
  return el("div", { class: "figure" }, [el("dt", { text: label }), el("dd", { text: value }), el("small", { text: hint })]);
}

function row(name, amount, note) {
  return el("li", {}, [el("span", { text: name }), el("strong", { text: amount }), el("small", { text: note })]);
}

// One slider per variable category. The node is kept between updates so a slider being dragged is not rebuilt.
function lineControl(ui, line) {
  const existing = ui.controls.get(line.id);
  if (existing) return existing;
  const input = el("input", { type: "range", min: "0", step: String(CATEGORY_STEP), "aria-label": `${line.name}: monthly allowance` });
  const amount = el("strong", {});
  const note = el("small", {});
  const fill = el("span", {});
  const bar = el("div", { class: "budget-bar", role: "img" }, [fill]);
  const li = el("li", { class: "budget-line", "data-id": line.id }, [el("span", { text: line.name }), amount, input, note, bar]);
  input.addEventListener("input", () => {
    amount.textContent = money2(Number(input.value));
    ui.state.pins[line.id] = Number(input.value);
    ui.later();
  });
  const control = { li, input, amount, note, fill, bar };
  ui.controls.set(line.id, control);
  return control;
}

function renderLines(ui, group, lines, pool) {
  const ids = new Set(lines.map((line) => line.id));
  for (const child of [...group.children]) {
    if (!child.dataset.id || !ids.has(child.dataset.id)) child.remove();
  }
  if (!lines.length) {
    group.append(el("li", { text: "No variable spending in the trailing months yet." }));
    return;
  }
  for (const line of lines) {
    const c = lineControl(ui, line);
    c.input.max = String(pool);
    if (document.activeElement !== c.input) c.input.value = String(line.allowance);
    c.amount.textContent = money2(line.allowance);
    c.note.textContent = `${line.pinned ? "Set by you" : "Shared"} · usual ${money2(line.historical)}`;
    const share = line.historical > 0 ? Math.min(100, (line.allowance / line.historical) * 100) : 0;
    c.fill.style.width = `${share.toFixed(1)}%`;
    c.bar.setAttribute("aria-label", `${Math.round(share)}% of your usual spend`);
    if (c.li.parentNode !== group) group.append(c.li);
  }
}

function update(ui, d) {
  const s = d.saving;
  const notAffordable = d.protected.scale < 1;

  clear(ui.notice);
  for (const flag of d.flags) ui.notice.append(el("li", { text: flag }));

  clear(ui.figures);
  ui.figures.append(
    figure("Income a month", money2(d.income.total), `base ${money(d.income.base)} + household ${money(d.income.household)}`),
    figure("Fixed costs", money2(d.mandatory.total), "bills, rent, loans, cards, insurance and tax"),
    figure("Protected spending", money2(d.protected.total), notAffordable ? "cut to fit the saving you chose" : "groceries, pharmacy, fuel, pets, family"),
    figure("Left for everything else", money2(d.discretionary.budget), "shared across the categories below"),
    figure("Saving", money2(s.value), s.rate == null ? "" : `${(s.rate * 100).toFixed(1)}% of income, target ${money(s.target)}`),
  );

  ui.maxLabel.textContent = `up to ${money(s.max)}`;
  ui.slider.max = String(s.max);
  if (document.activeElement !== ui.slider) ui.slider.value = String(s.value);
  ui.output.textContent = money(s.value);
  if (document.activeElement !== ui.bike) ui.bike.checked = Boolean(d.bike_sold);
  ui.reset.disabled = Object.keys(ui.state.pins).length === 0;

  clear(ui.mandatory);
  for (const line of d.mandatory.lines) ui.mandatory.append(row(line.name, money2(line.amount), line.basis));
  for (const b of Object.values(d.benchmarks || {})) {
    const note = `${b.label}. You pay ${money2(b.yours)} a month on average.`;
    ui.mandatory.append(row(`${b.name} (company average)`, money2(b.monthly), note));
  }

  renderLines(ui, ui.protectedRows, d.protected.lines, d.variable_pool);
  renderLines(ui, ui.discretionary, d.discretionary.lines, d.variable_pool);

  clear(ui.stability);
  const fund = d.stability.emergency_fund;
  const coverText = fund.months_cover == null ? "Enter your balance to see this" : `${fund.months_cover.toFixed(1)} months`;
  ui.stability.append(
    row("Emergency fund cover", coverText, fund.balance == null ? "Enter your balance on the Stability plan tab." : `balance ${money(fund.balance)}`),
    row(
      `Months to ${fund.target_start_months}-month cover`,
      fund.months_to_start == null ? "n/a" : fund.months_to_start === 0 ? "reached" : `${fund.months_to_start} months`,
      `at ${money(s.value)} a month`,
    ),
    row(
      `Months to ${fund.target_full_months}-month cover`,
      fund.months_to_full == null ? "n/a" : fund.months_to_full === 0 ? "reached" : `${fund.months_to_full} months`,
      `target ${money(fund.target_full_amount)}`,
    ),
  );
  for (const debt of d.stability.debts) {
    const clears = debt.months_to_clear == null ? "balance not entered" : `about ${debt.months_to_clear} months to clear`;
    ui.stability.append(row(debt.name, money2(debt.monthly), `${clears}${debt.apr ? `, ${debt.apr}% a year` : ""}`));
  }

  ui.limits.textContent = d.limits;
}
