# Readout

One measured value with its unit, source and age. Provide `label`, `value`, `unit`, `size` (`xl` at check-in, `lg` in tiles and summaries, `md` in dense views), `state` (`valid`, `settling`, `none`, `stale`, `held`), and optionally `icon`, `age`, `reason`, `heldAge` and `tag`.

- `none` prints the words "No reading" and the reason. Never show a dash, a zero or the last value in its place.
- `stale` strikes the old number and says how old it is. Blank it entirely once the freshness timer runs out.
- `held` is the one case where the last value stays: during a sitting, once a vital has had a value, its box keeps the latest one for the rest of the run when the readings after it carry none. The number is `ink`, not the live `signal-strong`, and does not tick. With no fresh reading for three seconds its age goes in the corner of the box in `caption`, `ink-faint`, tabular figures ("8 s ago"); no label while fresh. The line of meta says why there is no fresh reading. Heart rate and breathing rate hold independently, and a new sitting starts empty.
- Units are written out: "bpm", "breaths per min", "ms". In a half-width cell on a phone, under a label that already says Breathing, the unit is "per min" and the full words are kept for the screen reader.
- Variability always takes `tag="experimental"` and no interpretation of stress or pain.
- Label in `caption`, `ink-muted`. The value is `readout-xl` on the camera phone, `readout-lg` for a live reading on the dashboard and `readout-md` in detail and summaries, with the unit beside it at `dense` in `ink-muted` and one line of meta in `caption`, `ink-faint`.
- A live value is `signal-strong`; a settled one is `ink`; a value behind an urgent flag is `urgent`. `none` is the words in `ink-muted` at `heading` size, with no outline.
- When a live value changes, the new digits rise into place over `duration-tick` (`animate-tick` on the web). Nothing counts up.
