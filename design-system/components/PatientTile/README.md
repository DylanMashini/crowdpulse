# PatientTile

One ticket as a tile, for the wall view of the waiting room. Provide `ticket`, `state`, `minutes`, `pulse` and `breathing` as `{base, now}`, `score` and `source`.

- The outline carries the state: amber and 2px for a flag, ink and 2px for overdue, dashed for no reading.
- Lay tiles out in rank order, left to right. Do not group them by state.
- Use WorklistTable when the nurse needs to compare values; tiles are for a glance from across the room.
