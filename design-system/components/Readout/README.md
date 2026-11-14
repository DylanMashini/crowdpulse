# Readout

One measured value with its unit, source and age. Provide `label`, `value`, `unit`, `size` (`xl` at check-in, `lg` in tiles and summaries, `md` in dense views), `state` (`valid`, `settling`, `none`, `stale`), and optionally `icon`, `age`, `reason` and `tag`.

- `none` prints the words "No reading" and the reason. Never show a dash, a zero or the last value in its place.
- `stale` strikes the old number and says how old it is. Blank it entirely once the freshness timer runs out.
- Units are written out: "bpm", "breaths per min", "ms".
- Variability always takes `tag="experimental"` and no interpretation of stress or pain.
