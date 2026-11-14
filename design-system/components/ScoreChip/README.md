# ScoreChip

The partial NEWS2 score for the two parameters the camera measures. Provide `score` (0 to 3), `measured` (default 2) and `caption={false}` to drop the caption inside a table that already has a "Partial score" header.

- The caption "2 of 7 parameters" stays wherever the chip appears outside that table. This is never a full NEWS2 score.
- A 22px square at `radius-sm`, the digit at 12px, weight 500, tabular.
- The digit carries the value. Fill and digit are `score-0` to `score-3` with `on-score-0` to `on-score-3`: grey, two strengths of amber tint, then solid `urgent`. Only 3 is solid.
- Do not sum, average or colour anything else with the score tokens.
