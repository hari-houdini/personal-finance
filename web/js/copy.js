// Plain-English words for the dashboard. Written for someone who wants the idea in one breath.
// Tooltips use these strings; keep them short and concrete. Each KPI carries the direction that counts as good.

export const KPI_COPY = {
  earned: {
    label: "Earned income",
    tip: "Money that came in from your job, benefits or pension. Like pocket money for doing a job.",
    explain: "Every payment that came in for work, benefits or a pension. Money from family and gifts is not counted here.",
    good: "up",
  },
  spending: {
    label: "Spending",
    tip: "Money you used up on things like food, bills and fun. Money you moved to your own accounts does not count.",
    explain: "Every payment you made for things you used up. Refunds take money off this total.",
    good: "down",
  },
  debt: {
    label: "Debt payments",
    tip: "Money you paid back on loans. Like paying back a friend who lent you money.",
    explain: "Payments on loans, car finance and other borrowing. They reduce what you owe.",
    good: "down",
  },
  net: {
    label: "Net",
    tip: "Money in minus money out. Above £0 means you kept some money this time. Below £0 means you spent more than you got.",
    explain: "Everything that came in, minus everything that went out. Transfers between your own accounts are left out.",
    good: "up",
  },
  savings: {
    label: "Savings rate",
    tip: "Out of every £100 you earned, how many pounds you kept after spending and paying debts.",
    explain: "All money in (earned income and other income), minus spending and debt, as a share of that money in. The stability target is in config/stability.json.",
    good: "up",
  },
  family: {
    label: "Family transfers in",
    tip: "Money your family sent you. It is not counted as earning.",
    explain: "Money from family members. It shows in the cash flow, but it is not earned income.",
    good: null,
  },
};

// Stability figures (plain names and what they mean).
export const STAB_TIPS = {
  earnedMonthly: "The money you earn in an average month. A simple average of the complete months.",
  spendingMonthly: "The money you spend in an average month, including essential spending.",
  surplusMonthly: "What is left in an average month after spending and debt. The bar on the right shows the savings target.",
  emergencyFund: "How many months your emergency fund would pay for your essentials, if you lost your income.",
};

// Short hints shown on hover over each chart title, so every chart says what a click does.
export const CHART_HINTS = {
  "stacked-area": "Click a month to see only that month.",
  donut: "Click a slice to zoom in: categories, then sub-categories, then shops. Click the crumbs to zoom back out.",
  waterfall: "Click a month to see only that month.",
  sankey: "Click a box to filter the page to it.",
  streamgraph: "Click a band to see only that category.",
  "percent-bars": "Click a month to see only that month.",
  chord: "Click a name to see those transfers in Transactions.",
  tree: "Click a box to zoom in. Click the same box again to zoom back out.",
  radar: "Click a point to see only that category.",
  bullet: "Click a bar to see only that category.",
  slope: "Click a line to see only that category.",
  hbar: "Click a bar to see only that shop.",
  bubble: "Click a bubble to see only that shop.",
  "shops-tree": "Click a tile to see only that shop.",
  network: "Click a shop or a sub-category to filter the page.",
  line: "Click a month to see only that month.",
  calendar: "Click a day to see only that day.",
  "small-multiples": "Click a cell to see that category in that month.",
  boxplot: "Click a row to see only that category.",
  histogram: "Click a bar to see only payments of that size.",
  dots: "Click a dot to find that payment in Transactions.",
  gauge: "Click to see the transactions behind this figure.",
  fund: "Click to see your savings transactions.",
  "debt-bars": "Click a bar to see those debt payments in Transactions.",
  runway: "Click a month to see only that month.",
};

export const KIND_NAMES = {
  income: "Money in",
  spending: "Money out on things",
  outflow: "Money out",
  debt: "Debt payments",
  savings: "Savings",
  transfer: "Transfers",
};

export const UI_TIPS = {
  presets: "Choose how far back the charts look. Each one ends at your latest transaction.",
  from: "The first day to include.",
  to: "The last day to include.",
  account: "Choose the current account, the credit card, or both.",
  category: "Show one big group, like Eating out. Charts and figures follow this choice.",
  subcategory: "Show one kind inside a group, like Coffee & cafés.",
  dark: "Switch between a light and a dark page.",
  reread: "Read the statement files again. Use this after you add a new statement.",
  identify: "Search the web for the brand behind names we do not recognise. Only the brand word is sent, never amounts or dates.",
  railReview: "Transactions the app is not sure about. Check these first.",
  txAll: "Every transaction for the dates you chose.",
  txReview: "Only the transactions the app is not sure about.",
  txRemember: "Also use this category for every future payment to the same shop.",
  txSearch: "Find a shop or a word from the description.",
  fundInput: "Your emergency fund balance. Leave it blank to use the estimate.",
  loanInput: "Add a loan. The app ranks loans by interest rate, highest first.",
  chartTree: "Switch between a box map and a rings view. The information is the same.",
};

export const RAIL_TIPS = {
  overview: "The big picture: money in, money out and what is left.",
  cashflow: "How money moves from income into categories, month by month.",
  categories: "Where the money goes, from big groups down to single shops.",
  merchants: "Which shops you spend the most with, and how often.",
  trends: "How your spending changes over time.",
  distributions: "How big each payment is, and how often each size happens.",
  stability: "How close you are to the savings and emergency fund targets.",
  transactions: "Every single payment, with the option to change its category.",
  ask: "Ask a question about your money in plain words.",
};
