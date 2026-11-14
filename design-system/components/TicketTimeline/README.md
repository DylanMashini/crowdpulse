# TicketTimeline

Every observation for one ticket since check-in, oldest first. Provide `items`, each with `time`, `title`, and optionally `pulse`, `breathing`, `score`, `state`, `source` and `note`.

- Include the sittings that failed: a No reading entry is part of the record.
- Flag and acknowledge events are entries too, with who acknowledged in `note` by role ("Acknowledged on the nurse phone"), not by name.
- Times are clock times in 24-hour form; ages belong on the worklist.
- Times are `readout-sm` in `ink-faint`. A flag entry's mark takes its severity colour; other marks are `line-strong`.
