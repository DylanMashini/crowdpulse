# SittingTimer

Progress through the 60-second sitting, split into its three phases. Provide `elapsed` in seconds, and optionally `total` and `phases` (`until`, `label`).

- Segments are sized by duration: settle to 5 s, heart rate to 20 s, breathing and beats to 60 s.
- Counts down in whole seconds and names the current phase. No circular progress, no pulsing.
- At the end it reads "Done" and "Baseline saved".
- The time is `readout-sm` or larger in the mono face. The progress line is 2px, `signal` on a `line-strong` track.
