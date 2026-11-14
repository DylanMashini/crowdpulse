# WorklistTable

The ranked waiting-room worklist: who to walk to first. Provide `rows` already in rank order, each with `ticket`, `state`, `minutes`, `pulse` and `breathing` as `{base, now}`, `score`, and `source`; plus `selected` and `onSelect(ticket)`.

- Rank comes from the server. The table does not sort, and has no column sorting.
- Each value shows now, the check-in baseline and the difference, because the trend is against the patient's own baseline.
- A row with no reading says "No reading" in words and is not scored.
- Recorded rows always show the Recording tag in the Source column.
