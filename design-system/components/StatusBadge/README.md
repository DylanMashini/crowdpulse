# StatusBadge

The state of one ticket: every tile and row carries exactly one. Provide `state` (`observed`, `flag`, `overdue`, `no-reading`) and `minutes` since the last valid reading.

- There is no normal state and no green badge. `observed` is a cool grey, because unflagged is not the same as well.
- A 22px chip at `radius-sm`, never a pill: a 6px dot and a word at `caption`, weight 500.
- `observed` is `stable` on `stable-soft`. `flag` takes its severity: `watch` on `watch-soft` for a baseline shift, `on-urgent` on solid `urgent` for a rising score, whose dot may carry `glow-urgent`. `overdue` is `on-overdue` on `overdue`, the inverse of the page. `no-reading` is `ink-muted` in a dashed `line-strong` outline.
- Each differs by fill and lightness as well as hue, and always carries its word.
- `no-reading` ranks with `overdue` in a worklist.
- Do not restyle or rename the states, and do not add a fifth.
