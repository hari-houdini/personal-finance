---
name: Personal Finance
description: A quiet local analyst's desk for reading where the money went and what to change.
colors:
  page: "#f9f9f7"
  surface: "#fcfcfb"
  surface-2: "#f3f2ee"
  border: "rgba(11, 11, 11, 0.10)"
  grid: "#e1e0d9"
  axis: "#c3c2b7"
  ink: "#0b0b0b"
  ink-2: "#52514e"
  ink-3: "#6f6e69"
  accent: "#2a78d6"
  accent-ink: "#ffffff"
  accent-wash: "rgba(42, 120, 214, 0.10)"
  series-1: "#2a78d6"
  series-2: "#eb6834"
  series-3: "#1baf7a"
  series-4: "#eda100"
  series-5: "#e87ba4"
  series-6: "#008300"
  series-7: "#6250d6"
  series-8: "#e34948"
  good: "#0ca30c"
  good-text: "#006300"
  warning: "#fab219"
  serious: "#ec835a"
  critical: "#d03b3b"
  diverge-mid: "#f0efec"
typography:
  page-title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1.625rem"
    fontWeight: 650
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1.1875rem"
    fontWeight: 600
  figure:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
  caption:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
  pill: "999px"
spacing:
  gap: "1rem"
  gutter: "1.5rem"
  gutter-mobile: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.7rem"
    height: "2rem"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.7rem"
    height: "2rem"
  button-default-hover:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.7rem"
    height: "2rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.5rem"
    height: "2rem"
  nav-link:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.6rem"
  nav-link-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.6rem"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0.9rem 1rem 1rem"
  badge-review:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "0.05rem 0.4rem"
---

# Design System: Personal Finance

## Overview

**Creative North Star: "The Personal Financial Analyst"**

The interface works like an analyst's desk, and its advice is plain. The owner is reading their own statements, so the screen leads with exact figures and their sources: five plain numbers above the monthly cash-flow chart, then a drill from category to sub-category to shop without leaving the page.

The system is quiet on purpose. A paper-white ground, graphite text, 1px hairlines, and one cobalt accent carry the structure. Colour in the charts is reserved for categories and labelled directly. Nothing decorative competes with a figure, and nothing shows a figure without its source.

The advice answer is the only element that leaves the page. It opens in a native dialog, separated from the data it discusses.

Note for future work: the surface brief's earlier paper-and-teal direction (warm #F6F5F1 ground, #0E6A68 accent) is not implemented. This file records the built system.

**Key Characteristics:**
- Cool neutral ground, graphite text, and one cobalt accent.
- Flat surfaces, structured by hairlines rather than shadows.
- Five plain figures above a full-width chart. No hero numbers and no gradient tiles.
- Eight categorical chart colours, always paired with direct labels or a legend.
- Compact, system-font Operate controls.

## Colors

A cool paper-white ground with near-black ink and a single saturated blue accent. The eight-hue categorical palette exists only for chart series.

### Primary
- **Clear Cobalt** (#2a78d6; dark theme #3987e5): The one accent. It marks the primary action, the selected preset or tab, the current rail section, focus rings, and chart series 1.

### Secondary
- **Ember** (#eb6834; dark #d95926), **Sea Green** (#1baf7a; dark #199e70), **Marigold** (#eda100; dark #c98500), **Rose** (#e87ba4; dark #d55181), **Forest** (#008300; the same in both themes), **Violet** (#6250d6; dark #9085e9), and **Brick** (#e34948; dark #e66767): chart series 2 to 8, in slot order. They are never cycled. Any ninth category folds into "Other".

### Neutral
- **Paper White** (#f9f9f7): the page ground.
- **Warm White** (#fcfcfb): panel and card surfaces.
- **Parchment Grey** (#f3f2ee): the rail and the top bar.
- **Graphite** (#0b0b0b): primary text.
- **Slate Ink** (#52514e): secondary text and rail links.
- **Muted Ink** (#6f6e69): labels, captions, and axis text. It meets 4.5:1 on the light surface.
- **Grid Grey** (#e1e0d9) and **Axis Grey** (#c3c2b7): gridlines and axes.
- **Hairline** (rgba(11, 11, 11, 0.10)): every border.

### Status
- **Good Green** (#0ca30c; text #006300), **Warning Amber** (#fab219), **Serious Coral** (#ec835a), and **Critical Red** (#d03b3b). These carry meaning only, such as "needs review" or an attention count, and are never used to identify a series.

Dark theme applies when the OS is set to dark, or when the viewer picks it with the Dark button. An explicit light setting wins over the OS. The charcoal ground is #0d0d0d, panels are #1a1a19, and text is #f0efec.

### Named Rules
**The One Accent Rule.** Cobalt marks only what is selected, focused, or the primary action. Series 1 shares the hue by design, and no other element uses it.

**The Status Is Never Identity Rule.** Status colours never name a series or category. Each is paired with a text label or an icon.

## Typography

**Display Font:** system-ui (with -apple-system, "Segoe UI", sans-serif)
**Body Font:** the same system stack
**Label/Mono Font:** the same stack. No monospace is used. Charts and tables use tabular numerals.

**Character:** No web font loads, so the page reads as a native desktop tool. Hierarchy comes from size and weight alone.

### Hierarchy
- **Page title** (650, 1.625rem / 26px, letter-spacing -0.01em): the view's h1, such as Overview or Cash flow.
- **Panel title** (600, 1.1875rem / 19px): each panel's h2.
- **Figure** (600, 1.5rem / 24px, lining numerals): the five summary values. Figures are numbers, not headings.
- **Body** (400, 0.9375rem / 15px, line-height 1.45): running text. The lede is capped at 65ch.
- **Label** (400, 0.8125rem / 13px): controls, table cells, and legends.
- **Caption** (400, 0.75rem / 12px, Muted Ink): axis ticks, hints, and rail counts, with tabular numerals.

### Named Rules
**The Three Step Rule.** Each heading step is at least 1.25 times the step below it, so the page title, panel title, and body read as three distinct levels.

## Layout

The shell is a fixed 13.5rem left rail beside a fluid column (`minmax(0, 1fr)`). The top bar is 3.25rem tall and sticky. It holds the date range, the filters, and the actions. The content column is capped at 1280px, with padding of 1.25rem top, 1.5rem sides, and 4rem bottom.

The Overview's figure row uses auto-fit columns of at least 10rem, with hairlines above and below and a 1px rule between figures. Panels sit on a 12-column grid with a 1.5rem row gap and a 1.25rem column gap. `.half` spans 6 columns, `.third` spans 4, and `.wide` spans 12.

Responsive behaviour:
- At 1100px and below, half and third panels span the full width.
- At 860px and below, the rail becomes a sticky horizontal strip above the content, the top bar stacks, and the shell becomes one column.
- At 600px and below, the gutter drops to 1rem, figures go two to a row, panel padding drops to 0.75rem, and the filters form a two-column grid with the presets full width.

Spacing follows observed values, not a strict scale. The common steps are 0.25, 0.4, 0.6, 0.9, 1, 1.25, and 1.5rem.

## Elevation & Depth

The system is flat. Depth comes from tone (page, surface, and the rail's Parchment Grey) and from 1px hairlines at 10% ink. Only floating layers carry a shadow.

### Shadow Vocabulary
- **Tooltip lift** (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10)`): the one shared hover tooltip, which floats above a chart.
- **Dialog backdrop** (`rgba(11, 11, 11, 0.38)`): the advice dialog has no shadow. It is separated by this backdrop and a 180ms fade-and-rise on open.

### Named Rules
**The Hairline Rule.** Structure is drawn with 1px borders. Panels never nest, and they never gain a shadow at rest.

## Shapes

Panels, the advice dialog, and chat messages use a 6px radius. Buttons, inputs, selects, rail items, and the tooltip use 4px. Badges are 999px pills. Focus outlines are 2px in cobalt with a 2px offset.

The active rail item carries a 2px inset accent bar: on the left on desktop, and along the bottom on mobile. Figures and tables are separated by hairline rules rather than boxes.

## Components

Each component leads with its character, then its states.

### Buttons
- **Shape:** 4px radius, 2rem minimum height, padding 0.3rem 0.7rem, 13px label.
- **Primary:** Cobalt fill with white text. It brightens by 5% on hover.
- **Default:** Warm White fill with a hairline border. It takes an accent wash on hover.
- **Ghost:** Transparent, with the accent wash on hover.
- **Disabled:** Parchment Grey fill, Muted Ink text, `not-allowed` cursor.

### Segmented Controls (presets and tabs)
- **Presets:** An inline group with a hairline border and 6px radius. The selected option is a cobalt fill with white text.
- **Tabs:** The same group shape. The selected tab takes an accent wash with weight 600.

### Inputs / Fields
- **Style:** Warm White fill, hairline border, 4px radius, 2rem minimum height.
- **Focus:** The 2px cobalt focus outline, offset 2px.

### Navigation (rail)
- **Style:** Slate Ink 13px links with 0.45rem by 0.6rem padding.
- **Hover:** Accent wash, with text shifting to Graphite.
- **Current:** Warm White fill, Graphite text at weight 600, and a 2px inset accent bar.
- **Counts:** 12px tabular numerals in Muted Ink. The attention count is Serious Coral at weight 600.

### Panels
- **Corner Style:** 6px radius.
- **Background:** Warm White, with a hairline border.
- **Shadow Strategy:** None at rest. See Elevation & Depth.
- **Internal Padding:** 0.9rem top, 1rem sides, 1rem bottom.
- **Header:** Title and description share a baseline. The description is Slate Ink.

### Badges
- **Needs review:** A pill with a 1px Serious Coral border and Graphite text. The label prefix "Needs review:" is printed in Muted Ink, so the status is readable without colour.

### Charts
- **Labelling:** Every series has a direct label or a legend entry. Colour is never the only cue.
- **Table twin:** Every chart has a table alternative in the DOM, so no value is reachable only through a hover.
- **Text:** 12px Muted Ink, with tabular numerals.
- **Tooltip:** One shared element, positioned by script, with the Tooltip lift shadow.

### Advice Dialog
- **Shape:** A native `<dialog>`, width `min(44rem, 100vw - 2rem)`, with a 6px radius and a hairline border.
- **Header:** Separated from the body by a hairline. The answer sits in the body with its figures in a hairline-ruled grid.

### Toast
- **Style:** Graphite fill with Paper White text and a 4px radius, centred at the bottom of the viewport.

### Named Rules
**The Table Twin Rule.** No chart value may be reachable only through a hover. Each chart ships with its table.

## Do's and Don'ts

### Do:
- **Do** reserve Clear Cobalt (#2a78d6) for the primary action, the selected item, focus, and series 1.
- **Do** pair every colour-coded status or series with a text label, a legend entry, or an icon.
- **Do** give each chart a table twin in the DOM.
- **Do** label estimates as estimates in the text, for example the emergency fund and loan balances until the owner enters them.
- **Do** use the 1px hairline border for panel and section structure.

### Don't:
- **Don't** use gradients, glows, or drop shadows on panels, figures, or charts at rest.
- **Don't** nest panels, or use cards as the page's structure.
- **Don't** use emoji or Unicode symbols as icons. Surface brief constraint.
- **Don't** load web fonts. The stack is `system-ui`.
- **Don't** cycle chart colours beyond eight categories, or use a ninth generated hue.
- **Don't** hard-code colour values outside `web/css/tokens.css`. Reference the tokens by role.
