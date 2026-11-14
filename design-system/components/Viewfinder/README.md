# Viewfinder

The camera role's framing view: outlines of what is measured, never the picture. Provide `state` (`searching`, `locking`, `measuring`, `lost`) and optionally your own message as children.

- Draws the framing corners, the forehead and cheek regions and the chest region as outlines on `surface-0`. It does not render camera frames.
- The message tells the patient what to do next, in one sentence at `body-touch` size.
- `lost` says "No reading" and why. The reading blanks at the same moment.
- `radius-lg` with a `line` outline, which becomes `signal-line` while a sitting is measuring. The timer sits on `scrim` at `radius-sm`.
