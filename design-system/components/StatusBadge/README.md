# StatusBadge

The state of one ticket: every tile and row carries exactly one. Provide `state` (`observed`, `flag`, `overdue`, `no-reading`) and `minutes` since the last valid reading.

- There is no normal state and no green badge. `observed` is plain text with its age.
- `flag` is amber with the flag icon; `overdue` is the inverse of the page; `no-reading` is a dashed outline. Each differs by shape and lightness as well as hue.
- `no-reading` ranks with `overdue` in a worklist.
- Do not restyle or rename the states, and do not add a fifth.
