Triage Cam is a contact-free vitals station and a waiting-room worklist. One system, Night Shift, covers the web dashboard, the landing page and both roles of the mobile app.

Night Shift is a dark system for a product that gets used at 3am. The room is dim, so the screen is too: graphite surfaces stepped by brightness, hairlines where a border would shout, and one cold accent the colour of a monitor trace. Colour is rationed so that the patient who is getting worse is the brightest thing a nurse can see.

- **Tokens:** `tokens.json`. `pnpm tokens` writes `apps/web/src/styles/tokens.css` and `apps/mobile/src/theme/tokens.ts`. Never edit those two files.
- **Moving a screen from the old system:** `MIGRATION.md` lists every token that was renamed, removed or changed value.
- **Mockups:** the Night Shift spec page (tokens, components and four screens) is the reference for the look. This file and `tokens.json` are the reference for names and values.
- **Components:** one README per component under `components/`. `bundle.css` and `bundle.js` are a structural reference; the shipped components are in `apps/web/src/components` and `apps/mobile/src/components`.

This is a restyle. What a screen shows, what its states are and what its copy claims are decided by the product and by `packages/contracts`, not here.

## Principles

- **Brightness is the hierarchy.** Depth comes from five surface steps. No drop shadows inside the app, and no outlined card inside an outlined card.
- **Severity owns the colour.** Ice marks what is live or selected. Amber and red belong to patients, never to chrome, buttons or marketing. There is no green, because unflagged is not the same as well.
- **Numbers are instruments.** Vitals sit in a fixed-width face with tabular figures and always carry a unit, so a column does not shimmer when a value changes.
- **Light has to mean something.** Two glows exist: the head of a live trace and the dot on an urgent flag. Anything else that glows is a bug.
- **Fast under the hands.** 32px controls and 44px rows on the web, 48px targets on the phone, and a considered hover, press and focus state on everything that can be used.
- **One thing moves.** The live trace draws only while a camera is reading. Nothing else on a screen moves on its own.

## What makes it read as designed

The feel comes from craft, not decoration. Before a screen is done, check it against this list.

- Every margin, padding, gap and fixed height is a multiple of 4. Same thing, same size: all rows in a list share one height.
- Space inside a group is smaller than space between groups.
- Icons sit in one column, labels start on one line, numbers align right with tabular figures.
- Sentence case everywhere. No uppercase tracked labels, no label above a heading that repeats it.
- A chip only where there is a state to report. Counts, ages and meta are plain `ink-faint` text.
- No gradient between hues, no gradient text, no glow other than the two above, no tinted shadow, no emoji.
- An outlined panel never sits directly inside another outlined panel. Separate with a surface step or a hairline instead.
- Hover is a surface step or a colour change in 120ms. Nothing scales up or lifts on hover.

## Colour

All values are in `tokens.json`; each token's `usage` says where it goes.

**Surfaces.** Five steps, darkest first. A higher step is nearer the reader.

| Token | Value | Role |
|---|---|---|
| `surface-0` | `#0a0c0f` | The desk: page, side navigation, input wells. No edge |
| `surface-1` | `#101317` | Panels and the app window, with a `line` outline |
| `surface-2` | `#161a1f` | Cards, the detail pane, row hover |
| `surface-3` | `#1d2228` | Selected nav item, secondary button, selected segment, overlays |
| `surface-4` | `#262c34` | Pressed, secondary button hover, avatars, meter tracks |

**Lines** are the text colour at low opacity, so they hold on every step: `line` (7%) for dividers and panel outlines, `line-strong` (14%) for control borders and the dashed No reading outline, `line-hover` (24%) for an input under the pointer.

**Text.** Three roles and no others: `ink` for names, values and headings; `ink-muted` for body copy, labels and units; `ink-faint` for captions, column heads and ages. `ink-bright` (white) is only for the name and readings on an urgent row.

**Accent.** `signal` is ice, `#a9dcf7`. It is the live trace, the focus ring, the icon of the selected nav item, progress and links. `signal-strong` fills the primary button and colours live numerals; text on it is `on-signal`. `signal-soft` backs the Live tag and the focus halo of an input. The accent is never a large fill and never a status.

**Severity** is separate from the accent and is a presentation layer over what the server already sends. It does not change the flag rules.

| Severity | Tokens | When, from `packages/contracts` |
|---|---|---|
| Stable | `stable` on `stable-soft` | `state: 'observed'` with no open flag |
| Watch | `watch` on `watch-soft`, 2px `watch` row edge | An open `baseline_shift` flag, or score 1 or 2 |
| Urgent | `on-urgent` on `urgent`, row on `urgent-soft` with a 2px `urgent` edge | An open `score_rise` flag, or any open trend flag on a patient scoring 3 |
| Overdue | `on-overdue` on `overdue` (the inverse of the page) | `state: 'overdue'` |
| No reading | `ink-muted` in a dashed `line-strong` outline | `state: 'no-reading'` |

Each state has a word and a shape as well as a colour. The urgent chip is the only saturated fill in the product. `urgent` is also the text of a destructive button and of a field error; it is never used for chrome.

**Score chips.** `score-0` to `score-3` with `on-score-0` to `on-score-3` for the digit. Only 3 is solid.

**Focus** is a 2px solid `focus` ring (ice) with a 2px offset on every interactive element. An input shows it as an ice border with a 3px `signal-soft` halo instead.

Contrast on `surface-0`: `ink` 16:1, `ink-muted` 7.5:1, `ink-faint` about 4.8:1. `signal`, `watch` and `urgent` clear 6:1 as text on `surface-1`. Do not put `ink-faint` text on `surface-3` or above.

## Type

Geist for everything people read. Geist Mono only for vitals, timers and clock times, where a fixed width keeps a changing number still. Two weights, 400 and 500. 600 exists for iOS large titles and nothing else. Hierarchy comes from size and from the three text colours, not from weight.

| Token | Size / line | Use | Name in the spec |
|---|---|---|---|
| `display` | 56/58, -0.035em, 500 | Landing headline only | display |
| `title` | 28/34, -0.02em, 500 | One per screen | title-1 |
| `heading` | 20/28, -0.01em, 500 | Panel and sheet titles, the patient name | title-2 |
| `subheading` | 15/22, 500 | Section and card headings, the page name in the header | heading |
| `body` | 14/22 | Prose, mobile rows | body |
| `body-strong` | 14/22, 500 | Emphasis, large button labels | |
| `body-touch` | 16/24 | What a patient reads on the camera phone | |
| `dense` | 13/20 | Tables, navigation, inputs | dense |
| `label` | 13/20, 500 | Button labels, names in a row | dense, medium |
| `caption` | 12/16, +0.01em | Field labels, units, column heads, chips | caption |
| `readout-xl` | 72/72 mono, -0.03em | The live value on the camera phone | |
| `readout-lg` | 48/48 mono, -0.03em | A live reading on the dashboard | readout-lg |
| `readout-md` | 28/32 mono, -0.02em | Patient detail, summaries, flag cards | readout-md |
| `readout-sm` | 13/20 mono | Vitals in a table row, timers | |

- The token names are the ones the apps already use, so `heading` here is the spec's title-2 and `subheading` is the spec's heading. The last column is the map.
- Sentence case. Small text never gets negative tracking; tight tracking is for 20px and up.
- Every number that changes or sits in a column uses tabular figures.
- No italic and no bold for emphasis. Use `ink` against `ink-muted`.

**Fonts on the web** are the two variable files in `fonts/` (Geist 1.9.2, SIL Open Font License), served by `@font-face` from the generated `tokens.css`. Nothing else has to load them.

**Fonts on mobile** are the faces iOS ships: the system face (`System`) for text and the system monospace (`ui-monospace`) for vitals, both with tabular figures. Bundling Geist changes the native project and would force a new development build, which this redesign does not do. The generated type styles carry `fontFamily` and `fontWeight`; `fonts.sans[500]` no longer selects a weight on its own (see `MIGRATION.md`).

## Space, size and shape

- Spacing is `space-N` = N × 4px: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-5` 20, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64. A value between steps is fine if it is a multiple of 4; a 2px nudge is fine inside a small control.
- Web: controls `control-md` (32px), the large button `control-lg` (40px), table rows `row` (44px), nav items `nav-row` (30px) with 2px between them, panel padding `space-5`, card padding `space-4`, side navigation `nav-width` (200px), detail pane `detail-width` (292px).
- Mobile: every target is `control-touch` (48px) or taller. Screen gutter `space-4`, card padding `space-4`.
- Radius by role: `radius-sm` 4px for chips and keycaps, `radius-md` 6px for controls, `radius-lg` 10px for panels and cards, `radius-xl` 14px for sheets and mobile cards. `radius-pill` is for the switch, dots and avatars; a chip is not a pill.
- Nested radius: inner radius is the outer radius minus the padding between them, and never less than 4px.

## Elevation

| Level | Surface | Edge |
|---|---|---|
| 0 | `surface-0` | None |
| 1 | `surface-1` | `line` |
| 2 | `surface-2` | `line` |
| Overlay | `surface-3` | `line-strong` and `shadow-overlay` |

`shadow-overlay` is the one shadow, for menus, sheets, dialogs and toasts. `glow-live` and `glow-urgent` are the two glows and go on a 6px dot or the head of the trace, nothing larger.

## Motion

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 120ms | Hover, press, focus |
| `duration-state` | 200ms | Selection, a row changing severity |
| `duration-tick` | 240ms | A reading changing: the new digits rise 28% of their height into place |
| `duration-enter` | 360ms | Sheets and menus, a new flag arriving |
| `ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | The only curve |

- Animate colour, background, border, opacity and transform, and name them. Never `transition: all`, never width, height or margins.
- Press is `scale(0.98)` on a button. Hover never moves anything.
- The live trace is the one thing that moves on its own, and it stops when the sitting ends or the tab is hidden.
- With reduced motion, remove transitions and the tick, and draw the trace as a still line.

## Components

The parts are the ones the product already has, redrawn. Each component README has the detail.

- **Button.** Primary is `signal-strong` with `on-signal` text and goes white on hover: the accent stays out of large coloured fills so red never competes with a button. Secondary is `surface-3` with a `line-strong` border, `surface-4` on hover. Quiet is `ink-muted` text that gains `surface-3` on hover. Danger is `urgent` text in an `urgent-line-strong` border. Label at `label`. Disabled is 40% opacity.
- **Field.** Label above in `caption`, `ink-muted`. The well is `surface-0` with a `line-strong` border, `line-hover` under the pointer, ice border and halo on focus, `urgent` border with the message below on error.
- **Segmented.** A `surface-0` well with a `line` border and 2px padding. The selected segment is `surface-3` with a 1px `line-strong` highlight along its top edge.
- **StatusBadge.** A 22px chip at `radius-sm` with a 6px dot and a word, in the severity colours above.
- **ScoreChip.** A 22px square at `radius-sm` with the digit.
- **Readout.** Label in `caption`, the value in a mono readout style with the unit beside it in `ink-muted`, and one line of meta in `ink-faint`. Live values are `signal-strong`. No reading is words in `ink-muted`, never a dash or a faded number.
- **SideNav.** `surface-0`, 30px rows. Hover is `surface-2`. The current item is `surface-3` with a 1px `line` highlight along its top edge and its icon in `signal`. Counts are plain `ink-faint` numbers; a count of urgent patients is `urgent`.
- **WorklistTable.** No outline and no header fill. Column heads in `caption`, `ink-faint`. Rows are 44px with a `line` divider and `surface-2` on hover. An urgent row sits on `urgent-soft` with a 2px `urgent` inset on its leading edge and its name and readings in `ink-bright`. A watch row has a 2px `watch` inset only. Stable rows drop the name to regular weight, so one row carries the colour.
- **Card.** `surface-2`, `line` outline, `radius-lg`, `space-4` padding. Title at `label`, text at `dense` in `ink-muted`.
- **HandoffNote.** `urgent-soft` with an `urgent-line` outline for an urgent flag. A flat fill, on both platforms.
- **Live trace.** A 1.5px `series-estimate` line on a canvas with `glow-live` at its head. It is the signature of the product and appears only where a camera is reading: the check-in screen and the landing hero.

## Iconography

- One set, line icons at 1.5 stroke in the colour of the text beside them. 16px in the dashboard, 20px on the phone.
- The icon box has the same width in every row and a fixed gap to its label (8px, or 10px in navigation), so labels align.
- No emoji, no filled icons, no icon with its own colour. A status that needs colour gets a 6px dot.
- The mark is the pulse trace in `signal`, flat, beside the name "Triage Cam" at weight 500.

## Voice and copy

- Plain, exact and short. Write what was measured and when: "Pulse up 26 bpm and breathing up 8 breaths/min over 1 h 48 min".
- Sentence case everywhere. No exclamation marks, no emoji, no hype words.
- A label, button, caption or other single-sentence string has no full stop.
- A button names the action and the result keeps the word: Acknowledge becomes Acknowledged.
- A change says what it compares to: "+8 from 18 at check-in".
- Units are always shown: "bpm", "breaths/min", "min ago".
- Claims follow the project rules: no blood oxygen, blood pressure or diagnosis, not a cleared device, and every accuracy figure comes from `eval/` output or a cited source. The research-prototype notice appears once per app, at sign-in.

## Building the mobile roles

- Both device appearances render Night Shift. `useTheme()` returns the same theme whatever the system setting is.
- Treat px as points. Take every colour, size, radius and type value from the generated `tokens.ts`.
- Hairlines use `StyleSheet.hairlineWidth` with `line`. The translucent lines and soft fills work over the stepped surfaces as they do on the web.
- `shadow.shadowOverlay` is a `boxShadow` string for sheets and the push banner. The two glows are `boxShadow` strings for a dot.
- The tab bar is the system one and takes a tint; its material is drawn by iOS and will not match the mockup exactly.
- The live trace on the phone is built with what is already installed. No new native dependency.

## Accessibility

- Text meets 4.5:1 on the surface it is specified for; control borders, focus rings and icons meet 3:1 against their surroundings or are paired with a fill change.
- No state is told by hue alone: each has a word, and a shape or lightness that differs.
- Every interactive element is reachable by keyboard and shows the focus ring.
- Layouts hold at the largest text size on the phone and at a narrow window on the web.
