# QualityMeter

Coverage or signal quality as a share of the sitting. Provide `value` (0 to 1), `label` (default "Coverage") and an optional `threshold`.

- Always prints the percentage; below the threshold the fill becomes striped and the text says "below threshold".
- Pair it with a Readout. A value with low coverage is shown as No reading, not as a faint number.
