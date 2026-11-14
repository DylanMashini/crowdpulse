# Engine reliability, QA round 2

14 November 2026. QA agent (Opus 5.5), not the author. Branch `worktree-engine-reliability` at `d0b1cd7`; fix round `0029fb1..d0b1cd7`, round 1 `05629db..8b32a18`, baseline `a14e7ab`. Nothing in the engine or the apps was changed by this round.

**Verdict: merge after named fixes.** The engine fixes for QA round 1 are real and reproduce to the digit. But the fix for the case the owner cares about (a rate with no live readings is labelled and kept out of trends) is not live on the owner's phone until a new development build, the server loses the pulse baseline in one common path, and the nurse app still turns a lower-confidence rate into a trend. A still person with a weak signal is somewhat *more* likely to end with no heart rate now than at baseline.

## How things were run

- Three engines built from `git archive` of `a14e7ab` (baseline), `8b32a18` (round 1) and `d0b1cd7` (now) in `/tmp/qa2`, release `engine-cli`. My own scorer (`/tmp/qa1/score.py`, not `reliability.py`) and my own batch, diagnose and generator scripts (`/tmp/qa2/*.py`).
- Data: UBFC sitting files and MCD-rPPG sitting files (600, internal diagnostic set, never published) from the main checkout's `eval/out`; **seven real iPhone sittings** in the main checkout's `apps/web/recordings` (the owner's `a88a50e1` and six more from 13:36 to 14:22 EST that the fix round did not look at); QA round 1's synthetic families; new synthetic families of my own (below).
- Web: own server on 3100 with `.next-3100`, own database `triagecam_qa2` (migrated, seeded), env loaded from the main checkout without printing values, email and push keys dropped. Headless Chromium (playwright-core, cached chromium-1234 headless shell), not the Chrome extension.
- Torn down: server stopped, `triagecam_qa2` and the migration copy dropped, `.next-3100` deleted, derived files in `/tmp/qa2` deleted. Shared `triagecam` database only read (SELECT); its migrations table still has 4 rows. Servers on 3000, 3200, Metro on 8081, 8082, 8083 and the ngrok tunnel not touched.

## 1. Headline numbers (measured, all reproduce)

| | Baseline `a14e7ab` | Round 1 `8b32a18` | Now `d0b1cd7` |
|---|---|---|---|
| Owner `a88a50e1` | none (49 s motion) | 101.5 bpm | 101.5 bpm, `low`; 3 valid s; whole-sitting evidence 1.77 |
| UBFC tuning, 12 sound: coverage / within 5 / MAE | 62.5% / 95.5% / 2.02 | 68.4% / 96.0% / 1.96 | 68.1% / 96.0% / 1.96 |
| UBFC tuning, 12 sound: sittings with HR (right, wrong) | 11 (10, 1) | 12 (11, 1) | 12 (11, 1) |
| UBFC held-out, 21: coverage / within 5 / MAE | 59.8% / 88.9% / 2.51 | 62.2% / 88.2% / 2.58 | 60.4% / 89.8% / 2.38 |
| UBFC held-out, 21: sittings with HR (right, wrong) | 20 (17, 3) | 20 (17, 3) | 20 (17, 3) |
| Fresh negative controls, seed 31337, 4 repeats (636 held-out + 576 tuning) ending with HR | 64 | 1 (59.5 bpm, 0 valid s) | **0** |
| live seconds on those controls | 0.60% | 0.34% | 0.22% |

The owner's 101.5 bpm survives every one of 12 new or changed thresholds moved by 20% either way (24 runs, measured).

## 2. Round 1 findings re-checked (measured unless stated)

| | Status | Evidence |
|---|---|---|
| F1 rhythmic head movement | **Fixed for QA's model** | D2 bobbing, 24 sittings: baseline 0, round 1 22 (QA round 1 counted 21 with the same files; one more here), now 0. But see W3: a different, plausible movement model leaks at all three engines. |
| F2 rate with no live readings | **Fixed in engine and server; not live on the phone; nurse app incomplete** | Engine marks `low`; server keeps it out of baseline, score, flags, statistics (seen in browser). See B1, W1, W2. |
| F3, F4 fragile limits | Fixed | Owner holds at ±20% on all 12; 0 of 1212 fresh controls. |
| F5 covered face | Fixed | QA round 1 cover control, 16 runs: now 1 or 2 s (round 1: up to 6). |
| F6 slow hearts | Open by design | Unchanged. |
| F7 doubled rate | As round 1 | Harmonic family, 77: the same three doubled (44→90.3 `low`, 46→92.6, 50→99.7). |
| F9 kept sitting files | Partly | See M5. |

## 3. Findings

### B1. Blocks demo / wrong number risk: the owner's phone still runs the round 1 engine, and the server reads a missing confidence as "normal"

- Inferred from the shared database (read only): the stored check-in `2e056c81` has coverage 0.30 = 18 valid of 60 s, which is what round 1 gives (baseline gives 13); `9c65078f` has 0.087 = 4 of 46 (round 1: 4, baseline: 0). So the native engine on the phone is round 1. Metro on 8083 serves this branch's JavaScript to it, but `Payloads.swift` and the engine need a development build.
- Measured: a finish without `heartRateConfidence` and a whole-sitting-style summary (61.5 bpm, coverage 0) is stored `normal`, becomes the baseline and reads "pulse 62 bpm at check-in" in the handoff (`inject2.mjs oldclient`). That is F2 exactly.
- So merging this branch without rebuilding the phone gives the demo round 1's behaviour, not round 2's. Needs a person (rebuild), or a server fallback: when the field is absent, treat a rate with fewer than 10 valid seconds (`coverage × duration < 10`) as `low`.
- `Payloads.swift` was **not compiled** (see section 6).

### W1. Wrong number risk: a lower-confidence check-in with a breathing rate takes the pulse baseline away for the whole visit

- Measured (API, then browser): check-in 101.5 bpm `low` with breathing 16, then re-checks 55, 85, 86 bpm `normal`. No flag; the waiting room shows "86 bpm" with no "from"; handoff "pulse 86 bpm now, not measured at check-in". With the first trusted rate (55) as the pulse baseline, +30 bpm on two consecutive observations would open the baseline-shift flag.
- Why (code): the baseline is the first *observation* (heart or breathing rate); a `low` rate makes the check-in an observation with a null pulse, and `pulse.base` stays null for every later sitting.
- Without a breathing rate it works (measured: `low` check-in, then 74 and 76 `normal`: baseline is 74). On the phone breathing is usually absent (no chest), so this bites mostly on the simulator and dataset sources, but it is the brief's "does a later good sitting become the baseline?": **not when the check-in had a breathing rate.** Fix: take the pulse baseline from the first sitting with a trusted heart rate, separately from breathing. "not measured at check-in" is also untrue: it was measured, with lower confidence.

### W2. Wrong number risk: the nurse app shows a lower-confidence rate as a plain one and builds a trend on it (read from code; not seen, see section 6)

- `apps/mobile/src/app/nurse/patient/[number].tsx` Vitals card: `vitalSeries(detail.sittings, 'heartRate')` plots every sitting's rate; `VitalHistory` draws the first point as the dashed check-in line and writes "+X from N at check-in". A `low` check-in therefore becomes the nurse app's check-in value and trend, which the server refuses to do.
- `apps/mobile/src/lib/nurse/worklistFormat.ts` (patient timeline on the phone) shows the pulse with no "Lower confidence" tag; only `sittingRows` got the new copy. `docs/CONTRACTS.md` says both apps tag it.
- `lastObservedMinutes` counts a `low` sitting as observed, while the server says "not yet observed".

### W3. Wrong number risk (not new, not fixed): movement that slides a skin region across a colour edge reads as a confident heart rate

- New family `L` (`gen2.py`), no pulse: each region slides over neighbouring skin a few percent darker (eyebrow, hairline, shadow) at 0.9 to 2.2 Hz, with brightness changing only 0.2% per unit of travel. 48 sittings: **38 end with a heart rate at all three engines** (baseline 38, round 1 38, now 38), 34 of the now ones `normal`, at the movement's rate. With a real pulse underneath (`LP`, 48): 6 wrong at all three. Diagnosed windows: brightness ratio 0.4 to 2.3, pulse amplitude 0.07% to 0.3%: exactly a pulse's numbers, so neither new limit can see it. Only the faintest setting (2% contrast, 20% travel) gives nothing.
- **What real footage looks like** (measured, `engine-cli diagnose` with references): windows whose candidate is more than 10 bpm off the reference with quality 0.5 or more, i.e. pulse-looking non-pulse rhythms. Share the new check flags as movement: UBFC 12 of 66 (18%), MCD front 1 of 645 (0.2%), MCD side 3 of 601 and 70 of 2893. Their median brightness ratio (0.65 to 0.88) is the same as true-pulse windows (0.50 to 0.81). On the real phone sittings the check fired on 8 windows in 7 sittings. **Inferred:** real non-pulse peaks resemble the leaking case, not the caught one; the discriminator catches brightness-dominated bobbing, which is what QA's model and the developer's tests used. These real windows are not known to be movement (some are noise or reference error), so this does not show real nodding leaks; it shows the check is no protection against the artefacts real footage actually has. End to end on MCD front, wrong sittings did fall (28 baseline, 9 round 1, 7 now), mostly from the older gates.

### W4. Minor (coverage, not a wrong number): a still person whose head moves with the heartbeat and whose pulse is weak gets no rate at all

- New family `S` (still, real pulse, plus a brightness rhythm): 360 sittings over 50 to 110 bpm, two pulse sizes, brightness swing 0.1%, 0.3%, 1%, rhythm at the pulse rate locked to the beats (ballistocardiographic head motion), at 0.93, 1.07, 0.5, 2 and 1/3 of it.
- Baseline and round 1: 360 of 360 right. Now: **348 right, 12 no heart rate, 0 wrong.** The 12: every beat-locked case with a 1% swing and the weaker pulse (10 of 10, all `motion`), and 2 at 1.07× at 50 bpm. Breathing or sway at half, double or a third of the rate cost nothing.
- Real people do this: the developer found tuning subjects 48 and 49 with a brightness rhythm at their true rate ten times the pulse signal; the `steadyRateSeconds` escape saves them only because they had earlier quiet windows. From the start of a sitting, nothing establishes a rate. On real data the new check refused 8 true-pulse windows (UBFC) and 50 (MCD front) and caught 29 and 84 non-pulse ones.

### W5. Minor (cost): weak-signal still subjects end with no heart rate more often than at baseline

The number the owner cares about: share of still sittings that **end with no heart rate at all** (measured):

| Still subjects | Baseline | Round 1 | Now |
|---|---|---|---|
| UBFC, 33 with sound references | 6.1% (2) | 3.0% (1) | 3.0% (1) |
| UBFC held-out, 21 | 4.8% (1) | 4.8% (1) | 4.8% (1) |
| Real iPhone sittings, 7 (owner; only `a88a50e1` is known to be still) | 86% (6) | 71% (5) | 71% (5) |
| MCD front camera, 200 (seated, compressed webcam) | 50.0% | 48.5% | 51.0% |
| MCD all cameras, 600 | 42.5% | 78.7% | 80.5% |
| UBFC dimmed to half, +0.25 counts noise, 66 (less light, darker skin, farther face) | 34.8% | 48.5% | **53.0%** |
| UBFC dimmed to 0.3, +0.25 noise, 66 | 80.3% | 81.8% | 89.4% |
| UBFC pulse halved, 33 | 0% | 3.0% | 3.0% |
| UBFC pulse to 0.35, +0.1 noise, 33 | 3.0% | 21.2% | 15.2% |
| Faint synthetic pulses (QA round 1's 648) | 62.7% | 67.6% | 77.5% |

Wrong rates fell in the same rows (MCD all: 212, 17, 11 wrong; UBFC half-dimmed: 7, 2, 2; faint synthetic: 5, 0, 0). So for weak signals the change mostly trades wrong numbers for blanks, which is the right direction, but it is not "a still person gets a rate essentially every time": on half-dimmed real faces, 18 more in 100 end blank than at baseline, and on the phone 5 of 7 still end blank. Lost relative to round 1 on half-dimmed faces: 10, of which 4 had a whole-sitting evidence of 1.5 to 2.5 with no live readings (under the 2.6 bar) and the rest had 1 to 9 readings and evidence under 1.3.

One new wrong number, `low`: half-dimmed UBFC subject 14, 67.3 bpm against 80.4 (5 readings, evidence 1.45); none at baseline or round 1. Also 2 wrong `low` on MCD front (75.9 for 82.7, 90.8 for 96.0; MCD references are less reliable).

### W6. Minor, but the best lever found: two real phone sittings with steady readings are refused by the stretch count

The six phone sittings the fix round did not use: `38e3aa4b` (7 readings, 72 to 75 bpm; whole-sitting 72.8, quality 0.38) and `9c65078f` (4 readings, 79 to 82; whole-sitting 78.8, quality 0.46, prominence 3.1) end with nothing at every engine, only because 3 ten-second stretches support the peak, not 4 (face changes cost them 8 and 18 s). Their evidence would be about 2.2 and 5.2. With `wholeSittingStretches` 3 both read (73.2 and 79.6, `low`) and **0 of 1371 no-pulse controls** (1212 fresh, 24 bobbing, 42 noise, others) end with a rate (measured). True rate unknown; tuned on two sittings; offered as a lead, not a fix.

### M1. Minor (demo confusion): the waiting room says "No reading" for a patient the check-in page just showed at 102 bpm

Measured in the browser (`shots/waiting-1280-light.png`, `p-lowonly-390-dark.png`): after a `low` check-in the worklist row says State "No reading", Pulse "No reading", "Not scored", "Not yet observed"; the patients list and the patient header say "No reading"; the handoff and the timeline (102 bpm, "Lower confidence") are right. A `low` re-check after a normal check-in shows Pulse "No reading" with no "from 72" and "Last observed just now". Nothing is blank or stale, and nothing claims a number it should not, but in front of judges the operator sees 102 bpm on the check-in page and "No reading" one click later. The worklist could say "Lower confidence, repeat" in the State column.

### M2. Minor: copy and design

- Check-in page (`checkin-low-*.png`): the 102 is shown at full readout size with a dashed "Lower confidence" tag and the sentence "Too little of the sitting gave a clear pulse. Not used for trends or flags. Repeat the sitting." Short and plain; design-system `ProvenanceTag`. The tag replaces the heart-rate tile's provenance tag, so a simulated or recorded sitting loses its "Simulated" label on that tile (breathing keeps it).
- Camera summary (code only): status "Saved. Repeat the sitting" and the foot "Lower confidence. Too little … Repeat the sitting." on the same screen: the instruction twice.
- Handoff: "The latest sitting read pulse 102 bpm with lower confidence; repeat it." Fine.

### M3. Minor: a value outside the enum refuses the whole finish

Measured: `heartRateConfidence: "high"` is refused with 400, and the sitting stays "Sitting in progress" on the worklist. Correct for today's contract, but a third value added later breaks old servers; worth a note in CONTRACTS beside "additive".

### M4. Minor: new engine cost on synthetic movement with a pulse

QA round 1's nodding head with a real 64 bpm pulse, 1% and 3% swing: round 1 read 64 bpm, now nothing. Safe direction.

### M5. Minor: kept sitting files (F9), read from the code and unit tests only

- Duplicates: none (server writes by sitting id; the in-memory list is rebuilt, not appended twice).
- Growth: bounded at 5 within one app run. **Across restarts, unbounded**: files kept before the app was closed are neither offered again nor pruned (Caches only; iOS may purge). Development builds only.
- A 401 (expired device session) is classed permanent, so the file is deleted although signing in again would succeed.
- Each failed file logs up to four `console.warn`, which shows LogBox banners on a development build during a demo.

### M6. Environment, needs a person: the Mac's disk is full

During this round the data volume had 227 MB free (99 to 100% used). My simulator build failed with ENOSPC; I deleted my build directory and scratch files at once (about 3 GB of mine), leaving 3 GB free. The owner's servers, Postgres and the phone's Metro share this disk.

## 4. `heartRateConfidence` on the wire, the database and the screens

- Contracts: additive and optional on `SittingSummary`, `Sitting.summary` and `TimelineEntry`; a summary without it parses (contract test, and measured through the API: stored `normal`). Documented in CONTRACTS sections 2, 4, 6 and the schema table.
- Migration: one new file, `0004_heart_rate_confidence.sql`, one nullable column. Applied to a private copy of the shared database (87 sittings): clean, existing rows null (read as normal), a second run is a no-op. The shared database was not migrated.
- Kept out of baseline, score, flags, statistics: measured. A `low` re-check 40 bpm above a normal check-in, twice: no flag, statistics "16 of 23 sittings gave a reading" excludes them, heart-rate histogram excludes them.
- Labelled: check-in page, patient timeline, handoff (web, measured). Not labelled: worklist, patients list, patient header ("No reading" instead), nurse app chart and timeline (W2). Camera summary and nurse sitting row: code only.

## 5. Demo path with a lower-confidence result (measured on web, inferred on phone)

1. The sitting ends; the check-in page shows 102 bpm, "Lower confidence", the sentence, coverage 5%. The phone (once rebuilt) says "Saved. Repeat the sitting".
2. Waiting room: the patient is "No reading", "Not yet observed", unscored; the overdue clock runs from arrival. Handoff says what happened.
3. A repeat sitting with a normal rate becomes the baseline when the first one had no breathing rate; it does not when it had one (W1).
4. With today's phone build none of this happens: the rate is stored as normal and becomes the baseline (B1).

## 6. Regression checks

| Check | Result |
|---|---|
| `pnpm typecheck`, web lint, mobile lint | pass |
| `pnpm test` | pass: contracts 10, mobile 84, web 103, Swift 180 tests in 45 suites |
| web build (`NEXT_DIST_DIR=.next-3100`) | pass |
| smoke on 3100, own database | first run failed at step 20 (live frame not rate-limited, 200 not 429) while a simulator build loaded the Mac; second run passed all 23 steps. Timing-sensitive, not this change |
| Browser, headless Chromium, 1280 light and dark, 390 light and dark | check-in, waiting room, patients, 4 patient pages, statistics: tags and sentences as in section 4, no sideways scroll. Console: no errors or page errors; only `ERR_ABORTED` on `/api/stream` and `/api/worklist` at navigation |
| Keyboard | waiting room: Tab reaches the patient row, Enter opens the patient. Sign-in by keyboard was not completed: the 10-per-5-minutes sign-in limit tripped from my own scripts |
| Not re-walked | error states (API down mid-request, expired session) and reduced-motion differences: this range changes two views by a tag and a sentence |

**Simulator: not run.** Both project simulators ("TriageCam Camera", "TriageCam Nurse") were booted and driven by another agent's rig from `/Users/dylanmashini/Development/EmoryHacks-night-shift` (server 3200, Metro 8081, `sim-qa.sh flow` running) for the whole round; the backlog allows one app agent on the simulators at a time, so I did not touch them. A build-only simulator compile of this worktree (to compile `Payloads.swift`, derived data in `/tmp`) failed on a full disk (M6) before reaching the capture module. So: **`Payloads.swift` is still uncompiled**, and nothing in the camera or nurse role, either appearance, largest text, server unreachable, or the file shelf, was seen. W2 and M5 are from reading the code.

## 7. What I did not verify

- Anything on a device; the true heart rate of any phone sitting; whether the six other phone sittings were still.
- That my `L` and `S` models match real nodding or real ballistocardiographic motion. A recording of a person nodding, and one of a still person with a strong head-beat, replayed with `engine-cli diagnose`, would settle both.
- Skin-tone groups: no labelled data on disk. "Dimmed" rows are a model of less light and smaller pulse, not skin tone.

## 8. Recommendation

**Merge after named fixes:** (1) B1: rebuild the phone before the demo (needs a person), and make the server treat an absent confidence with fewer than 10 valid seconds as `low`; (2) W1: take the pulse baseline from the first sitting with a trusted heart rate; (3) W2: tag or leave out `low` rates in the nurse app's chart, timeline and "last observed"; then a QA round in the simulator once the disk has room and the simulators are free. M1 (worklist wording) is worth doing for the demo. W6 is a cheap, measured lead on the owner's real problem.

**For the demo:** the current engine is the best of the three: same result for the owner as round 1, now labelled, no false accepts on 1212 fresh controls, and fewer wrong numbers on weak real faces than either earlier engine. It is better than baseline, which gives the owner nothing and confident wrong numbers on weak signals. But it only exists on the phone after a rebuild; today the phone runs round 1. And on the owner's own phone, 5 of 7 sittings still end with no heart rate with any engine: the demo should plan for a repeat sitting.
