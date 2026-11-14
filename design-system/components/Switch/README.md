# Switch

A setting that is on or off and takes effect at once. Provide `label`, `checked`, `onChange(next)` and an optional `hint` that says what changes.

- The track prints On or Off, so the state never rests on colour or thumb position alone.
- Use it for flag settings and capture options. A choice that needs a confirm step (face match consent) is a ConsentSheet, not a switch.
- Privacy-reducing settings default to off.
- Off is a `surface-0` track with a `line-strong` border and an `ink-muted` thumb. On is `signal-strong` with an `on-signal` thumb and word. The thumb moves over `duration-fast`.
- On the phone the track carries no word and is quieter (QA finding NS-IOS-09): on is a `signal-soft` track with a `signal-line` border and a `signal-strong` thumb at the right; off is unchanged with the thumb at the left. The state is the thumb's place as well as its colour.
