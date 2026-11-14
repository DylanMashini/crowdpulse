Triage Cam is a contact-free vitals station and a waiting-room worklist. One system covers three surfaces: the desktop web dashboard, the nurse role of the mobile app and the camera role of the mobile app. It is a research prototype, and the interface says so.

## Principles

- **A number never travels alone.** Every value shows its unit, its age and where it came from. Use `Readout` with `age`, and `ProvenanceTag` for anything that is recorded, experimental, from the reference device or written by a model.
- **Say "No reading".** When quality is low, print the words and the reason. Never a dash, a zero, a faded number or the last good value.
- **There is no normal.** A ticket is observed, flagged, overdue or without a reading. Nothing is green for healthy, and `signal` is never used as a status.
- **Ticket numbers only.** `TicketNumber` is the one identifier on every screen, tooltip and notification. No names, initials, ages or visit reasons.
- **Outlines, not pictures.** The camera role draws regions on a dark field. No surface shows a face or a video frame.
- **Quiet chrome.** Colour belongs to state and to the live estimate line. Navigation, panels and tables stay in the neutrals.

## Voice and copy

- Plain, exact and short. Write what was measured and when: "Pulse 82 at check-in, 108 now (26 min later)".
- Sentence case everywhere, including table headers and badges. No all caps, no exclamation marks, no emoji.
- A label, button, caption or other single-sentence string has no full stop. A string of two or more sentences keeps them.
- Buttons name the action and the result keeps the word: Acknowledge becomes Acknowledged.
- Write units out: "bpm", "breaths per min", "min ago". Write ranges with "to": "16 to 24".
- Say this: "research prototype, not validated for clinical use", "flags a posture change for a person to check", "a draft for the nurse". Not this: "detects deterioration", "decision support", "private by design", "never guesses".
- Address the patient as "you" on the camera phone. Address nobody on the dashboard.

## Colour

- Page on `surface`; panels, rows, tiles and sheets on `surface-raised` with a 1px `line` outline; headers, tracks and the viewfinder field on `surface-sunken`.
- Text is `ink`; units, ages and captions are `ink-muted`. Those two are the only text colours outside a status.
- `signal` is the single accent: the primary button, the selected nav item, progress and the camera estimate line. Text on it is `on-signal`.
- Status is carried by form as well as colour. Trend flag: `flag` on `flag-soft` with the flag icon. Overdue: `on-overdue` on `overdue`, the inverse of the page. No reading: a dashed `line-strong` outline. Observed: plain `ink-muted` text.
- The partial score uses `score-0` to `score-3`, one amber ramp that darkens with the score, and always prints the digit.
- `critical` is for score 3 and for deleting data. It is not an alert colour for flags.
- On the reference chart the estimate is solid `series-estimate` and the reference dashed `series-reference`.
- Keyboard focus is a 2px solid `focus` outline with a 2px offset, on every interactive element.
- Two themes, `light` and `dark`. The dashboard and nurse role follow the device setting. The camera role is always dark: wrap it in `data-theme="dark"`.
- No gradients between hues, no glows, no tinted shadows.

## Type

- One family for the interface, Atkinson Hyperlegible Next (`font-sans`), chosen because ticket numbers and vitals are read at a distance and its digits and letters are hard to confuse.
- Atkinson Hyperlegible Mono (`font-mono`) only for numerals that change or sit in columns: the `readout-xl`, `readout-lg` and `readout-md` styles, ticket numbers, ranks and clock times.
- One `title` per screen. `heading` for panels and sheets, `subheading` inside them.
- `body` on the dashboard; `body-touch` in both mobile roles and for anything a patient reads.
- `label` for badges, tags, table headers and field labels; `caption` for units, ages and helper text.
- Weights are 400, 500 and 600. Hierarchy comes from size and from `ink` against `ink-muted`.
- Set changing numbers with tabular figures.

## Space, shape and depth

- Spacing steps are `space-1` (4px) to `space-8` (64px). Panel padding is `space-4` on web; the screen gutter on mobile is `space-4`; the dashboard page gutter is `space-6`.
- Web controls are `control-md` (36px) tall. Every touch target in the mobile roles is `control-touch` (48px) or taller.
- `radius-sm` for chips and tags, `radius-md` for controls, `radius-lg` for panels, tiles and tables, `radius-xl` for mobile sheets, banners and cards. `radius-pill` is reserved for `StatusBadge` and `Switch`.
- Panels have a `line` outline and no shadow. `shadow-overlay` is only for things that float: sheets, the push banner and chart tooltips.
- A 2px outline in the state's colour marks a flagged or overdue tile or card. Do not add a coloured stripe on one edge.

## Motion

- Feedback only: a 120ms ease-out on the switch thumb and on hover colour. Nothing loops, pulses or animates on load.
- A live number changes in place. Do not tween or count up a vital sign.
- Respect reduced motion by removing transitions.

## Iconography

- Use `Icon`: 21 line glyphs on a 24px grid at 1.5 stroke, in the colour of the text beside them. Sizes are 16, 18 or 20.
- Status and provenance marks always pair the icon with its word.
- The mark is the pulse trace on a `signal` tile, the same as the favicon, flat and in one colour. Beside it the name "Triage Cam" is set in `font-sans` at weight 600. On the web it is `BrandLockup`.

## The three surfaces

- **Web dashboard** (desktop, Next.js and React). `SideNav` at `nav-width` on the left, content fluid beside it. Check-in uses `Readout` at `xl` beside `ReferenceChart`. Waiting room uses `WorklistTable`, or `PatientTile` for a wall view. A ticket page uses `TicketTimeline` and `HandoffNote`. Flag settings use `Field` and `Switch`.
- **Nurse role** (phone, React Native). `RolePicker` at launch, a list of `WorklistCard` in rank order, `PushBanner` for a flag with Acknowledge, then the same `TicketTimeline` and `HandoffNote`.
- **Camera role** (phone on the mount, React Native over a Swift capture module). `ConsentSheet` at check-in, then `Viewfinder`, `SittingTimer` and `CaptureStatus` during the sitting, and `SittingSummary` at the end. Always dark.

## Building the mobile roles

- The components here are React for the web and are the reference for the React Native screens. Match their structure, states and copy; take every colour, size, radius and type value from `tokens.json`.
- Treat px as points. Load both families as app fonts and map weights 400, 500 and 600.
- `shadow-overlay` becomes the platform's elevation for sheets and banners only.
- System push notifications carry the same text as `PushBanner`: the title "Trend flag, ticket 14" and the templated handoff sentence.

## Accessibility

- Every text and status pair in both themes meets 4.5:1; control borders, focus rings and icons meet 3:1. Each colour token's usage note names the surfaces it was checked on.
- No state is told by hue alone: each has a word, an icon or outline style, and a different lightness.
- `ReferenceChart` offers the same data as a table.
