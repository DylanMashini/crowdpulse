# WorklistCard

One ticket in the nurse role's worklist on a phone. Provide `rank`, `ticket`, `state`, `minutes`, `pulse` and `breathing` as `{base, now}`, optional `source`, and `onPress`.

- The whole card is one touch target, at least 88px tall, and opens the ticket timeline.
- Same order, same states and same wording as WorklistTable on the dashboard.
- No swipe actions. Acknowledge lives on the PushBanner and the ticket screen.
- A `surface-2` card with a `line` outline at `radius-xl` and `space-4` padding. Urgent is `urgent-soft` with an `urgent-line` outline; watch keeps the plain card and a `watch` chip. Values are `readout-md`, units `caption` in `ink-muted`.
