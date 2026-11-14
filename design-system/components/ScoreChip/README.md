# ScoreChip

The partial NEWS2 score for the two parameters the camera measures. Provide `score` (0 to 3), `measured` (default 2) and `caption={false}` to drop the caption inside a table that already has a "Partial score" header.

- The caption "2 of 7 parameters" stays wherever the chip appears outside that table. This is never a full NEWS2 score.
- The digit carries the value; the fill is a single amber ramp from light to dark, with score 3 in `critical`.
- Do not sum, average or colour anything else with the score tokens.
