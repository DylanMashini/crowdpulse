# Why the engine gives no heart rate: diagnosis

14 November 2026. Branch `worktree-engine-reliability`, engine as at `85f4853` (the diagnostics added here change no reading: `engine-cli run` output is byte-identical before and after on 237 sitting files). Nothing in the engine's behaviour was changed.

This file is the committed copy. `.claude/` is git-ignored in this repository, so the copy asked for at `.claude/qa/engine-no-reading-diagnosis.md` exists in the worktree but is not in git; the two are identical.

Every number below is **measured** unless it is marked **inference**. Reproduce with:

```bash
swift build -c release --package-path packages/signal-engine
packages/signal-engine/.build/release/engine-cli diagnose <sitting.jsonl> [reference.jsonl] [--config overrides.json]
python3 eval/refusals.py eval/out/ubfc --set tuning          # needs eval/split.json from main
```

## Summary

1. The owner's sitting was kept in full and replays exactly. **49 of its 60 seconds were refused by the motion check, and the motion check does not measure motion.** It flags a frame when the brightness of the skin regions is more than 2% from a one-second running average, or when the chest value is fast. Neither was the patient moving in any way that matters to the pulse.
2. One brightness step of 3.5% or more anywhere in the last 10 seconds refuses the window, so each step costs about 12 seconds of readings. A step every 12 seconds or less gives a 60 second sitting with no reading at all, while every refused window holds the right rate (shown on a synthetic sitting). The owner's sitting had 13 excursions past the 2% limit between seconds 11 and 45, eight of them long enough to refuse a window on their own.
3. The same check, on its chest side, refused seconds 6 to 11, when the light was steady. The chest was tracked in only 116 of 3604 frames, and those values were pinned at the tracker's search limit. With the chest side alone switched off the sitting gives a heart rate.
4. On UBFC the refused windows were right more often than not: 63% of them on the tuning set and 53% on the held-out set held a candidate within 5 bpm of the oximeter, against 88% and 89% for accepted readings. The checks do separate better windows from worse ones, but they throw away more good answers than bad.
5. Neither real-camera sitting in the database gave a heart rate (0 of 2), and neither gave a breathing rate: the chest was untracked for 55 of 60 and 46 of 48 seconds.
6. The simulator cannot show any of this. The simulated source always plays a still person in steady light, and the dataset-video rig (B1) does not exist.

## 1. Every place a sitting can end in "no reading"

Thresholds are `EngineConfiguration` defaults (`packages/signal-engine/Sources/SignalEngine/EngineConfiguration.swift`). Its header says where they came from: the plan's numbers where the plan gives one, and "every other default is a starting guess to be calibrated on real recordings". The "Source" column says which.

### Heart rate, once per second (`PulseTracker.tick`), in the order applied

A window refused by one check is never seen by the later ones. `gate` is the name `engine-cli diagnose` prints; `reason` is what goes on the wire.

| # | `gate` | Wire `reason` | Refuses when | Threshold | Source |
|---|---|---|---|---|---|
| 1 | `no_frames` | `no_frames` (stale) | A whole second passed with no frame; `reading(at:)` also reports stale after 2 s of silence | `staleAfterSeconds` 2 | Plan |
| 2 | `no_face` | `no_face` | Newest frame has no face, or no region has a colour. Ends the segment: history, baseline and agreement are reset | none | Plan requirement |
| 3 | `exposure_adjusting` | `exposure_adjusting` | Newest frame's exposure is not `locked`. Ends the segment | none | Plan requirement |
| 4 | `warming_up` | `warming_up`, `face_changed` | Under 6 s since the segment began (face found, exposure locked, or a new `faceTrackId`) | `heartRateMinimumWindowSeconds` 6 | Guess |
| 5 | `recent_gap` | `gaps` | A step between frames over 0.25 s lies less than 6 s back; the window restarts after it | `maximumGapSeconds` 0.25 | Guess |
| 6 | `too_few_samples` | `gaps` | Window has under 85% of the frames its median interval predicts, or under 20 frames per second | `minimumSampleShare` 0.85, `minimumFrameRate` 20 | Guess |
| 7 | `motion` | `motion` | Over 5% of the window's frames are flagged. A frame is flagged when region brightness (r+g+b, mean of the regions) is over 2% from a running baseline with a 1 s time constant, **or** chest displacement is over 0.08 frame heights per second | `maximumMotionShare` 0.05, `motionColourDeviation` 0.02, `motionBaselineSeconds` 1, `motionChestSpeed` 0.08 | Guess (the plan asks only that motion be tracked over the whole window) |
| 8 | `incomplete_regions` | `gaps` | No region has a colour in every frame of the window | none | - |
| 9 | `flat` | `low_quality` | No power in the pulse band | none | - |
| 10 | `band_edge` | `band_edge` | Peak, or half of it when taken for a second harmonic, within 2 bpm of 42 or 180 | `heartRateSearchBpm` 42...180, `bandEdgeMarginBpm` 2 | Plan range, guessed margin |
| 11 | `flicker` | `low_quality` | Peak within 6 bpm of where 50, 60, 100 or 120 Hz aliases at the delivered frame rate. No evidence of flicker is needed: the band is blanked | `flickerFrequenciesHz`, `flickerAliasMarginBpm` 6 | Guess |
| 12 | `illumination` | `low_quality` | Under 10% of the colour signal at the peak survives the POS projection | `minimumProjectionYield` 0.1 | Added for BUG-3 (`22fa122`) |
| 13 | `quality` | `low_quality` | Share of band power within 1.25 frequency resolutions of the peak is under 0.5 | `qualityThreshold` 0.5, `qualityHalfWidthResolutions` 1.25 | Plan, "to be calibrated on negative controls" |
| 14 | `agreement` | `awaiting_agreement` | The last 3 windows did not all pass 1 to 13, or their rates span more than 5 bpm | `agreeingWindows` 3, `agreementToleranceBpm` 5 | Plan |

Not a refusal but it changes the value: a peak with a subharmonic at half its frequency (2% of its power and 16 times the noise) is halved (`subharmonicPowerFloor`, `subharmonicNoiseRatio`; guesses).

What a refusal costs: the window is 6 to 10 s long and slides one second at a time, so one bad stretch is inside ten consecutive windows, and then two more seconds go to agreement. Losing the face or the exposure lock costs 6 s of warm-up plus 2 s of agreement. The earliest possible first reading is 8 s after exposure locks.

### Sitting summary (`SignalEngine.summary`)

- The sitting's heart rate is the median of the valid seconds and needs at least 3 of them (`minimumSummaryReadings` 3, guess). With none, the summary's reason is the commonest per-second reason; with 1 or 2 it is `too_few_readings`.
- RMSSD and SDNN have their own checks (`BeatAnalyzer`: 20 intervals, 60% beat coverage, region disagreement 12 ms, 25% rejected beats). They need a heart rate first.

### Breathing rate (`BreathingTracker.tick`)

`no_chest` when no `chestMotion` arrived in the last 0.5 s (`chestGapSeconds`); 40 s of chest signal before a first window (`breathingMinimumWindowSeconds`); motion share over 5%; under 20 frames per second; flat, band edge (0.75 per minute), drift (something slower is stronger than the peak), quality under 0.5; 3 windows within 2 per minute. A chest lapse of over 0.5 s restarts the 40 s.

### Capture module (`apps/mobile/modules/triage-capture/ios`)

| Where | What turns into no reading | Threshold |
|---|---|---|
| `FaceTracker` | No Vision detection for 0.5 s: `facePresent` false, engine gate 2. Found again: new `faceTrackId`, engine restarts warm-up (`face_changed`). A detection more than 0.6 face widths away or 1.6 times the size is a new face | `lostAfter` 0.5, `maxJump` 0.6, `maxScaleChange` 1.6 |
| `FaceTracker` | Regions follow the landmarks with a 0.15 s time constant from at most 15 detections per second. Regions that slide over the skin change its mean colour (see section 4) | `smoothing` 0.15, `minInterval` 1/15 |
| `ExposureController` | `adjusting` until the face has read 50 to 215 luma for 0.5 s and the lock is applied; the lock is dropped after 1 s outside that range or 3 s without a face. Every `adjusting` frame is engine gate 3 | `wellExposed` 50...215 |
| `RegionSampler`, `RegionGeometry` | A region off the frame has no colour; all three missing is `no_face`. The chest region is 0.35 face heights below the chin and 0.8 tall, and is dropped when under 0.3 face heights of it are in the frame | `chestMinHeight` 0.30 |
| `ChestMotionEstimator` | No value when the region is under 48 rows or 32 columns, or has too little texture; the search stops at 6 rows per frame | `minRows`, `minTexture`, `maxLag` 6 |
| `CameraSource` | Dropped frames show as gaps (gates 5 and 6). The frame rate is held for the length of a sitting | - |
| `CaptureController` | `startSitting` fails if no frame arrives in 3 s. Stopping capture (leaving the screen) abandons the sitting: its file is deleted and it is never finished | `firstFrameTimeout` 3 |

### App and server

- `apps/mobile/src/lib/capture/useSittingController.ts` stops a sitting at 60 s. There is no minimum length.
- `apps/web/src/server/sittings.ts` applies no check of its own to the values: `finishSitting` stores what the phone sends, null included. A sitting that is never finished (abandoned on the phone, or a finish request that fails validation or the network) stays open and is closed **without a summary** when the same patient's next sitting starts, which the dashboard shows as no reading.
- The summary's `reason` is not stored: the `sittings` table has no column for it. The per-second `reason` is stored in `readings`, but only the wire string, so `motion` cannot be split into brightness and chest, and `low_quality` cannot be split into quality, flicker, illumination and flat, without the raw file.
- The raw sitting file is uploaded only by a development build (`__DEV__`), only after a finished sitting, and a failed upload is a console warning; the server refuses it in production and above 5 MB. The phone deletes its copy either way.

## 2. The owner's sitting

**What is stored.** Sitting `a88a50e1-1b9c-4747-92ab-9232a69619ee`, source `camera`, check-in, started 11:25:09 local time: 60.1 s, 3604 frames, 0 dropped, heart rate and breathing rate null with coverage 0. All 60 per-second readings are in `readings` with state, reason and quality. The raw sitting file is on disk (`apps/web/recordings/<id>.jsonl` in the main checkout, 1.2 MB, git-ignored) and holds every frame, so the sitting can be replayed. The dev server log is empty. Not stored anywhere: which camera was used, where the regions were, and the camera's ISO and shutter, so the cause of the colour changes in section 4 cannot be settled from the file.

**Replay.** `engine-cli run` reproduces the stored readings second for second: 5 warming up, 49 `motion`, 5 `low_quality`, 1 `awaiting_agreement`; summary reason `motion`.

**Capture was clean.** Every frame had a face (one track id throughout), all three regions, exposure `locked`; 60.00 frames per second with no gap.

**Which check, and by how much** (`engine-cli diagnose`):

| Seconds | Check | Measured against its limit | What the windows held |
|---|---|---|---|
| 1 to 5 | warm-up | | |
| 6 to 11 | motion, chest side only | 11% to 17% of frames flagged, limit 5%; brightness side 0% | 101.3 to 102.3 bpm, quality 0.53 to 0.64, six windows in a row within 1 bpm |
| 12 to 54 | motion, brightness side (the chest side stays over its limit until second 13) | 6% to 46% of frames flagged, limit 5% | Quality over 0.5 in 7 of 43 windows; candidates jump between about 45, 75 and 101 to 107 bpm |
| 55 to 60 | quality (5 s), agreement (1 s) | Quality 0.18 to 0.47, limit 0.5; motion 0% | 46 to 52 and 105 to 107 bpm |

**Replays with one thing changed** (`--config`):

| Change | Valid seconds | Sitting heart rate |
|---|---|---|
| None | 0 | none (`motion`) |
| Chest side of the motion check off (`motionChestSpeed` huge) | 4 (seconds 8 to 11) | 101.5 bpm |
| Brightness side off (`motionColourDeviation` huge) | 2 | none (`too_few_readings`) |
| Brightness limit 5% instead of 2% | 2 | none |
| Motion check off (`maximumMotionShare` 1) | 8 | 101.6 bpm; 33 s then fail on quality, 8 on band edge, 6 on agreement |
| Motion check off and quality 0.3 | 15 | 101.6 bpm |

There was no reference device, so **whether 101.6 bpm is right is not known**. It is what the engine's own later checks would have accepted.

**The earlier camera sitting** (`5a31747b`, 02:06, 48.8 s) also gave nothing. Its raw file is not on disk and there is no trace of why, so it cannot be replayed; that is a gap in itself. Its stored per-second reasons, in order: 9 s no face, 3 s exposure adjusting, 1 s warming up, 3 s no face, 6 s warming up after a face change, 17 s `motion`, 9 s no face.

**Breathing** failed in both: `no_chest` for 55 of 60 s and 46 of 48 s. In the saved sitting only 116 of 3604 frames carry a chest value, all but one between seconds 2 and 6, and 67 of those 116 are over the speed limit, many at exactly plus or minus 7 rows per frame, which is the estimator's search limit (6 rows plus a fraction capped at 1). That is the tracker failing to lock, not a chest moving 400 rows a second.

## 3. Refusals on UBFC-rPPG, by check

37 UBFC sittings are on disk (the A1 run finished while this was being measured). They are reported by the halves of `eval/split.json`. One row per one-second reading. "Candidate" is what the refused window would have reported: the strongest peak after the harmonic correction, with every check off. "Within 5 bpm" is against the oximeter value nearest in time (within 1.5 s).

**Tuning set: 16 sittings, 1082 seconds**

| Check | Seconds | Share | With a candidate and a reference | Candidate within 5 bpm | Median abs. error (bpm) |
|---|---|---|---|---|---|
| (valid reading) | 667 | 62% | 667 | 584 (88%) | 1.9 |
| warming_up | 80 | 7% | 64 | 27 (42%) | 6.0 |
| motion | 150 | 14% | 150 | 100 (67%) | 2.7 |
| band_edge | 7 | 1% | 7 | 0 (0%) | 44.3 |
| flicker | 43 | 4% | 43 | 30 (70%) | 2.0 |
| quality | 45 | 4% | 45 | 30 (67%) | 3.9 |
| agreement | 90 | 8% | 90 | 65 (72%) | 2.6 |
| **all refused** | 415 | 38% | 399 | **252 (63%)** | |

15 of 16 sittings give a heart rate. The one that does not, subject48, is refused as `motion` for 62 of its 67 seconds; its median candidate is 85.9 bpm against a mean reference of 87.4.

**Held-out set: 21 sittings, 1345 seconds** (defaults only; no change was tried on it)

| Check | Seconds | Share | With a candidate and a reference | Candidate within 5 bpm | Median abs. error (bpm) |
|---|---|---|---|---|---|
| (valid reading) | 804 | 60% | 804 | 715 (89%) | 1.8 |
| warming_up | 105 | 8% | 84 | 34 (40%) | 6.1 |
| motion | 137 | 10% | 137 | 65 (47%) | 5.3 |
| band_edge | 19 | 1% | 19 | 0 (0%) | 40.0 |
| flicker | 73 | 5% | 73 | 48 (66%) | 3.0 |
| quality | 71 | 5% | 71 | 36 (51%) | 4.7 |
| agreement | 136 | 10% | 136 | 91 (67%) | 3.0 |
| **all refused** | 541 | 40% | 520 | **274 (53%)** | |

What the tables say:

- **Motion.** All 287 motion refusals on UBFC come from the brightness side (the dataset sittings carry no chest value). Half to two thirds of them held the right rate.
- **Flicker.** Right 66% to 70% of the time with a median error of 2 to 3 bpm, as good as accepted readings. The check blanks a 12 bpm band wherever mains would alias at the delivered frame rate, whether or not there is any flicker: at subject9's 29.54 frames per second that band is 104 to 116 bpm, and the subject's heart rate is in it for 35 seconds. At exactly 60 or 30 frames per second the aliases are at 0, 10 and 20 Hz, outside the pulse band, so on the owner's phone this check did nothing (0 seconds).
- **Agreement.** Right 67% to 72% of the time.
- **Quality and band edge** are the checks that mostly refuse wrong answers: band edge is never right, quality is right about half the time.
- **Warm-up** windows are short and mostly wrong; there is nothing to recover there.

**One thing changed at a time, tuning set**

| Change | Coverage | Readings within 5 bpm | Sittings with a heart rate | Of those, within 5 bpm of the mean reference |
|---|---|---|---|---|
| None | 62% | 88% | 15 of 16 | 10 |
| Motion check off | 70% | 86% | 16 | 11 |
| Brightness limit 5% | 69% | 87% | 16 | 11 |
| Flicker check off | 65% | 87% | 15 | 11 |
| 2 agreeing windows | 66% | 87% | 15 | 10 |
| Quality 0.4 | 64% | 87% | 15 | 10 |
| Motion and flicker off | 74% | 85% | 16 | 12 |
| Motion and flicker off, 2 agreeing windows | 80% | 85% | 16 | 12 |

Caveats. (1) Sixteen and twenty-one sittings are few; one subject moves a row by several points. (2) In four tuning subjects (11, 18, 20, 24) the engine's candidate is steady and 20 to 70 bpm away from the reference for the whole sitting, valid readings included. Either the engine locks on to something that is not the pulse or the reference file is not that video's; this was not investigated here, and it is why the tuning set shows a +7.7 bpm bias. It lowers "within 5 bpm" in every row. (3) "Off" here is a measurement, not a proposal: see section 5.

**MCD-rPPG, internal only, not for publication** (600 sittings, compressed side-angle footage): motion refuses 39% of seconds and is the summary reason for 131 of the 255 sittings with no reading; 35% of its refused windows held the right rate. With the motion check off, sittings with a heart rate go from 345 to 498, of which right 131 to 214 and **wrong 214 to 284**. On poor footage the check does hold back wrong answers as well as right ones.

## 4. Most likely causes of the owner's failure, ranked

1. **The motion check's brightness side refuses a still face whenever the light on it changes by a few per cent.** Measured: it is the stated reason for 43 of the 49 refused seconds and for the sitting. Measured on a synthetic still person at 72 bpm: a single step of 3.0% refuses nothing, 3.5% or more refuses 10 seconds; steps every 12 s or closer leave no valid second in 60, and all of the refused windows hold 72 bpm. Measured in the owner's file: region brightness sits on plateaus and jumps between them; it leaves the 2% band 13 times between seconds 11 and 45, by up to 12.9%, and 8 of those excursions last over half a second, which is enough to refuse a 10 s window. The last one leaves the window at second 54, which is when the motion refusals stop. The POS projection the engine uses is built to cancel brightness changes common to the three channels, so the check refuses what the maths was chosen to survive. Also seen on UBFC (subject48: no reading, candidate 1.5 bpm from the reference).
2. **The motion check's chest side fired on a chest that was not being tracked.** Measured: seconds 6 to 11 were refused with brightness steady and the chest side at 11% to 17%; the candidates there agree at 101 to 102 bpm with quality over the threshold; with the chest side alone off the sitting gives a heart rate. The chest values are at the estimator's search limit. **Inference:** at the distance the phone was mounted the chest region is at or beyond the bottom of the frame, so it is tracked for moments and badly.
3. **The colour of the skin regions really did change, and that costs quality whatever the motion check does.** Measured: the three regions move together (correlation 0.84 to 0.95) but by different amounts (forehead +9.5%, cheeks +3% and +5% in the same seconds), and the red to green ratio of the forehead moves between 1.41 and 1.65 while blue to green stays within 0.81 to 0.84. A camera gain change would move all regions and channels by the same factor, so **exposure drift under the lock is unlikely (inference from those measurements)**. What is left is the light on the face changing (a screen, a person or a door near the light) or the face moving relative to the light and the regions sliding over it (a small turn of the head towards the laptop, with regions that follow the landmarks at 0.15 s). **Which of these it was cannot be told from the file**: it stores neither the region positions nor the camera. With the motion check off, 33 seconds still fail on quality.
4. **The pulse signal on the phone is weak even in a quiet stretch.** Measured: in the last six seconds brightness varies by 1% and no frame is flagged, yet quality is 0.18 to 0.47 and the candidate jumps between about 46, 52 and 105 bpm. Candidates near half of 101 to 107 recur through the sitting and the harmonic halving fired in 8 seconds. **Inference:** the engine is unsure between a rate and its half or double on this footage. With no reference worn, the true rate is unknown.
5. **The agreement rule turns short refusals into long ones.** Three consecutive windows plus a 10 s window means any refusal is 12 s. On its own it refused 1 second here; it is why causes 1 and 2 were fatal rather than a dip.

Not a cause here (measured): dropped frames or gaps (none), face loss (none), exposure not locking (locked from the first frame), frame rate (60.00), flicker check (0 seconds), server or upload (the stored readings equal the replay).

## 5. What a developer should change first

In this order. Choose values on the tuning set and the saved sitting, then check the held-out set once.

1. **Stop using brightness as a motion signal.** Make the brightness side of the check measure what actually breaks POS: a change in the regions' colour ratios, or a jump within a few frames, rather than a level 2% from a one-second average. Then cut the flagged frames out (or restart the window after the step, as the gap check already does) instead of refusing every window that contains one. Evidence that this is the first thing: it alone is the stated cause of the sitting, and on the tuning set removing it takes coverage from 62% to 70% and recovers the only sitting with no reading, for 2 points of accuracy. Do not simply delete it: on MCD it also holds back wrong answers, and the quality check has to be shown to catch those first.
2. **Take chest speed out of the heart-rate motion flag unless the chest is tracked well**, and fix why the chest is not tracked on the device (region placement at the mount distance, and the estimator returning its search limit as if it were a measurement). This also is what stands between the device and any breathing rate.
3. **Save what a field failure needs, every time.** Keep the raw sitting file for every device sitting during the hackathon, not only when a development build's upload happens to succeed; store the summary `reason`; add the region rectangle or face box, the camera position and the locked ISO and shutter to the sitting file (additively, in `packages/contracts` first). Without these the second camera sitting of the day could not be examined at all and cause 3 cannot be settled.
4. **Make the flicker check need evidence of flicker** (for instance a peak that is also present, in phase, in a non-skin or all-region brightness signal) instead of blanking a band. It costs 4% to 5% of UBFC seconds, two thirds of them right. It does nothing at exactly 60 frames per second, so it is not urgent for the demo.
5. **Then the agreement rule**: two windows, or three with the first reading shown as provisional. Worth 4 points of coverage on the tuning set for 1 point of accuracy, and it shortens every dropout by a second.
6. **Leave the quality threshold and the band-edge check alone** until the above are done: they are the two that mostly refuse wrong answers.

A test already pins the behaviour to change: `aBrightnessStepOnAStillFaceIsRefusedAsMotionWhileHoldingTheRightRate` in `packages/signal-engine/Tests/SignalEngineTests/DiagnosticsTests.swift`. When item 1 is done it should fail, and be rewritten to expect a reading.

## 6. Can the rigs reproduce a no-reading sitting?

- **Simulated capture source** (`SimulatedSource.swift`): no. It always plays `SyntheticSitting` defaults (a still person, 72 bpm, light drifting 2% over a minute, low noise) and takes no parameters. The 7 simulated sittings without a heart rate in the database were written through the API by the seed and by `sim-deteriorate.mjs` with null values; the engine never produced them.
- **Dataset video as the camera (B1)**: not built. There is no `eval/data/fixtures` and no script. When it exists, UBFC subject48 (tuning set) is a real recording that ends in no reading for the same reason as the owner's sitting.
- **What does reproduce it today**, at engine level only: replaying the saved sitting with `engine-cli diagnose`; UBFC subject48; the synthetic brightness step in the new test. `engine-cli synth` has `--motion` bursts but no option for a brightness step.
- **Suggested**: let the simulated source play a sitting file (the saved one, kept out of git) so the whole path, phone screen to dashboard, can be watched failing and then passing. The simulator rig was not run for this diagnosis (BUG-15 says not to until it is fixed).

## 7. Not verified, and what needs a person

- The true heart rate during the owner's sitting. **Needs a person:** repeat the sitting wearing a pulse oximeter or a watch, in a development build so the file is saved, and note which camera was used and what was near the face (laptop screen, lamp).
- What made the regions' colour step (cause 3), and why the phone's pulse signal is weak in quiet seconds (cause 4).
- That the diagnostics build into the iOS app: they are plain Swift in the same folder the podspec globs, `swift test` passes (133 tests) on the Mac, but no device or simulator build was made.
- The 36 UBFC sittings added by A1 were measured as found in `eval/out/ubfc`; the references for subjects 11, 18, 20 and 24 look wrong or the engine is confidently wrong on them, and that was not chased.
- No change was tried on the held-out set.
