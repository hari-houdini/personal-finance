// Budget tab: fixed, protected and variable allowances for the monthly saving the slider chooses.
// The maths is done by the API (app/budget.py). This module only draws the plan and sends slider and switch changes back.
import { clear, el, money, money2 } from "./charts/core.js";
import { BUDGET_TIPS } from "./copy.js";

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
  const notice = el("ul", { class: "budget-flags", "aria-live": "polite" });
  const figures = el("dl", { class: "figures", "aria-label": "Budget figures" });
  const output = el("output", { class: "budget-output", for: "budget-saving" });
  const maxLabel = el("span", {});
  const slider = el("input", { type: "range", id: "budget-saving", min: "0", step: "10", value: "0", "aria-describedby": "budget-saving-help" });
  const bike = el("input", { type: "checkbox", id: "budget-bike" });
  const controls = el("article", { class: "panel wide", "aria-labelledby": "b-saving" }, [
    el("header", {}, [
      el("div", {}, [el("h2", { id: "b-saving", text: "Monthly saving" }), el("p", { class: "desc", id: "budget-saving-help", text: BUDGET_TIPS.saving })]),
      output,
    ]),
    slider,
    el("div", { class: "budget-scale" }, [el("span", { text: money(0) }), maxLabel]),
    el("label", { class: "budget-bike" }, [bike, el("span", { text: BUDGET_TIPS.bike })]),
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

  let timer = null;
  const send = () => onChange({ saving: Number(slider.value), bike_sold: bike.checked });
  slider.addEventListener("input", () => {
    output.textContent = money(Number(slider.value));
    clearTimeout(timer);
    timer = setTimeout(send, 150);
  });
  bike.addEventListener("change", send);

  return {
    host,
    notice,
    figures,
    output,
    maxLabel,
    slider,
    bike,
    limits,
    mandatory: mandatory.body,
    protectedRows: protectedPanel.body,
    discretionary: discretionary.body,
    stability: stability.body,
  };
}

function figure(label, value, hint) {
  return el("div", { class: "figure" }, [el("dt", { text: label }), el("dd", { text: value }), el("small", { text: hint })]);
}

function bar(allowance, typical) {
  const share = typical > 0 ? Math.min(100, (allowance / typical) * 100) : 0;
  return el("div", { class: "budget-bar", role: "img", "aria-label": `${Math.round(share)}% of your usual spend` }, [
    el("span", { style: `width: ${share.toFixed(1)}%` }),
  ]);
}

function row(name, amount, note, extra = null) {
  return el("li", {}, [el("span", { text: name }), el("strong", { text: amount }), el("small", { text: note }), extra]);
}

function update(ui, d) {
  const s = d.saving;
  const notAffordable = d.protected.scale < 1;

  clear(ui.notice);
  for (const flag of d.flags) ui.notice.append(el("li", { text: flag }));

  clear(ui.figures);
  ui.figures.append(
    figure("Income a month", money2(d.income.total), `base ${money(d.income.base)} + household ${money(d.income.household)}`),
    figure("Fixed costs", money2(d.mandatory.total), "bills, rent, loans, insurance and tax"),
    figure("Protected spending", money2(d.protected.total), notAffordable ? "cut to fit the saving you chose" : "groceries, pharmacy, fuel, pets, family"),
    figure("Left for everything else", money2(d.discretionary.budget), "shared across the categories below"),
    figure("Saving", money2(s.value), s.rate == null ? "" : `${(s.rate * 100).toFixed(1)}% of income, target ${money(s.target)}`),
  );

  ui.maxLabel.textContent = `up to ${money(s.max)}`;
  ui.slider.max = String(s.max);
  if (document.activeElement !== ui.slider) ui.slider.value = String(s.value);
  ui.output.textContent = money(s.value);
  if (document.activeElement !== ui.bike) ui.bike.checked = Boolean(d.bike_sold);

  clear(ui.mandatory);
  for (const line of d.mandatory.lines) ui.mandatory.append(row(line.name, money2(line.amount), line.basis));

  clear(ui.protectedRows);
  for (const line of d.protected.lines) {
    ui.protectedRows.append(row(line.name, money2(line.allowance), `usual ${money2(line.historical)}`, bar(line.allowance, line.historical)));
  }

  clear(ui.discretionary);
  for (const line of d.discretionary.lines) {
    ui.discretionary.append(row(line.name, money2(line.allowance), `usual ${money2(line.historical)}`, bar(line.allowance, line.historical)));
  }
  if (!d.discretionary.lines.length) ui.discretionary.append(el("li", { text: "No variable spending in the trailing months yet." }));

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
