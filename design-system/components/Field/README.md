# Field

A labelled input for one value, usually a threshold. Provide `label`, the input props (`value`, `onChange`, `type`, `inputMode`), and optionally `unit`, `hint`, `error`, and `size="touch"` on a phone.

- The label is always visible; no placeholder-only fields.
- Put the unit in `unit` ("bpm", "min", "per min"), never in the label.
- `error` says what is wrong and what range is allowed: "Enter 5 to 60 minutes".
- The label is `caption` in `ink-muted`, 6px above the well. The well is `surface-0` with a `line-strong` border at `radius-md`, `control-md` tall on the web.
- Hover is `line-hover`. Focus is a `signal` border with a 3px `signal-soft` halo, in place of the outline ring. Error is an `urgent` border with the message below in `caption`, `urgent`.
- Placeholder, unit and hint are `ink-faint`.
