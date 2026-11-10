# Surface brief: personal finance dashboard

## Scope and mode

Operate. The owner is in a task: reading where money went, filtering it, and deciding what to change. Scanability and consistency outrank expression. Brand lives in the details.

## Audience, job, action, constraints

- Audience: the owner of the statements, alone, desktop first, phone second.
- Job: answer "where did my money go, and what should I change?" for any date range.
- Action: filter by date range, category and sub-category; drill into merchants; correct a mis-tagged transaction; ask the chat; open advice in the modal.
- Constraints: GBP, local only, read-only statements, estimates labelled as estimates, no emoji or unicode icons, no hero numbers.

## Direction contract

THESIS: a quiet ledger. The page reads like a well-kept paper account book, not a fintech splash: warm paper ground, ink text, hairline rules, and one accent that marks only what is selected or needs action. It refuses the category default of gradient KPI tiles and glowing charts.

OWN-WORLD: warm off-white paper (#F6F5F1) with ink text (#1C1E20) and a warm-grey secondary layer (#ECEAE3) for the side rail and filter bar. The single accent is deep teal (#0E6A68). Dark theme: charcoal ink ground (#141517) with paper-toned text (#E9E7E1). Charts use an eight-hue categorical set tuned for colour-vision deficiency, always paired with direct labels or a legend, never colour alone.

STORY: the owner sees, in one screen, the month's income, spending, debt, savings and net; sees which categories carry the spending; drills into a sub-category to see the shops; and sees how the emergency fund and savings rate stand against targets.

FIRST VIEWPORT: a top bar with the global date range and filters, a left rail with the sections, and on the Overview a row of five plain figures (income, spending, debt, savings, net) separated by hairlines, then the monthly cash-flow chart spanning the width. The primary action, filtering, sits in the top bar.

FORM: a restrained Operate dashboard with a fixed left rail, a filter bar, and a single scrolling content column with panels divided by hairlines. No nested cards and no card grid as page structure. Modal (native dialog) only for the advice answer, which the owner requested. No concept roll was run: this is a single-user tool in Operate mode, where familiarity is the goal.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved decisions

- None that block the build. Chart colour pairs and dark-theme balance are confirmed in the render review.
