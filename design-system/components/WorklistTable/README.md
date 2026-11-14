# WorklistTable

The ranked waiting-room worklist: who to walk to first. Provide `rows` already in rank order, each with `ticket`, `state`, `minutes`, `pulse` and `breathing` as `{base, now}`, `score`, and `source`; plus `selected` and `onSelect(ticket)`.

- Rank comes from the server. The table does not sort, and has no column sorting.
- Each value shows now, the check-in baseline and the difference, because the trend is against the patient's own baseline.
- A row with no reading says "No reading" in words and is not scored.
- Recorded rows always show the Recording tag in the Source column.
- No outline and no header fill. Column heads are `caption` in `ink-faint` over a `line`. Rows are `row` (44px) with a `line` divider; hover is `surface-2` over `duration-fast`.
- An urgent row is `urgent-soft` (`urgent-soft-hover` under the pointer) with a 2px `urgent` inset on its leading edge and its name and readings in `ink-bright`. A watch row has a 2px `watch` inset only. Stable rows set the name at regular weight.
- Readings are `readout-sm`. The change from check-in sits in its own slot beside each reading, in `watch` or `urgent` when it drives a flag and `ink-faint` otherwise, so digits stay aligned whether or not there is a change.
