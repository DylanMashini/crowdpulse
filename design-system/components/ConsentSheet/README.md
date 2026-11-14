# ConsentSheet

The opt-in for face match at check-in, as a bottom sheet. Provide `ticket`, `onAccept`, `onDecline` and optionally `title`.

- Both buttons are `secondary` and the same size, with the ticket-number option first. Neither is styled as the default.
- States three facts: what it is used for, when it is deleted, and that the ticket number always works.
- Never pre-accepted, never shown a second time after a decline in the same visit.
- The sheet is an overlay: `surface-3`, `line-strong` outline, `radius-xl` on its top corners and `shadow-overlay`, over `scrim`. It rises over `duration-enter`.
