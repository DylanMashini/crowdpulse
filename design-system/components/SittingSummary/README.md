# SittingSummary

The result of one sitting: ticket, each measurement and its coverage. Provide `ticket` and `items`, each with `label`, `icon`, `value`, `unit`, `coverage`, `threshold`, and `experimental` or `reason` where they apply; `theme="dark"` on the camera phone.

- A measurement that did not pass its quality threshold shows No reading with the reason, beside the ones that did.
- Variability appears only with `experimental: true`.
- Children go under the grid: the next action (Start re-check) or a PrivacyNote.
