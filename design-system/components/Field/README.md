# Field

A labelled input for one value, usually a threshold. Provide `label`, the input props (`value`, `onChange`, `type`, `inputMode`), and optionally `unit`, `hint`, `error`, and `size="touch"` on a phone.

- The label is always visible; no placeholder-only fields.
- Put the unit in `unit` ("bpm", "min", "per min"), never in the label.
- `error` says what is wrong and what range is allowed: "Enter 5 to 60 minutes".
