# PatientTile

One ticket as a tile, for the wall view of the waiting room. Provide `ticket`, `state`, `minutes`, `pulse` and `breathing` as `{base, now}`, `score` and `source`.

- The tile is `surface-2` with a `line` outline at `radius-lg`. The state is carried by its StatusBadge and by the surface: `urgent-soft` with an `urgent-line` outline for urgent, a `watch` 2px leading edge for watch, a dashed `line-strong` outline for no reading.
- Lay tiles out in rank order, left to right. Do not group them by state.
- Use WorklistTable when the nurse needs to compare values; tiles are for a glance from across the room.
