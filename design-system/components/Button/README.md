# Button

One action, named by what it does. Provide `variant` (`primary`, `secondary`, `quiet`, `danger`), `size` (`md` on the dashboard, `touch` in the mobile roles), an optional `icon` name and the label as children.

- One `primary` per screen: Start sitting, Acknowledge, Save rules.
- `secondary` is the default. Two choices of equal weight (the consent sheet) are both `secondary`.
- `danger` only deletes data, and the label says what is deleted: "Delete face data".
- Label is a verb phrase in sentence case, and the result uses the same word: Acknowledge becomes Acknowledged.
- Never `md` on a phone; touch targets are `control-touch` (48px) or taller.
- `primary` is `signal-strong` with `on-signal` text and turns `ink-bright` on hover. The accent is not a large coloured fill, so red never competes with a button.
- `secondary` is `surface-3` with a `line-strong` border, `surface-4` on hover. `quiet` is `ink-muted` text that gains `surface-3` and `ink` on hover. `danger` is `urgent` text in an `urgent-line-strong` border, `urgent-soft` on hover.
- `md` is `control-md` (32px) with the label at `label`; the web's large size is `control-lg` (40px) with `body-strong`.
- Press is `scale(0.98)` over `duration-fast`. Disabled is 40% opacity. Focus is the standard ring.
