# Viewfinder

The camera role's framing view: outlines of what is measured, never the picture. Provide `state` (`searching`, `locking`, `measuring`, `lost`) and optionally your own message as children.

- Draws the framing corners, the forehead and cheek regions and the chest region as outlines on `surface-sunken`. It does not render camera frames.
- The message tells the patient what to do next, in one sentence at `body-touch` size.
- `lost` says "No reading" and why. The reading blanks at the same moment.
- Always dark, whatever theme the rest of the app uses.
