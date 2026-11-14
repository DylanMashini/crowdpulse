# Button

One action, named by what it does. Provide `variant` (`primary`, `secondary`, `quiet`, `danger`), `size` (`md` on the dashboard, `touch` in the mobile roles), an optional `icon` name and the label as children.

- One `primary` per screen: Start sitting, Acknowledge, Save rules.
- `secondary` is the default. Two choices of equal weight (the consent sheet) are both `secondary`.
- `danger` only deletes data, and the label says what is deleted: "Delete face data".
- Label is a verb phrase in sentence case, and the result uses the same word: Acknowledge becomes Acknowledged.
- Never `md` on a phone; touch targets are `control-touch` (48px) or taller.
