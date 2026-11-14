# Readout

One measured value with its unit, source and age. Provide `label`, `value`, `unit`, `size` (`xl` at check-in, `lg` in tiles and summaries, `md` in dense views), `state` (`valid`, `settling`, `none`, `stale`), and optionally `icon`, `age`, `reason` and `tag`.

- `none` prints the words "No reading" and the reason. Never show a dash, a zero or the last value in its place.
- `stale` strikes the old number and says how old it is. Blank it entirely once the freshness timer runs out.
- Units are written out: "bpm", "breaths per min", "ms".
- Variability always takes `tag="experimental"` and no interpretation of stress or pain.
- Label in `caption`, `ink-muted`. The value is `readout-xl` on the camera phone, `readout-lg` for a live reading on the dashboard and `readout-md` in detail and summaries, with the unit beside it at `dense` in `ink-muted` and one line of meta in `caption`, `ink-faint`.
- A live value is `signal-strong`; a settled one is `ink`; a value behind an urgent flag is `urgent`. `none` is the words in `ink-muted` at `heading` size, with no outline.
- When a live value changes, the new digits rise into place over `duration-tick` (`animate-tick` on the web). Nothing counts up.
