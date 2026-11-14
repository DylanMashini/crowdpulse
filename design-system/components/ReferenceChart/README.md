# ReferenceChart

Camera estimate against the reference device over one sitting, with the running error. Provide `estimate` and `reference` as arrays with one value per second (`null` where there was no reading), and optionally `referenceName`, `title`, `width` and `height`.

- One y axis in bpm. Breathing gets its own chart; never add a second scale.
- The estimate is a solid `series-estimate` line and the reference a dashed `series-reference` line, so they differ by dash and lightness, with a legend and end labels.
- Gaps stay gaps. Do not interpolate across seconds without a reading.
- Hover shows both values for that second; "Show table" gives the same data as rows.
