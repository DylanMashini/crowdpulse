# QualityMeter

Coverage or signal quality as a share of the sitting. Provide `value` (0 to 1), `label` (default "Coverage") and an optional `threshold`.

- Always prints the percentage; below the threshold the fill and the percentage turn `watch` and the text says "below threshold".
- Pair it with a Readout. A value with low coverage is shown as No reading, not as a faint number.
- The track is `surface-4`, 6px tall at `radius-sm`; the fill is `signal`. On the viewfinder, signal quality is four 3px bars of rising height instead.
