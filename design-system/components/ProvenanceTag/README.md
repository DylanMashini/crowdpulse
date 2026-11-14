# ProvenanceTag

Says where a number or sentence came from. Provide `kind`: `live`, `recording`, `experimental`, `ai-draft` or `reference`.

- Every replayed tile carries `recording` for as long as it is on screen.
- Heart-rate variability and the fixed-seat camera always carry `experimental`.
- Any sentence written by a model carries `ai-draft`, placed before the text.
- `reference` marks values from the chest strap or oximeter.
- Tags are outlined in `line-strong` with `ink-muted` text and no dot, so they are never mistaken for a StatusBadge. `live` is the exception: `signal` on `signal-soft` with a 6px dot that carries `glow-live` while a camera is reading.
