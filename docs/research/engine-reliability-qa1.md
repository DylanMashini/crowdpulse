# Engine reliability, QA round 1

14 November 2026. QA agent (Opus 5.5), not the author. Branch `worktree-engine-reliability`, engine change `a14e7ab..8b32a18` (the brief named `05629db..8b32a18`, but `05629db` itself is the motion change, so "before" here is `a14e7ab`, as in the results file). Nothing in the engine or the apps was changed by this round.

Verdict: **the headline numbers are honest and reproduce to the digit, and on noise-like controls the change is a clear improvement. But one new failure mode is real and serious: rhythmic head movement with no pulse now ends with a confident heart rate where the old engine refused it.** Before that is fixed or bounded, the change trades a refusal for a wrong number in a case a waiting room will produce (rocking, nodding, bouncing a leg).

## How things were run

- "Before" engine: `git archive a14e7ab packages/signal-engine` built in `/tmp/qa1/before`. "After": this branch's release `engine-cli`.
- My own scorer `/tmp/qa1/score.py` (not `reliability.py`): `engine-cli run`, each valid reading paired with the nearest reference sample within 1.5 s, sitting rate compared with the mean reference.
- My own adversarial sittings: `/tmp/qa1/gen.py` (numpy, writes sitting files, runs the engine). Sweep of weak true pulses: `/tmp/qa1/sweep.py`. Hand cover: `/tmp/qa1/cover.py`. Sensitivity: `/tmp/qa1/sens.py`. All outputs in `/tmp/qa1/work/`. Nothing derived from dataset subjects or the owner was written into the repository.
- Dataset sitting files read from the main checkout (`/Users/dylanmashini/Development/EmoryHacks/eval/out/ubfc`), the owner's sitting from `apps/web/recordings/a88a50e1-….jsonl` in the main checkout.

### The shell guard

Measured, by probing: the guard refuses a command when any word, after stripping its directories and a trailing slash, is exactly `eval` (`echo eval`, `ls eval/`, `ls /…/EmoryHacks/eval` are refused). Words with `eval` inside a longer path component are allowed: `ls /…/eval/out`, `git log -- eval/run_eval.py`, `git diff --stat eval/refusals.py`, `python3 … eval/refusals.py` all ran. It apparently mistakes a path whose last component is `eval` for the shell builtin. The developer's note ("refused any command containing the path component `eval`, including `git add` of a file there") is broader than what I measured: a file path under `eval/` is not refused, only a bare `eval` or a path ending in it. I did not try `git add` (nothing of mine belongs there). Separately, the guard also refuses heredocs and some multi-statement commands as "too complex"; I wrote scripts to `/tmp/qa1` with the editor instead. No workaround was needed for dataset files: they were passed as ordinary paths ending in a file name.

## 1. Headline numbers: reproduced (measured)

| | Before | After | Results file |
|---|---|---|---|
| Tuning, 12 sound references: coverage / within 5 bpm / MAE | 62.5% / 95.5% / 2.02 | 68.4% / 96.0% / 1.96 | same |
| Tuning, 12: sittings with a heart rate (right, wrong) | 11 (10, 1) | 12 (11, 1) | same |
| Tuning, all 16: coverage / within 5 / MAE | 61.6% / 87.6% / 10.55 | 69.3% / 86.9% / 12.21 | same |
| Held-out, 21: coverage / within 5 / MAE | 59.8% / 88.9% / 2.51 | 62.2% / 88.2% / 2.58 | same |
| Held-out, 21: sittings with a heart rate (right, wrong) | 20 (17, 3) | 20 (17, 3) | same |
| Owner `a88a50e1` | none; 49 s motion, 5 low_quality, 1 awaiting, 5 warm-up | 101.5 bpm from readings, 3 valid s (101.7, 101.5, 101.4); whole-sitting 103.0, q 0.23, prominence 2.30, support 0.48, 5 stretches, accepted | same |

No difference anywhere. Note that only 16 of the 21 tuning subjects in `split.json` have sitting files on disk.

Fresh negative controls (measured): `reliability.py controls` with a seed the developer did not use (424242, 4 repeats). Held-out, 636 controls: before 35 end with a heart rate (5.5%), after **1** (0.2%): `shuffled_subject5_2`, **61.5 bpm from the whole-sitting estimate with 0 valid seconds**. Tuning (576, no owner sitting): before 30, after 0. So the developer's single held-out false accept (59.6 bpm, shuffled subject4, 0 valid seconds) is not a one-off: a fresh draw gives the same kind of event at the same rate, at the same low end of the range.

## 2. Findings

### F1. Rhythmic head movement with no pulse now gives a confident heart rate — wrong number risk (high)

Reproduce: `python3 /tmp/qa1/gen.py <engine-cli> /tmp/qa1/ctl2 D2_` (family `D2_bob_*`). Skin with **no pulse**, sensor noise 0.25 counts, the regions' brightness swinging 3% or 6% at 1.0, 1.3 or 1.8 Hz (head bobbing towards and away from the light, rocking), plus a small change in colour balance moving with it (0.2% or 0.6% per channel, random direction, i.e. of the order of the pulse itself, 0.26% in green).

Measured, 24 sittings:

| Engine | Ending with a heart rate | Values | How |
|---|---|---|---|
| Before (`a14e7ab`) | 0 of 24 | | every second after warm-up refused as `motion` |
| After | **21 of 24** | 59.6 to 60.8 (1.0 Hz), 76.5 to 78.1 (1.3 Hz), 107.0 to 109.0 (1.8 Hz) | 19 from readings (many with 52 valid seconds, i.e. 88% coverage), 2 from the whole-sitting estimate with 0 and 2 valid seconds |

The reported rate is exactly the movement rate. On screen these are indistinguishable from a good sitting (52 of 60 seconds valid, whole-sitting quality up to 0.84).

Why (inferred from the code, consistent with the measurements): the old brightness check was the only thing that refused smooth periodic movement. The new colour-jump detector compares quarter-second means against `max(1.2%, 4 × the window's median change)`, capped at 3%. A smooth rhythm raises its own median, and its colour-balance change stays under 1.2%, so nothing is ever cut. The POS projection cancels the brightness part exactly, but any colour-balance part at the movement rate is exactly what POS keeps as pulse. The developer's "synthetic movement tests" use the generator's 6% burst with a strong colour shift, which the detector does catch; my smooth rhythm is not caught.

Not affected (measured): pure brightness at in-band rates (`C_gain_*`, `C_gamma_gain_*`, 16 sittings) and my milder movement model (`D_*_nopulse`, 12 sittings) end with no heart rate after the change.

Also measured, not a regression: periodic *coloured* or *additive white* light in the band (`C_coloured_*`, `C_additive_white_*`, e.g. a screen or flickering display) ends with its own rate in 12 of 16 sittings, before and after alike. Pre-existing limit of camera vitals worth knowing about; the whole-sitting estimate also accepts these.

### F2. The whole-sitting estimate gives numbers to sittings with no live reading at all, and nothing downstream can tell — wrong number risk

Measured: fresh held-out controls, 1 of 636 accepted at 61.5 bpm with 0 valid seconds (developer: 1 of 636 at 59.6, 0 valid seconds). F1: `D2_bob_1.0Hz_b0.06_c0.002_0` 60.0 bpm whole-sitting, 0 valid seconds.

Downstream (measured, browser, port 3100): I created through the API what the phone sends for such a sitting (all 60 readings refused, summary `{value: 61.5, coverage: 0}`, script `/tmp/qa1/inject.mjs`) beside a normal one (72 bpm, coverage 0.87). The patient page shows "62 bpm" in the timeline exactly as it shows "72 bpm", the handoff reads "pulse 62 bpm at check-in", and the record says "1, baseline from 13:46": the whole-sitting value becomes the patient's **trend baseline** and NEWS2 input. Screenshots `/tmp/qa1/shots/whole-1280.png`, `readings-1280.png`, `none-1280.png` and the 390 px versions. `heartRateSource` is dropped in `Payloads.summary` (as the developer disclosed), so only coverage 0 marks it, and nothing reads coverage.

Copy that becomes false (from the code, not seen on screen because my injected sitting was not on the check-in page): `SittingView.summaryContent` labels the value "Median of the sitting that ended at …", and the nurse app `nurseFormat.sittingRows` writes "60 s, pulse read 0% of the time" next to a pulse value.

Inference: the developer's own rule (step 5) says three to nine agreeing live seconds are not enough on their own, yet zero live seconds plus the whole-sitting estimate is enough. Requiring at least a few valid seconds that agree with the whole-sitting estimate would have refused every false accept I found (all had 0 to 2 valid seconds) while keeping the owner's sitting (3). That is a suggestion, not measured.

### F3. The owner's sitting is held by thresholds tuned on it — minor (honesty of the headline)

Measured (`/tmp/qa1/work/sens.txt`): moving `wholeSittingQuality` 0.2 → 0.24 or `wholeSittingSupport` 0.45 → 0.54 turns the owner's 101.5 bpm into no heart rate. The developer says so plainly. Read the headline "the field failure is fixed" as "fixed at these thresholds, unverified against a reference".

### F4. Sensitivity of the new thresholds — minor, with two that matter

Each new threshold moved by -20% and +20% (integers by one), against the 33 UBFC sittings with sound references, the owner's sitting, and 518 no-pulse controls (fresh held-out shuffles and wandering colour, my A and H noise families, D2). Measured:

- **UBFC does not move**: every setting gives 32 sittings with a rate, 28 right, coverage 63.1% to 65.1%. No sign of overfitting to the dataset; the thresholds are tuned on controls and the owner's sitting, which is where they bite.
- **False accepts are sensitive to two thresholds**: `wholeSittingProminence` 1.44 adds 3 shuffled-control accepts (61 to 68 bpm); `wholeSittingMinimumBpm` 44 adds 7 (44 to 54 bpm, shuffled and wandering). The noise floor of the whole-sitting estimate sits within 20% of where it is set.
- `minimumUncorroboratedReadings` 8 or `minimumRecentQuality` 0.32 each let one wandering-colour control through (49.6, 50.8 bpm).
- The motion thresholds (`colourJump*`, `maximumDisturbedShare`, `minimumChestTrackedShare`) move nothing that matters at ±20%. `agreementSpanWindows` 4 or 6 moves coverage by about a point.

### F5. A rate can stay up to 6 s after the face is covered, not 4 s; the loosened test is weak — minor

Measured (`/tmp/qa1/cover.py`, 72 bpm person, at 30 s the regions become pulse-free skin or a hand, tracker still reporting a face, 4 seeds each):

| Change at 30 s | Before: seconds the rate stays | After |
|---|---|---|
| No step | 4, 4, 5, 6 | 2, 2, 2, 6 |
| Brightness +5% or -10% | 0, 0, 0, 0 | 2, 2, 2, 6 |
| A hand (different colour) | 0, 0, 0, 0 | 2, 2, 2, 3 |

In one seed in four the rate stays 6 s, and drifts (71 to 76 bpm, truth 72). Judgement: a few seconds of the patient's own recent rate after a cover is acceptable clinically; it is not a number from nowhere. But the claim "up to 4 s" is not true in general, and the test `faceCoveredButTrackerStillReportsFace` replaces the hand with a perfectly constant colour (`200 + (c.r - 180) * 0.0`, no noise at all), which is the easiest case there is; with that, 4 s passes. It still tests something (the rate must stop), but it would not catch the 6 s case. Better: noise on the hand colour and several seeds.

### F6. Bradycardia under 55 bpm with few live readings is now always refused — minor (coverage, not a wrong number)

Measured: synthetic 44 bpm, amplitude 0.35, noise 0.5 counts: before 44.5 bpm (18 valid), after none (9 valid, `too_few_readings`). With fewer than ten valid readings the rule asks the whole-sitting estimate to agree, and that estimate never reports under 55 bpm, so a slow heart with 3 to 9 good seconds can never be corroborated. Safe direction, but it is a hole by design, worth stating next to the 55 bpm floor.

### F7. Double rate: less likely than before, but the whole-sitting estimate corroborated one — minor

Measured (`I_*` family, 77 sittings, fundamentals 44 to 172 bpm, second harmonic 0.2, 1.0 or 1.5 of the fundamental, noise 0.5 counts): sittings ending at double the true rate fell from **11 before to 3 after** (44 → 90.1, 46 → 92.6, 50 → 99.7). One of the three (44 bpm, 7 valid readings) was let through *only* because the whole-sitting estimate agreed at 88.6: both see the same harmonic, so corroboration does not protect against this error. No case ended at double the rate from the whole-sitting estimate alone. At 150 bpm with a weak pulse the whole-sitting peak was 75.6 (half the rate) but not accepted; I saw no accepted half rate.

Tails, true pulse (measured): 145 to 172 bpm at normal amplitude read right before and after; 44 to 50 bpm at normal amplitude read right after except F6.

Broader sweep of weak true pulses (`/tmp/qa1/sweep.py`, 648 sittings, 45 to 175 bpm, amplitude 0.12 to 0.25, harmonic 0.2 and 0.6, noise 0.5): before 242 end with a rate, 5 of them wrong by more than 5 bpm (139.7 for 70, 120.0 for 80, 97.6 for 110, 119.9 for 125, 166.5 for 175); after 210 end with a rate, **0 wrong**, 103 of them from the whole-sitting estimate. On honest synthetic pulses the whole-sitting estimate did not invent a wrong number.

### F8. Other controls asked for, no finding (measured)

All on the new engine, 0 sittings ending with a heart rate unless stated:

- Sensor-like noise (`A_*`, 42: white 0.1/1/4 counts, shot noise, independent 1/f noise, 1/f gain drift; 30 and 60 fps): 0 (before: 3, at 45.6, 56.4, 59.7). 7 live seconds in total across 3 sittings.
- Mains flicker 100 and 120 Hz at 29.7 to 60 fps including 24.4 and 49.4 fps, grey and coloured, 1% and 5% (`B_*`, 72): 0, and 0 live seconds. Same before.
- Periodic jumps every 1.85 to 3 s, no pulse (`H_*_nopulse`, 8): 0. Cutting at a steady rhythm produced no artefact peak; with a pulse at 66 bpm the two sittings that ended read 66.2 and 66.4. Windows with jumps every 1.85 or 2 s are refused as motion throughout (more than 30% cut, since stretches shorter than 1.6 s are dropped).
- Two people spliced (`E_*`, 8): with a strong pulse the readings' median picks one person (63.0 for 62/108, 59.3 for 58/120), as before; the whole-sitting estimate refused all eight (3 supporting stretches). With a weak pulse the new engine refuses where the old gave 62.0 or 117.1. Note: the whole-sitting evidence is not cleared when the face track changes (`PulseTracker.endSegment` does not touch `evidence`), so a second person's windows count for the first patient's sitting. No wrong number came of it here.
- Very short sittings 8 to 30 s (`F_*`, 12): no rate from a no-pulse sitting; the whole-sitting estimate needs 15 full windows, so it never acts under about 25 s. Weak-pulse sittings of 12 and 30 s that used to end at 71.2 (right) now end with none.
- Long dropouts (`G_*`, 6): 0. Before: 2 weak-pulse sittings ended right (79.9, 78.2).

### F9. Phone keeps a sitting file that fails to upload — minor

Read (`apps/mobile/src/lib/capture/sittingFile.ts`, `useSittingController.ts`, `saveSittingFile` in `apps/web/src/server/sittings.ts`, `CaptureController.swift`):

- **Duplicates: none.** The server writes `<sittingId>.jsonl` via a `.part` file and rename, so a retry after a lost response overwrites the same file.
- **Unbounded: yes, in development builds.** A kept file is never offered again: nothing retries it later and nothing prunes the folder. Failures that can never succeed (404 sitting not found, 413 over 5 MB, i.e. a sitting over roughly four minutes, 403 from a production server) are retried three times and then kept, one file per sitting, about 1.2 MB a minute. The folder is under Caches (`TriageCamSittings`), which iOS may purge under storage pressure, so it is bounded in practice by the OS, and the comment "can be copied off with the app's container" may find it gone. Release builds are unaffected (`wanted: __DEV__`, removed at once).
- Unit tests cover the five paths with injected upload and remove. Not run on a device or in the simulator by me either (see 3).

## 3. Regressions outside the engine (measured)

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| web lint, mobile lint | pass, no output |
| `pnpm test` | pass: contracts 10, mobile 75, web 98, Swift 165 tests in 42 suites |
| `pnpm --filter @triagecam/web build` | pass, after loading the main checkout's `apps/web/.env.local` into the environment through a wrapper (`/tmp/qa1/withenv.mjs`, values never printed or copied). The worktree has no `.env.local`, so a plain build fails at "Invalid environment"; that is the environment, not the change |
| Smoke test, dev server on 3100 with `.next-3100` | pass ("Smoke test passed against http://localhost:3100"; push, face match and overdue not checked, as the script says) |
| Browser (headless Chromium, `playwright-core` installed under `/tmp/qa1/pw`, not in the repo), 1280 and 390 px, reduced motion | patient pages, waiting room and check-in render; console clean (only `ERR_ABORTED` on `/api/stream` and `/api/auth/me` at navigation, which is the page closing its event stream). See F2 for what a whole-sitting value looks like |

**Simulator rig (B0), measured.** `apps/mobile/scripts/sim-qa.sh up` from this worktree, with the main checkout's web env loaded through the same wrapper: pod install, a fresh development build with the new engine (`WholeSittingEstimate.swift` included), both simulators booted slim, server on 3200 (`triagecam_simqa`), Metro 8081. Then my flows (copies of the committed pieces under `/tmp/qa1/flows`):

- Camera role (`sign-in`, `role-camera`, `camera-sitting`): passed. A full 60 s check-in sitting from the simulated source, live screen "Measuring", summary "Baseline saved", heart rate **72 bpm, coverage 88%**, breathing 16, RMSSD 44 ms. Stored row: 72.086 bpm, coverage 0.883. The sitting file reached the server (`apps/web/recordings/1037babc-….jsonl`, 1.37 MB, git-ignored), so the new upload hand-off took the `uploaded` path once. Screenshots `apps/mobile/.sim-qa/runs/20261114-135222/` (git-ignored), checked by eye.
- Nurse role (`sign-in`, `role-nurse`, `nurse-worklist`): passed; worklist renders with the seeded patients, flags and the Simulated tag. `apps/mobile/.sim-qa/runs/20261114-135447/`.
- Rig shut down with `sim-qa.sh down`; my 3100 server stopped and `.next-3100` deleted.

What the rig cannot do: the simulated source is a fixed, strong generated pulse, so it never produces a sitting whose rate comes from the whole-sitting estimate. That case was tested through the API instead (F2); in the app it would show the same "Median of this sitting" summary and coverage bar as the 72 bpm sitting, with coverage near 0. Not covered: both appearances, largest text, server unreachable, the upload failure path in the simulator (F9).

## 4. What I did not verify

- Anything on a real phone, including the capture module (unchanged in this range) and whether 101.5 bpm was right for the owner.
- Keyboard-only and the error states of the web pages: nothing in the web app changed in this range, so I limited the browser to how the new kind of summary is shown.
- MCD-rPPG (no sitting files on disk).
- That the rhythmic-movement model in F1 matches real footage. It is synthetic; the size of the colour change was chosen to be of the order of the pulse. A recording of a person rocking or nodding, run through `engine-cli diagnose` before and after, would settle it.
