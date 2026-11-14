# Engine reliability: what changed and what it measured

14 November 2026. Branch `worktree-engine-reliability`, commits `05629db` to the head of the branch. "Before" is the engine at `a14e7ab` (the diagnosis commit; its readings are those of `85f4853`). The brief is `engine-no-reading-diagnosis.md` and `rppg-reliability.md` in this folder.

Every number is measured. Reproduce with `packages/signal-engine/Scripts/reliability.py` (its header lists the commands) and `eval/run_eval.py --rescore`. Parameters were chosen on the UBFC-rPPG tuning set, the owner's sitting and tuning-set negative controls. The held-out set and held-out controls were run once, after the last change to the engine, and nothing was changed afterwards.

This work has not been through QA. Nothing here was run on a phone.

## 1. Headline

| | Before | After |
|---|---|---|
| Owner's sitting `a88a50e1` | no heart rate; 49 of 60 s refused as motion | 101.5 bpm for the sitting; 3 of 60 s with a live reading. True rate unknown (no reference worn) |
| UBFC tuning set, 12 sittings with a sound reference: coverage | 62.5% | 68.4% |
| same: readings within 5 bpm / MAE | 95.5% / 2.02 bpm | 96.0% / 1.96 bpm |
| same: sittings ending with a heart rate | 11 of 12 | 12 of 12 |
| UBFC held-out set, 21 sittings: coverage | 59.8% | 62.2% |
| same: readings within 5 bpm / MAE | 88.9% / 2.51 bpm | 88.2% / 2.58 bpm |
| same: sittings ending with a heart rate (within 5 bpm of the mean reference) | 20 of 21 (17) | 20 of 21 (17) |
| Negative controls ending with a heart rate, tuning (588 sittings with no pulse) | 40 (6.8%) | 0 |
| same, held-out (636) | 25 (3.9%) | 1 (0.2%) |
| Control seconds with a live reading, tuning / held-out | 0.77% / 0.51% | 0.32% / 0.22% |

In words: the failure that lost the owner's sitting is fixed, and a synthetic sitting with the same pattern now reads correctly from start to finish (section 5). On public webcam data the gain is modest: 6 points of coverage on the tuning set and 2.4 on the held-out set, with held-out accuracy 0.7 points lower. The larger change is on the other side of the trade: the engine now gives a number for a sitting with no pulse far less often than it did.

The owner's sitting itself is a weak recording. It ends with a number, but a live reading shows for only three seconds of it. That is the signal, not a gate: see section 4 and what is open in section 9.

## 2. What changed, in the order it was done

Tuning set, the 12 sittings whose reference is sound (subjects 11, 18, 20 and 24 are left out: BUG-19, the oximeter line drops out and tops out at 127).

| Step | Commit | Coverage | Readings within 5 bpm | MAE (bpm) | Sittings with a heart rate | Owner's sitting |
|---|---|---|---|---|---|---|
| Before | `a14e7ab` | 62.5% | 95.5% | 2.02 | 11 of 12 | none, 0 valid s |
| 1. Motion is a jump in colour balance, cut out of the window; chest speed counts only while the chest is tracked | `05629db` | 68.3% | 95.5% | 2.07 | 12 of 12 | 101.7 bpm, 6 valid s |
| 2. The newest 4 s of a window must hold the rhythm themselves | `fe366b9` | 66.5% | 95.9% | 1.99 | 12 of 12 | 101.5 bpm, 3 valid s |
| 3. Three agreeing windows among the newest five | `6332b7a` | 68.4% | 96.0% | 1.96 | 12 of 12 | 101.5 bpm, 3 valid s |
| 4. Whole-sitting estimate | `2ccf701` | unchanged | unchanged | unchanged | 12 of 12 | whole-sitting peak 103.0 bpm, accepted |
| 5. Fewer than ten readings need the whole-sitting estimate to agree | `4cda0f6` | unchanged | unchanged | unchanged | 12 of 12 | 101.5 bpm kept (103.0 agrees) |

**1. Motion** (`PulseTracker`, `ColourChangeDetector`, `PulseAnalyzer.project`). The old check flagged a frame whose brightness was 2% from a one-second average and refused any window with 5% of such frames. Brightness common to the three channels is exactly what the POS projection cancels, so the check refused what the maths was chosen to survive. It is replaced by a test of what does hurt the projection: a change in each channel's share of the region's brightness, between two neighbouring quarter-seconds. A change is a jump when it is over 4 times the window's own median change, never under 1.2% and always over 3%. The frames around a jump are cut out, each stretch between cuts is projected on its own (so no projection window straddles a cut and the level the colour settles at does not matter), and the window is refused as `motion` only when more than 30% of it is cut. Chest speed marks a frame only when the chest had a value in 90% of the frames of the last 2 s.

Measured against simply deleting the brightness check (no detector at all): coverage 69.5% and 95.0% within 5 bpm, against 68.3% and 95.5% with the detector at 1.2%. On this data the detector costs a point of coverage and buys half a point of accuracy; it is kept because without it a subject who is moving is no longer refused at all (the synthetic movement tests), and the diagnosis found the old check did hold back wrong answers on poor footage.

**2. Recency** (`PulseAnalyzer.recentQuality`). With brightness no longer refused, a rate could stay on screen after the pulse left the picture. The newest 4 s of each window must now score 0.4 at the reported frequency on their own. Measured on a person replaced by pulse-free skin of the same colour with no step: the old engine kept showing the rate for 5 to 7 s, this one for 2 to 3 s. With a 10% brightness step (a hand over the face) the old engine stopped within 2 s, because it refused the step as motion; this one can take up to 4 s. That is a regression in that one case and an improvement in the other, and the test `faceCoveredButTrackerStillReportsFace` was loosened from 2 s to 4 s to match. Cost: 1.8 points of tuning coverage.

**3. Agreement** (`AgreementGate`). Three of the newest five windows, the newest among them, all within 5 bpm of each other. One refused window no longer costs the two readings after it. Two agreeing windows was measured and not taken: 71.5% coverage but 94.8% within 5 bpm.

**4. Whole-sitting estimate** (`WholeSittingEstimate.swift`). At `finish()`, the spectra of every full-length window are added up, each region summed on its own and weighted by the square of its own summed peak's quality. The estimate is accepted when all of these hold: at least 15 windows; the summed peak is at 55 bpm or more; it holds 20% of the band's power above that floor; it stands 1.8 times above the stronger of the two neighbouring intervals (prominence); 45% of the windows have their own strongest peak within 5 bpm of it; and those windows come from at least 4 separate ten-second stretches. It fills `summary.heartRate` only when the readings gave none. It never feeds a one-second reading (a test compares the readings with it on and off).

The 55 bpm floor is there because slow change in the picture, after the projection's own sliding normalisation, piles up at the bottom of the pulse band in every window alike. "The same peak all through the sitting" is evidence of a pulse above that region and is what noise looks like inside it. A slow heart still gets its one-second readings.

**5. Corroboration** (`SignalEngine.finish`). The sitting's heart rate used to be the median of as few as three valid readings. Three agreeing windows are what noise gives now and then: of the 13 controls that still ended with a heart rate after step 3, all had 3 to 9 valid seconds. With fewer than ten valid readings, their median now stands for the sitting only when the whole-sitting estimate was accepted and is within 5 bpm of it. No tuning sitting has fewer than 18 valid readings, so nothing changed there.

Also in the range: `engine-cli synth --harmonic` (`66bee9d`), a merge of `main` for the A1 harness and split (`d985787`, one conflict in `ReferenceComparison.init`, both sides kept), and the mobile change in section 8.

## 3. UBFC-rPPG, before and after

One-second readings paired with the oximeter rate nearest in time (within 1.5 s). A sitting's heart rate is compared with the mean reference over the whole recording.

| Set | Engine | Seconds | Coverage | MAE (bpm) | Within 5 bpm | Sittings with a heart rate | Within 5 bpm of the mean reference | Further off |
|---|---|---|---|---|---|---|---|---|
| Tuning, 16 sittings | before | 1082 | 61.6% | 10.55 | 87.6% | 15 | 10 | 5 |
| Tuning, 16 sittings | after | 1082 | 69.3% | 12.21 | 86.9% | 16 | 11 | 5 |
| Tuning without the four faulty references, 12 | before | 810 | 62.5% | 2.02 | 95.5% | 11 | 10 | 1 |
| Tuning without the four faulty references, 12 | after | 810 | 68.4% | 1.96 | 96.0% | 12 | 11 | 1 |
| Held-out, 21 sittings | before | 1345 | 59.8% | 2.51 | 88.9% | 20 | 17 | 3 |
| Held-out, 21 sittings | after | 1345 | 62.2% | 2.58 | 88.2% | 20 | 17 | 3 |

The tuning set's MAE with all 16 sittings is dominated by the four faulty references, and rises because the engine now reads more seconds of them.

The harness's own report, re-scored with the new engine (`eval/run_eval.py --rescore`, written to this worktree's `eval/out/report.md`):

| Set | Engine | Paired readings | MAE (bpm) | Bias (bpm) | Within 5 bpm | Coverage | Sitting-summary MAE (bpm) | Summaries within 5 bpm | Median time to first (s) |
|---|---|---|---|---|---|---|---|---|---|
| Held-out, 21 subjects | before | 804 | 2.5 | -1.0 | 89% | 60% | 2.0 | 95% (n=20) | 8 |
| Held-out, 21 subjects | after | 836 | 2.6 | -1.1 | 88% | 62% | 1.9 | 95% (n=20) | 8 |
| Tuning, 16 subjects | before | 667 | 10.5 | +7.7 | 88% | 62% | 12.7 | 73% (n=15) | 8 |
| Tuning, 16 subjects | after | 750 | 12.2 | +9.6 | 87% | 69% | 11.7 | 75% (n=16) | 8 |

(The harness holds each summary against the reference over the seconds that had a reading, which is why its "summaries within 5 bpm" is higher than the column in the table above it.) Held-out without the four subjects seen in earlier development: 17 subjects, 711 paired readings, MAE 2.4 bpm, bias -0.8 bpm, 90% within 5 bpm, coverage 63%.

The held-out sitting that ends with no heart rate, before and after, is subject14: 1 valid second before, 7 after, and the whole-sitting estimate is not accepted (3 supporting stretches; its peak, 68.0 bpm, is 12 bpm from the mean reference, so refusing was right).

## 4. The owner's sitting, second by second

Sitting `a88a50e1`, 60.1 s, 3604 frames, a real iPhone. No reference was worn, so this shows whether a number comes out and whether it is stable, not whether it is right.

Before: 5 s warming up, 49 s `motion`, 5 s `low_quality`, 1 s `awaiting_agreement`; no heart rate, summary reason `motion`.

After: 5 s warming up, 3 s valid, 32 s refused on quality, 11 s at the band edge, 5 s `motion`, 4 s awaiting agreement.

| Seconds | What the engine did | What the windows held |
|---|---|---|
| 1 to 5 | warming up | |
| 6 to 8 | quality 0.49 (limit 0.5), then two seconds waiting for agreement | 102.0 to 102.5 bpm |
| 9 to 11 | **valid: 101.7, 101.5, 101.4 bpm** | quality 0.63 |
| 12 to 14 | refused: the step at second 11 is cut out, and the newest 4 s no longer hold the rhythm by themselves (0.399, 0 and 0.13 against 0.4) | 101.8 to 103.4 bpm, quality 0.56 to 0.63 |
| 15 to 22 | quality 0.23 to 0.42; second 17 at the band edge | 103.9 bpm twice, then 44 to 45 bpm for six seconds |
| 23 to 33 | quality 0.21 to 0.51; three seconds halved to 25 to 30 bpm and refused at the band edge | 98 to 106 bpm in 7 of the 11 seconds; 72 bpm once |
| 34 to 40 | band edge, and `motion` at 38 and 39 (31% and 41% of the window cut around the two steps at 35 and 37) | 35 bpm (halved 71), 71 bpm, 24 to 26 bpm |
| 41 to 46 | quality 0.26 to 0.50; `motion` at 41, 44 and 46 (34% to 39% cut) | 104 to 107 bpm in all six seconds |
| 47 to 50 | band edge and quality | 43 to 45 bpm |
| 51 to 53 | quality 0.36, then two seconds waiting for agreement (quality 0.56 and 0.69) | 100.8 to 101.9 bpm |
| 54 to 60 | quality 0.22 to 0.31, one second at the band edge | 51, 24, 104, 104, 129, 129, 96 bpm |

Summary: heart rate **101.5 bpm**, from the readings (coverage 5%), kept because the whole-sitting estimate agrees. Whole-sitting estimate: peak **103.0 bpm**, quality 0.23, prominence 2.3, support 0.48 (22 of 46 windows), 5 supporting stretches, accepted. 31 of the 59 analysed seconds held a candidate between 98 and 108 bpm. Breathing: none (`no_chest`), as before; the chest was tracked in 116 of 3604 frames.

Two things to be plain about. First, the whole-sitting evidence for this sitting is close to its limits (prominence 2.3 against 1.8, support 0.48 against 0.45, quality 0.23 against 0.2), and those limits were set with this sitting in view. Among 588 tuning controls the nearest came to (prominence 2.2, support 0.38) and (1.7, 0.46); on 636 held-out controls one was accepted (section 6). Second, a live reading showed for three seconds only. In the quiet stretches the window quality sits between 0.2 and 0.5, under the 0.5 threshold, and lowering the threshold is not free (section 7). The recording has about three times the frame-to-frame colour noise of the UBFC webcam sittings (median change in colour balance over a quarter of a second: 0.46% against 0.12% to 0.40%), on a phone at 60 frames per second from uncompressed frames. That points at capture (region size at the mount distance, regions following the landmarks, tone mapping), not at the engine: see section 9.

## 5. The field-failure pattern, synthetic

`fieldFailurePattern()` in the test support reproduces what the diagnosis found, with nothing taken from the recording: a still person at 72 bpm whose regions settle at a new colour nine times in a minute (brightness by 3% to 13%, redness by 2% to 5%), and a chest found for 12 frames in every 40 between seconds 2 and 6, always at the tracker's search limit. Tests in `ReliabilityTests.swift` and `WholeSittingTests.swift`:

- at most 6 seconds are refused as motion (three steps within five seconds leave too little of a window), the chest marks nothing, and the median share of a window cut out is under 20%;
- the sitting ends within 2 bpm of the truth with at least 20 valid seconds, all within 3 bpm, and likewise at 50, 64, 88, 103 and 131 bpm;
- the same pattern with no pulse (noise, a wall) gives no reading and no sitting heart rate;
- with the pulse at under a third of its usual size the sitting still ends within 2 bpm.

## 6. Negative controls: false accepts

Sittings with no pulse in them, 60 s each, built by `reliability.py controls`:

- **shuffled**: each real sitting of the set (and the owner's, for tuning) with its frames in random order inside blocks of 0.7 to 1.6 s, three times each per repeat. The colours and their noise are the recording's; the rhythm is gone.
- **white noise** and **grey wall**: `engine-cli synth --subject noise|wall` at noise 0.25, 0.5, 1 and 2 counts, 30 and 60 frames per second.
- **wandering colour**: skin whose colour follows first-order autoregressive noise (memory 0.5 to 0.99 per frame, 0.2% to 1.5%), shared by the regions and each region's own, with and without eight steps to a new brightness and redness as in the field failure.

Four repeats with different random draws: 588 controls for the tuning set, 636 for the held-out set (different subjects for the shuffles, different seeds for everything).

**Tuning controls, 588**

| Control | Sittings | Seconds with a live reading, before | after | Sittings ending with a heart rate, before | after |
|---|---|---|---|---|---|
| Shuffled real sittings | 204 | 67 of 13704 (0.49%) | 20 (0.15%) | 11 (5.4%) | 0 |
| White noise | 96 | 22 of 5664 (0.39%) | 2 (0.04%) | 0 | 0 |
| Grey wall | 96 | 23 of 5664 (0.41%) | 7 (0.12%) | 3 (3.1%) | 0 |
| Wandering colour, no steps | 96 | 129 of 5664 (2.28%) | 43 (0.76%) | 21 (21.9%) | 0 |
| Wandering colour, with steps | 96 | 39 of 5664 (0.69%) | 44 (0.78%) | 5 (5.2%) | 0 |
| **All** | 588 | 280 of 36360 (0.77%) | 116 (0.32%) | **40 (6.8%)** | **0** |

**Held-out controls, 636, run once**

| | Before | After |
|---|---|---|
| Seconds with a live reading | 199 of 38796 (0.51%) | 86 (0.22%) |
| Sittings with any live reading | 102 | 44 |
| Sittings ending with a heart rate | 25 (3.9%) | **1 (0.2%)** |

The one held-out false accept is a shuffled copy of subject4, accepted by the whole-sitting estimate at 59.6 bpm with no live reading at all. One in 636 is a rate of 0.16%; with this few events the 95% upper bound is about 0.9%. It is at the bottom of the range the estimate is allowed to report, which is where the tuning controls came closest too.

Where the live path still lets noise through: wandering colour gives a valid second in 0.8% of seconds, almost always between 45 and 66 bpm. The projection's sliding normalisation is a high-pass at about 0.6 Hz, so slow wander comes out of it as a hump just above the bottom of the pulse band, narrow enough to pass the quality check now and then. Step 5 is what keeps those seconds from becoming a sitting's heart rate. They can still appear on screen for a second or two.

The engine's test suite carries a fixed sample of the same controls (16 white-noise and wall sittings, 48 wandering-colour sittings): none ends with a heart rate.

**Real sittings with noise added** (`reliability.py degrade`): white noise of the given size, in 8-bit counts, added to every colour of every frame. The pulse is still there, weaker. Sittings with a sound reference only.

| Set | Noise | Coverage before | after | Sittings with a heart rate before (right, wrong) | after (right, wrong) | From the whole-sitting estimate |
|---|---|---|---|---|---|---|
| Tuning, 12 | 0.5 | 19.0% | 15.8% | 8 (6, 2) | 6 (6, 0) | 1, right |
| Tuning, 12 | 1.0 | 2.6% | 1.7% | 3 (1, 2) | 1 (1, 0) | 1, right |
| Tuning, 12 | 1.5 | 1.1% | 0.6% | 1 (1, 0) | 0 | |
| Held-out, 21 | 0.5 | 15.8% | 13.1% | 14 (8, 6) | 9 (6, 3) | 1 |
| Held-out, 21 | 1.0 | 1.4% | 0.9% | 3 (2, 1) | 1 (0, 1) | 0 |
| Held-out, 21 | 1.5 and over | under 0.5% | under 0.2% | 0 | 0 | |

"Right" is within 5 bpm of the mean reference. A weak signal now more often ends with no number than with a wrong one: wrong sitting rates fall from 2 to 0 and from 6 to 3 at 0.5 counts, at the price of 2 and 2 right ones. The whole-sitting estimate rescues few of these: it is conservative by construction. An earlier draw of the held-out noise gave 14 (11, 3) before and 11 (9, 2) after at 0.5 counts, with 3 from the whole-sitting estimate of which 1 was wrong; the figures move by a few sittings from draw to draw.

## 7. Measured and not taken

| Change | Tuning coverage / within 5 bpm (12 sittings) | Controls | Why not |
|---|---|---|---|
| Quality threshold 0.45 | 70.2% / 95.6% | 0.62% of control seconds valid (0.32% at 0.5) | Twice the false readings for 1.8 points |
| Quality threshold 0.4 | 71.5% / 95.3% | 1.05% of control seconds; 1 control sitting | Three times the false readings |
| Quality threshold 0.55 | 66.2% / 96.3% | 0.16% | Kept 0.5 as the plan's number; this is the direction to go if false seconds matter more |
| Two agreeing windows | 71.5% / 94.8% | not run | Accuracy |
| A guard against peaks that are the slope of something below the band, under 70 bpm | 68.4% / 96.0% (no change) | 102 valid control seconds instead of 116; 12 control sittings instead of 13 (before step 5) | Too little for another rule that can refuse a true slow heart |
| POS window 2.4 s or 3.2 s instead of 1.6 s | 65.3% / 96.2%, 64.1% / 96.3% | 12 and 10 control sittings (before step 5) | Costs coverage, does not move the hump out of the band |
| Blanking bursts in the projected signal instead of cutting frames in the input | no change on 6 sittings in a prototype | | The projection already confines a step; what is left is ordinary noise |

Not attempted, with the reason:

- **A second extraction method (CHROM) beside POS** (research item 5). A numpy prototype on the owner's sitting found CHROM agreeing with POS on the forehead and finding 101 to 104 bpm on the cheeks where POS did not. One sitting with no reference is not a measurement of whether it earns its place, and there was no time to build it in the engine and run it over the sets. It is the first thing to try next for weak recordings.
- **A redefined quality score** (de Haan SNR with the second harmonic, research item 2). The existing score was instead calibrated as it stands, in the table above.
- **Bridging sub-second face or exposure dropouts** (research item 4). The capture module reports a lost face only after 0.5 s without a detection and then starts a new track id, and drops the exposure lock only after 1 s, so the engine never sees a dropout short enough to bridge. No UBFC sitting has one either. It needs a capture change first.
- **MCD-rPPG** was not re-run: no MCD sitting files are on disk in this checkout.

## 8. Wire contract, and what else was touched

**No wire change.** `summary.heartRate` is still `{ value, coverage }`. `value` may now be the whole-sitting estimate when the readings gave none, and may be withheld when fewer than ten readings stand alone; `coverage` is still the share of valid one-second readings, so a sitting can carry a value with a coverage near zero. Nothing on the server or the dashboard reads coverage to decide anything (`apps/web/src/server` stores it). `SittingSummary` gains two engine-side fields, `heartRateSource` (`readings` or `whole_sitting`) and `wholeSitting` (the estimate and its evidence); `Payloads.summary` in the capture module does not send them, so the phone, the API and the dashboard are untouched. If the dashboard is to show a whole-sitting value in a muted style, `heartRateSource` is the field to carry through `packages/contracts`, `Payloads.swift`, the `sittings` table and the two apps: that was not done.

Reasons on the wire are the same strings. `motion` now means "more than 30% of the window had to be cut"; `low_quality` also covers the recency check; `awaiting_agreement` means three of the newest five. `EngineConfiguration` lost `motionColourDeviation` and `motionBaselineSeconds` and gained the fields in section 2. `PulseDiagnostic.brightnessMotionShare` is now `colourJumpShare`, and `motionShare` is the share of the window cut out; `recentQuality` is new.

**Raw files** (`4f86abd`, `apps/mobile/src/lib/capture/sittingFile.ts`). A sitting's file used to be deleted from the phone whether or not the upload worked. It is now uploaded up to three times and removed only once the server has it; if every try fails it stays on the phone. Development builds only, as before, and the server still refuses files in production. Verified by typecheck, lint and unit tests; not run in the simulator or on a device.

**The summary's reason is still not stored.** It needs a column on `sittings`, a field in `packages/contracts` and the API, which is more than a small change. The per-second reasons are stored in `readings` and the commonest of them is the summary's reason, except for `too_few_readings`.

**Capture module: nothing changed.** Its Swift cannot be compiled here (no iOS build in the worktree), and an unbuilt change to the camera path the night before a demo is a bad trade. What should change there is listed for a person in `docs/OVERNIGHT_BACKLOG.md`.

## 9. Known limits and what is open

- **The owner's sitting gives a live reading for 3 of 60 s.** The number at the end is there; the live screen will mostly say "No reading" on a recording like it. The engine cannot honestly do better on that signal: the fix is in capture (a larger or steadier forehead region at the mount distance, global tone mapping, a flicker-safe shutter) and needs a device. The repeat sitting with an oximeter that the diagnosis asked for is still needed to know whether 101 to 103 bpm was right.
- **A pulse whose second harmonic is stronger than its fundamental, and faint, reads double.** Synthetic, at a quarter of the usual pulse size with the harmonic at 1.5 times the fundamental: 45, 50, 55, 60 and 66 bpm read as 90, 100, 110, 120 and 132, before and after this work, through the readings and through the whole-sitting estimate alike. With the harmonic at or below the fundamental it does not happen (tested at 0.5 and 1.0).
- **The whole-sitting estimate says nothing under 55 bpm**, and one held-out control in 636 got through it at 59.6 bpm.
- **After the pulse leaves the picture a rate can stay for up to 4 s** (2 to 3 s without a brightness step).
- **Live readings on wandering-colour controls**: 0.8% of seconds.
- **Breathing is untouched**: the owner's sitting still has none, because the chest is barely tracked.
- **`eval/refusals.py`** still names `maximumMotionShare` in its example; for heart rate the field is now `maximumDisturbedShare`. It was not edited: the shell guard of the session that did this work refused any command containing the path component `eval`, including `git add` of a file there, so no file under `eval/` was changed. Measurement scripts for this work went to `packages/signal-engine/Scripts/` for the same reason.
- **Held-out controls and the first held-out noise draw** were produced by the scratch version of `reliability.py` (same generator, same seeds: `--seed 770000 --repeats 4`). The disk filled before they could be regenerated with the committed script; the tuning controls and every other table were.
