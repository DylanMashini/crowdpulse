# HandoffNote

The sentence a nurse reads before walking over: measured data first, an optional AI draft underneath. Provide the templated data sentence as children, plus `draft` text or a `draftState` (`ready`, `withheld`, `unavailable`).

- The data sentence comes from a fixed template and is complete without the draft.
- The draft is always under a dashed rule with the AI draft tag, and only suggests reassessment ("Consider a full set of observations"). No diagnosis, no treatment, no triage level.
- `withheld` when the latest reading is stale, low quality or from a low-confidence face match. `unavailable` when the service cannot be reached.
- For an urgent flag the note is `urgent-soft` with an `urgent-line` outline at `radius-lg`, its heading in `urgent` at `caption` and the sentence in `ink` at `dense`. For a watch flag it is `surface-2` with a `line` outline and a `watch` heading. A flat fill, no gradient.
