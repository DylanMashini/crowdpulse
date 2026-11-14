# Engine reliability, QA round 3

14 November 2026. QA agent (Opus 5.5), not the author of any of this work. Branch `worktree-engine-reliability` at `5b3674c`; round 3 is `b14f989..5b3674c` (23 commits), round 2 `0029fb1..d0b1cd7`, round 1 `05629db..8b32a18`, baseline `a14e7ab`. Nothing in the engine, the apps or the server was changed by this round; the only commit is this file.

**Verdict: merge after named fixes** (section 9). The server and dashboard fixes for QA round 2 hold (section 6). They leave one new false flag on the same path: a lower-confidence check-in with breathing, followed by steady re-checks, raises "Partial score rose" (N1). The four-point table reproduces to the digit. The new engine pieces read more sittings under stepping light and a lost face, and give no false rate on 957 fresh no-pulse controls without a periodic coloured flicker (352 shuffled, 440 regular light steps, 132 video-like, 33 face gaps). But a screen whose light flickers between two levels at a rate inside the heart-rate band now produces confident wrong rates more often than round 2 did (26 against 14 of 336, section 3.1). Of the five failing phone sittings, four hold a faint rate that my own analysis also finds. None is strong enough to report without a reference, and the developer's explanation is only partly supported by the files (section 4). The capture changes are still unbuilt (section 5).

"Measured" means run in this round. "Inferred" means read from code or reasoned. The phone sittings have no reference heart rate. Everything said about them is about whether a rate comes out and holds steady, never whether it is right.

## 0. How things were run

- Engines: round 3 built from `git archive 5b3674c` into `/tmp/qa3/r3` (release `engine-cli`). Baseline (`a14e7ab`) and round 2 (`d0b1cd7`) binaries reused from QA round 2's `/tmp/qa2/{base,now}`, which were built from `git archive` of those commits. They reproduce QA round 2's and the developer's figures to the digit (section 2), which is my check that they are the right builds.
- Scripts are my own, in `/tmp/qa3/scripts`, not `reliability.py`:
  - `batch.py` and `score.py` score the sittings. Coverage is valid seconds over all seconds. "Within 5" is per reading against the reference. A sitting counts as right when its rate is within 5 bpm of its mean reference. These are the same definitions as `reliability.py`, so the numbers are comparable.
  - `gen.py` writes my controls and adversarial families with my seeds. `run.py` runs them and the `ana_*.py` scripts count the results.
  - `phone_facts.py` and `phone_spec2.py` measure the phone sittings without using the engine.
- Data: UBFC sitting files in the main checkout's `eval/out/ubfc` (split from `eval/split.json`), and the seven phone sittings (`"source":"camera"`) in the main checkout's `apps/web/recordings`. Derived sittings were written to `/tmp/qa3/work` and deleted after each run.
- `engine-cli diagnose --config` takes a **file** path, not inline JSON. Results 11.9 quotes inline JSON for `reliability.py`, which writes the file itself.
- Web, API, checks and smoke were run by a separate QA sub-agent (Opus 5.5) in this worktree, with its own server and private database. Its results are in section 6. Its screenshots are in the main checkout's `.claude/qa/engine-reliability-qa3-web/shots/`, and its scripts are in `/tmp/qa3w`.

## 1. Findings by severity

| Id | Severity | One line |
|---|---|---|
| N1 | Wrong number risk, demo path | After a lower-confidence check-in with breathing, re-checks at 100 and 101 bpm open a false "Partial score rose" flag. The score rule still takes the check-in as its baseline (6) |
| N2 | Wrong number risk | A client stating `"normal"` on 3 valid seconds is believed and becomes the baseline (6) |
| N3–N6 | Minor | Wall-view text overflow; "check-in" copy where the baseline is a re-check; "No heart rate was accepted" beside a lower-confidence 102; counts of patients "without a reading" still include lower-confidence ones (6) |
| R1 | Wrong number risk | Coloured light flickering between two levels 50 to 75 times a minute, on the phone's own noise with no pulse, ends with a confident rate at the flicker rate in 26 of 336 sittings (round 2: 14). Carrying levels across cuts causes most of the increase (3.1) |
| R2 | Wrong number risk (process) | The held-out set has been looked at and used to decide too often to count as untouched. Its "sittings with a rate" row (20: 17 right, 3 wrong) has not moved across four engines, so it can no longer tell rounds apart (2.2) |
| R3 | Minor | A face lost for up to 2 s is bridged even when another person comes back, whatever the track id. The previous person's rate stays live for 1 to 4 s in about a third of swaps (3.3) |
| R4 | Minor (claim) | "Forehead half as bright as the cheeks" does not separate passing from failing sittings: the best sitting has it (0.54). Three failures have frames changing by more than 5% from one frame to the next, spread over 20 to 30 s mid-sitting. That contradicts "the owner was sitting still", unless single-frame light steps cause them (4.1) |
| R5 | Minor | The clipping guard can leave a sitting in "exposure adjusting" for good if two stops darker still clips (inferred, unbuilt; the developer notes it in "Needs a person") (5) |
| M1 | Blocks demo if the order is wrong | Merging into `main` in the main checkout while its dev server on 3000 serves the phone, before the shared database is migrated, breaks the server: the trend engine selects whole `sittings` rows and the column does not exist there (4 migrations applied). Migrate first (7) |
| M2 | Process | A push of `main` that touches `apps/web` now runs the production deploy, migrations included. Merging this branch is a production release (7) |

## 2. The four-point table, reproduced (measured)

### 2.1 Figures

| | Baseline | Round 2 | Now | Developer's "Now" |
|---|---|---|---|---|
| Phone sittings ending with a rate (7) | 1 | 2 | 2 (`2e056c81` 92.1 normal, `a88a50e1` 101.7 low) | same |
| Phone valid seconds, all seven | 14 | 31 | 37 | 37 |
| UBFC tuning, 12 sound: coverage / within 5 / MAE | 62.5% / 95.5% / 2.02 | 68.1% / 96.0% / 1.96 | 68.8% / 95.3% / 2.02 | same |
| same: sittings with a rate (right, wrong) | 11 (10, 1) | 12 (11, 1) | 12 (11, 1) | same |
| UBFC held-out, 21: coverage / within 5 / MAE | 59.8% / 88.9% / 2.51 | 60.4% / 89.8% / 2.38 | 61.5% / 89.2% / 2.39 | same |
| same: sittings with a rate (right, wrong) | 20 (17, 3) | 20 (17, 3) | 20 (17, 3) | same |
| Held-out with the three-stretch rule on | | | 21 (17, 4): subject14 67.9 low against 80.1 | 21 (17, 4) |
| Half-dimmed real faces, 0.25 counts of noise, my draw (seed 991), 66: blank / right / wrong | 22 / 33 / 11 | 31 / 30 / 5 | 30 / 31 / 5 | 37 / 27 / 2 (their draw) |
| Dimmed to 0.3, my draw (seed 992), 66: blank / right / wrong | 48 / 12 / 6 | 59 / 5 / 2 | 59 / 5 / 2 | 58 / 5 / 3 |
| Fresh block-shuffled controls, my seed 31415, 8 draws of 37 UBFC and 7 phone sittings (352): end with a rate / live seconds | 9 / 0.36% | 0 / 0.10% | 0 / 0.11% | (their sets: 0 of 588, 0 of 636) |

Every engine figure the developer gives reproduces exactly on the same files. Dimmed faces are random draws, so mine differ. On my draw this round is no worse than round 2 (30 blank against 31). It is still clearly more often blank than baseline (22), and 5 of the 36 that end with a rate are wrong.

The three held-out sittings that end wrong are the same at every engine, and all three are `normal`: subject32 113.7 against 107.3, subject3 92.7 against 101.2, subject30 100.2 against 93.0.

### 2.2 How much the held-out figures can still be trusted (R2)

These are the looks at the 21 held-out subjects I can find in the documents: A1 (published), round 1 (once), round 2 ("second look", results 10.6), QA rounds 1 and 2 (scored and reported back to the developer), and round 3 (twice, the second after a decision). Subject14 has been discussed by name in every round. The held-out dimmed set (42) and the held-out controls (636) were also used to decide.

- Round 3 switched the two rules off *because* each cost one held-out result. Rejecting whatever hurts held-out biases held-out upward, here by at most one sitting. I reproduced the three-stretch rule's cost: 21 (17, 4). The region-agreement rule's cost falls on a held-out control, not a UBFC sitting.
- The row the claim rests on, sittings with a rate, is 20 (17, 3) at all four engines. The coverage moves (59.8% to 61.5%) and within-5 moves (88.9%, 89.8%, 89.2%) are a few readings out of about 800, over 21 people. Nothing in this round can be told apart from round 2 on held-out.
- So the held-out figure is still a fair statement of where the engine stands on UBFC: the engine was not tuned towards it, and the published row has not moved. It is **no longer clean for choosing between sitting-level rules**, and it cannot carry another decision.
- The next rule needs data nobody has looked at: UBFC subjects 34 to 38 (on the tuning list, no sitting file on disk), or new phone sittings with an oximeter.
- Three of the 20 held-out rates (15%) are confident and 6 to 9 bpm off. That belongs next to any published accuracy figure.

## 3. The new engine pieces under attack (measured unless stated)

### 3.1 A screen facing the patient (R1)

My model of a screen multiplies the light on the face by a level that changes every *period* seconds:

- "random": each change goes to a new level within ±depth.
- "alternate": the level switches between two values depth apart, like a blinking element or a looping animation.
- Red moves by `colour` times the change, and blue a little the other way. Ramp 0 to 0.2 s, optional jitter.

The base is a real sitting shuffled in blocks of 0.7 to 1.6 s, which removes the pulse. A rate within 3 bpm of the change rate, the alternation rate, or half or double either, counts as "at the step rate".

| Family | n | Baseline | Round 2 | Now | Now without levels across cuts |
|---|---|---|---|---|---|
| Random screens, mixed settings, all 44 bases | 176 | 0 | 1 (low) | 1 (**50.1 normal**, at the alternation rate) | 1 (low, not at the step rate) |
| Alternate, 2 to 5%, every 0.4 to 1 s, all bases | 440 | | 2 normal | 2 normal | 2 normal |
| Random levels, 5 to 15%, every 0.7 to 1.2 s (a page that changes each second) | 440 | | 0 | 0 | 0 |
| **Alternate, 1 to 3%, every 0.4 to 0.6 s, phone bases only** | 336 | 34 (34 confident) | 19 (14 confident) | **30 (26 confident)** | 21 (17 confident) |
| Alternate on the forehead only, 1 to 10%, phone bases | 224 | 20 | 6 (2 confident) | 5 (1 confident) | |
| Video-like: scene cuts every 1.5 to 6 s, slow drift, colour per scene | 132 | | 0 | 0 | |

- Every rate in the alternate families sits at the flicker's fundamental (50, 60, 67 or 75 bpm), with 10 to 19 valid seconds. Every confident one has a colour change: none of the 112 with brightness only gave a rate. The brightness checks catch plain brightening and darkening. They miss light whose colour changes as well, which is what a screen gives.
- It happens on the phone's own files and almost never on UBFC's. The phone's quiet stretches are much less noisy, so a 1% flicker stands out cleanly.
- This round takes the family most of the way back to baseline (30 against 34; round 2 had 19). Switching off `levelsAcrossCuts` alone brings it to 21, so carrying levels across cuts causes most of the regression.
- What this does **not** show is that a real screen does this. It takes a regular two-level flicker at 0.8 to 1.25 Hz that shifts the colour of the light on the face by 1 to 3%. A page changing every second, scene cuts and random content gave nothing (0 of 1,012). A blinking element, an animation, or a video with a beat could do it. The owner's sittings show no such rhythm: their steps come a few times a minute, not twice a second.

With a real pulse underneath (UBFC, 33 sound subjects × 8 screens = 264):

| | Right | Wrong |
|---|---|---|
| Baseline | 60 | 13 |
| Round 2 | 95 | 19 |
| **Now** | **112** | **23** |
| Now without levels across cuts | 96 | 22 |

The new pieces read many more sittings under stepping light, at the same share wrong (17%). Only 2 of the 23 wrong rates are near the step rate. Most come from subjects that read wrong with no screen at all (subject3, 30, 32).

### 3.2 Per-region cutting

Forehead-only flicker (above) is no worse than in round 2. In this round I found no case where leaving two regions out lets the third invent a rate. Cutting regions separately is why more of the phone sittings is read (31 to 37 valid seconds). None of my no-pulse families gained a confident rate except R1.

### 3.3 Bridging a lost face (R3)

In `PulseTracker.ingest`, a changed track id resets the history only when no frame was lost. After any frame without a face, a new track that appears within `bridgeSeconds` (2 s) carries on, whoever it is. The code comment says "nobody changes places with the patient in that time". Requirement 10 and CONTRACTS describe a new face as a reset.

I spliced pairs of sound UBFC subjects whose rates differ by 15 bpm or more: 30 pairs × gap {0.1, 0.6, 1.5, 1.9 s} × {same, new track id} = 240 sittings. A is the first person, B the one who comes back.

| | Round 2 | Now |
|---|---|---|
| Live seconds after B arrived, at A's rate rather than B's | 61 | 215 |
| Sittings showing A's rate after B arrived | 8 (all one pair, where B itself reads near A's rate) | 94 |
| How long, in those 94 | | 1 s in 51, 2 s in 17, 3 to 4 s in 15, 5 to 9 s in 11 (the 7 to 9 s cases are that same pair) |
| End of sitting: B / A / other / blank | about a third each, the same at both | the same |

So after a person swap through a short gap, the previous person's rate stays on screen for a second or a few. The final number is no worse, because a sitting with two people in it was already mixed. This is minor, since the operator starts one sitting per patient. The documentation should still say that another face *is* bridged after a gap.

I also tested a gap that hides a move. Same person, face lost for 0.3 to 1.9 s every 6 to 12 s. After each gap every region comes back 0.85 to 1.15 times as bright, with 0.5 s of 3% jitter. 33 sittings with a pulse and 33 shuffled:

| | Round 2 | Now |
|---|---|---|
| With a pulse: right / wrong / coverage | 2 / 0 / 8.1% | **25 / 3 / 29.6%** |
| No pulse: end with a rate / live seconds | 0 / 0 | 0 / 0 |

Bridging does what it is for. Of the three wrong, two are subjects that read wrong anyway (subject3, subject30). One is new: subject10, 117.9 against 109.9, `normal`.

## 4. The five phone sittings that fail (measured; no reference)

### 4.1 What the files show, sitting by sitting (`phone_facts.py`, my thresholds)

- "Steps": all three regions' brightness moves 3% or more, the same way, within a quarter of a second.
- "Moving" frames: a region's brightness changes by more than 5% from the previous frame. That is either movement or a single-frame step in the light; without the face box, these files cannot tell which.

| Sitting | Steps | Forehead / cheeks | Red mean, max | Face lost; track changes | Moving frames: first 6 s, middle (span), last 6 s | Engine now |
|---|---|---|---|---|---|---|
| `a88a50e1` 11:26 (passes, low) | 6 | 1.04 | 146–160, 182 | 0; 0 | 0, 0, 0 | 101.7 low |
| `2e056c81` 13:38 (passes) | 4 | **0.54** | 65–127, 212 | 1 (0.02 s); 1 | 41, 3, 0 | 92.1 |
| `60d28943` 13:37 | 17 | 0.44 (0.37–1.15) | 73–133, 209 | 4 (0.1–0.8 s); 4 after gaps | 9, **196 (12–42 s)**, 81 | none (peak 90.6) |
| `7bcf632a` 13:40 | 4 | 1.10 | **234–242, 252** | 1; 1 without a gap | 0, 0, 38 | none |
| `9c65078f` 13:41 | 14 | 1.13 | 160–183, 251 | 1 (1.1 s); **6 without a gap**, 2 after | 36, 17, 112 | none (79.5, 3 stretches) |
| `38e3aa4b` 13:42 | 16 | 1.12 | 149–170, 240 | 2 (1.3, 0.3 s); **6 without a gap** | 59, 125 (19–40 s), 49 | none (72.7, 2 stretches) |
| `1c542d63` 14:23 | **24** | 0.51 | 55–113, 180 | 2 (0.02, 0.6 s); 2 | 57, 158 (15–33 s), 0 | none (84.9, evidence 1.15) |

Frame timing (60 fps) and exposure lock (90 to 100% of frames) agree with the developer. Against the developer's account in results 11.2:

- **Clipped red in `7bcf632a`: supported.** Its region means are 234 to 242. Two more sittings run close: `9c65078f` peaks at 251 and `38e3aa4b` at 240. The new guard's threshold (a region mean over 235) catches only `7bcf632a`.
- **Light that steps: supported as a difference, not shown to be the cause.**
  - The two sittings that pass have the fewest steps (4 and 6). The failures have 14 to 24, apart from the clipped one.
  - At the steps, red over green moves by anything from −11% to +12%, in both directions, and blue moves too. That fits a light source changing colour, but it also fits a face box that moved and put the regions on different skin.
  - These files cannot tell the two apart; the new face-box field can. "Most likely a screen" is a reasonable guess, not something the files show.
- **Forehead half as bright: not what separates them.** The best sitting, `2e056c81`, has its forehead at 0.54 of the cheeks. The engine still reads it there: my POS on the forehead alone gives 91.8, matching the cheeks. Three sittings have a dark forehead and four do not. Hair or shadow costs a region, not the sitting.
- **Face lost and renumbered: supported, and understated for two.** `9c65078f` and `38e3aa4b` each have six track changes with no frame lost. Each resets everything, because the bridge does not apply without a gap; `38e3aa4b` spends 18 s warming up. The cause is either another face in the picture or the detector jumping.
- **Movement at the start and end: supported.**
- **"The owner was sitting still, and the recordings agree": not supported for three sittings.** `60d28943`, `38e3aa4b` and `1c542d63` have 125 to 196 frames that each changed by more than 5%, spread over 20 to 30 s mid-sitting. Either the person or the phone moved, or the light changed within single frames. Either way the picture was not still.

### 4.2 Is a rate recoverable? (`phone_spec2.py`, not the engine)

The method, fixed before I looked at the results:

1. Cut each region wherever a frame changes by more than 1.5%, with 0.2 s either side.
2. Normalise each remaining stretch of 2 s or more by its own 1.6 s running mean.
3. Turn it into POS, CHROM and green, band-passed to 54 to 180 bpm.
4. Take a periodogram of the whole minute, the longest window available. Use 10 s and 20 s windows to measure stability.
5. Use 20 block shuffles of the same stretches as a null.

I checked the method on UBFC first: subject1 107.4 (reference 108), subject12 65.3 (67), subject14 75.6 (77). **But subject3 gave 82.0 against 102.** At a prominence of about 18 and a shuffle p of 0.05 or less, this method can also be confidently wrong. Prominence on good UBFC sittings is 100 to 480; on the phone it is 10 to 60.

| Sitting | What the whole minute shows | Agreement | Prominence | Engine's whole-sitting peak |
|---|---|---|---|---|
| `60d28943` 13:37 | **92.1 to 92.5** in the right cheek and both cheeks together, in POS, CHROM and green; p 0 to 0.05; 20 s windows at it 75 to 100% | **matches `2e056c81` (91.8) one minute later** | 13 to 29 | 90.6 |
| `9c65078f` 13:41 | **77.8 to 78.0** on the forehead, POS and CHROM, p 0; 20 s windows at it 80 to 90% | close to `38e3aa4b` one minute later | 16 to 42 | 79.5 |
| `38e3aa4b` 13:42 | **73.4 to 75.1** on the forehead and cheeks, POS and CHROM, p 0 to 0.2, from seconds 6 to 18 only (18 to 37% usable) | close to `9c65078f` | 10 to 36 | 72.7 |
| `1c542d63` 14:23 | **82.2 to 82.6** in the cheeks, all three methods, p 0 to 0.05; left-cheek green 10 s windows at it 88% | nothing near in time | 18 to 45 | 84.9 |
| `7bcf632a` 13:40 | nothing: under 4 s usable in any region | | | |
| `a88a50e1` 11:26 (engine 101.7 low) | no stable peak: 102 to 104 appears in several regions and methods, never with p under 0.15 | | under 10 | 103.1 |

- **Answer: a rate is visible in principle in four of the five failures:** about 92 (`60d28943`), 78 (`9c65078f`), 74 (`38e3aa4b`) and 82 to 85 (`1c542d63`).
  - It comes from the cheeks in the first and last of these, and from the forehead in `9c65078f`.
  - It shows best in a whole-minute spectrum of the quiet stretches.
  - Green alone finds the same rate where the signal is clearest and drifts to 55 to 65 elsewhere, so it does not beat POS or CHROM.
  - The two pairs recorded a minute apart agree with each other (92 and 92; 78 and 74). That is the best evidence these peaks are a pulse.
- **They are not numbers to report.**
  - Their prominence is the level at which my method got UBFC subject3 wrong by 20 bpm.
  - Any rule that accepted them would be chosen by looking at these seven files, which have no reference. The developer's three-stretch rule recovered `9c65078f` and cost one wrong held-out sitting (reproduced).
  - Without a reference, nobody can say whether 92 falling to 74 over five minutes is a heart settling or an artefact.
- **What this means for the owner: the fix is the setup.**
  - A still minute in steady light gives the cheek prominence of `2e056c81` (55 to 64), which is enough for the engine as it stands.
  - More signal per sitting will come from the room: the light, no screen, nobody else in frame, nothing touching the phone. Not from more maths.
  - A few sittings recorded with an oximeter would settle whether these faint peaks are real. Only then is a looser rule worth measuring.
- The `a88a50e1` reading (101.7, low) is the one my method cannot confirm. It is correctly labelled low and kept out of trends.

## 5. Capture changes and the simulator (not run)

**Not built and not run, for lack of disk.**

- Free disk when I checked was 2.9 to 3.5 GB on a 460 GB volume, while the web sub-agent's production build was also running.
- The only derived data for this worktree (`DerivedData/TriageCam-ekrly…`, 2.3 GB) is a `Debug-iphoneos` device build, so a simulator build would start from nothing.
- The main checkout's simulator-capable derived data is 4.1 GB, and QA round 2's simulator build ran out of disk.
- A build was likely to fill the disk that the owner's dev server, Postgres and Metro share, so I did not start one. Both project simulators were shut down and free, so they were not the obstacle.

So none of these was seen: the camera role, the nurse role, either appearance, the largest text size, server unreachable, the two new operator messages on the phone, kept files across restarts, the face-box and ISO fields in a real file, or the clipping guard.

From the code (inferred):

- `ExposureController` refuses to lock while a region's strongest channel averages over 235, and lowers the exposure target a third of a stop every 0.5 s, down to −2.
- If the face still clips at −2 (a lamp close to the face), `good` never becomes true and the sitting stays in "exposure adjusting" (R5). The developer's escape, setting `clipped` to 256, needs a rebuild.
- `CameraSource` adds the face box, ISO and shutter time to every frame.
- Zod on `main` strips unknown keys rather than refusing them, so a phone rebuilt from this branch still works against a server on `main`. But `heartRateConfidence` would then be dropped and a low rate stored as normal. The server must be updated before the phone.

## 6. Server, dashboard and checks (web sub-agent)

Run by a QA sub-agent (Opus 5.5) against the **production build** (`next start` on 3100, `.next-3100`) with a private database `triagecam_qa3w`, migrated and seeded. Env came from the main checkout without printing it, with mail, push and Anthropic keys removed. The browser was headless Playwright Chromium with reduced motion, capturing console, page errors and failed requests. Screenshots are in the main checkout's `.claude/qa/engine-reliability-qa3-web/shots/`. The sub-agent was not allowed to write report files, so its findings are copied here. Everything below is measured unless stated.

**Checks.** `pnpm typecheck`, web lint, mobile lint, `pnpm test` (contracts 13, mobile 93, web 106, Swift 200) and the web build all pass. **Smoke against the production build:**
- With `NODE_ENV=production` it fails at step 4: with no mail key, production neither returns nor logs a verification link.
- It would also fail at step 9: production refuses sitting-file uploads with 403 (`server/sittings.ts:177`).
- With `NODE_ENV=test next start` (the env schema accepts it, and the served bundle is still the production build) plus `SMOKE_SERVER_LOG`, **25 of 25 steps pass**.
- The smoke failure message says "the server has RESEND_API_KEY set", which points the wrong way.

### QA round 2 findings

**B1 (old client without the field): fixed.**

| Finish without `heartRateConfidence` | Stored |
|---|---|
| 10 of 60 valid s | normal |
| 9 of 60 valid s | low |
| 9.4 valid s | low |
| 9.9 valid s | **normal** (rounds to 10; harmless, since engine coverage is whole seconds over whole seconds) |
| duration 0 | low |
| `heartRateConfidence: null` | derived, as if absent |
| coverage null or missing, duration missing | 400, sitting stays unfinished |

`main`'s exact finish payload is accepted: 79.5 bpm on 4 of 46.7 s, and the 61.5 whole-sitting case, are stored low; 72 bpm on 50 of 60.3 s is stored normal. So the server on this branch is safe with the round 1 app on the phone and with a build from `main`.

**W1 (low check-in with breathing, then 55, 85, 86): fixed for the pulse baseline.**
- After 55: base 55. Handoff: "pulse 55 bpm now, lower confidence at check-in".
- After 85: "55 bpm at a re-check, 85 bpm now", with no flag. This is what the nurse and the dashboard see in between.
- After 86: `baseline_shift` opens, titled "Moved from baseline". The worklist reads "from 55 (+31), 16:33 re-check".
- A low check-in without breathing makes the next normal rate the baseline. A low re-check after a normal check-in is tagged, with no trend and no flag.

**M1, M2 (labels on every surface): fixed.** A lower-confidence pulse shows its bpm, the "Lower confidence" tag and the state "Lower confidence, repeat" on the worklist, wall view, patients list, patient header, timeline, statistics rows and handoff. The check-in tile keeps "Simulated" beside "Lower confidence". The waiting room and the check-in page now agree. No sideways scroll and no console or page errors at 1280 or 390 px, light or dark.

**M3: fixed.** CONTRACTS notes it, and `"high"` gives 400.

**The two new operator messages** ("Signal too weak. Keep still, more light" and "Too much movement. Keep still") are seen on the check-in page during a live sitting.

**Browser regression.**
- Keyboard-only sign-in completes (QA round 2 could not do this).
- Keyboard-only from the waiting room: patient row, open, Acknowledge, "Acknowledged by …".
- A wrong password shows its message. Bad flag-settings input is refused with a message.
- An expired session redirects with "Your session ended…".
- With the server killed mid-acknowledge, the card says "Cannot reach the server…". The waiting room shows its refresh banner and recovers within 30 s of the server restarting.
- Console: only expected 401s, connection-refused errors while the server was down, and `ERR_ABORTED` at navigation.
- Not from this round: the header keeps a green "Live" while the server is down.

### New findings

| Id | Severity | Finding |
|---|---|---|
| **N1** | **Wrong number risk, on the demo path** | **A false "Partial score rose" flag.** Check-in 101.5 `low` with breathing 16, then re-checks at 100 and 101 `normal`: `score_rise` opens, score 0 at check-in and 1 now. The same readings after a normal 101 check-in give no flag. `scoreRise` and `scoreAtCheckIn` still use the first observation, which here holds breathing only, while `baselineShift` now takes a baseline per parameter. The same happens with a check-in that has breathing and no pulse. Scope as W1: a low or missing pulse at a check-in that has a breathing rate. On the phone breathing is usually absent; on simulated or recorded demo sittings it is present. |
| **N2** | Wrong number risk (by contract) | A client that sends `heartRateConfidence: "normal"` with 3 valid seconds is believed: stored normal, used as the baseline, and the handoff says "102 bpm at check-in". The server never applies its own rule when the field is present. Suggested: store the lower of the stated value and the server's rule. |
| N3 | Minor | Wall view: "from 74 at the 16:36 re-check (+34)" is nowrap and runs past its tile by 19 to 41 px at 1024, 1440 and 1920 (`wall-overflow-1440.png`). |
| N4 | Minor copy | "check-in" survives where the baseline is a re-check: the flag card ("… 2 min after check-in"), "Partial score rose from check-in", and flag settings ("From check-in"). A second `check_in` sitting that becomes the baseline is called "at check-in" and loses its lower-confidence note. |
| N5 | Minor copy | Check-in page: "No heart rate was accepted" and "Waiting for the first reading" next to a 102 bpm lower-confidence result (`checkin-low-result-390-dark.png`). |
| N6 | Minor | The waiting-room heading ("4 without a reading") and the statistics tile still count lower-confidence patients as "no reading". |

**Not verified by the web sub-agent:** the nurse and camera apps (W2 and M5 rest on unit tests and code), push, face match, devices.

**Teardown (sub-agent):** server on 3100 stopped, `triagecam_qa3w` dropped, `.next-3100` deleted, browsers closed. The shared database, port 3000, ngrok, Metro and the simulators were not touched.

## 7. Merge readiness (measured unless stated)

- `git merge-tree --write-tree HEAD main` (`main` at `3c45e75`) gives **one conflict, in `docs/OVERNIGHT_BACKLOG.md`**: two hunks where both sides added entries ("Needs a person" and the log). Keep both sides. `apps/web/scripts/smoke.mts` and `docs/CONTRACTS.md` merge cleanly, and the merged smoke keeps both sides' steps: `main`'s health route, security headers and `Retry-After`, and the branch's confidence steps.
- I extracted the merged tree (`9840dc6`, conflict markers in the backlog only) to `/tmp/qa3/merged` and installed it offline. `pnpm typecheck` passes. The JS tests pass: contracts 13, mobile 93, web 128 plus 1 skipped that needs a database. The merged tree was not built or smoke-tested. `main` changed no dependency, no migration and nothing under `packages/signal-engine`, so the branch's Swift tests stand for it.
- Compatibility of this branch's server with the app now on the phone (round 1 engine, no confidence field) is covered in section 6 under B1. Main's app build sends the same finish shape, so the same path covers it.
- `main` has gained a production deploy since this branch started. A push to `main` that touches `apps/web` or `packages/contracts` builds, **runs migrations on production** and deploys (`deploy.yml`, `infra/deploy.sh`). Migration 0004 adds one nullable column, so that is safe, but merging is also a production release.
- The shared `triagecam` database has 4 migrations and no `heart_rate_confidence` column (read-only check). The branch's trend engine reads whole `sittings` rows (`server/trend/engine.ts:59`). If the merge lands in the main checkout while its dev server on 3000 runs, the server reloads with a schema naming a column that does not exist. Inferred: worklist and trend queries then fail until `pnpm db:migrate` runs. Main's code ignores an extra column, so migrating first is safe.

**At merge, in order:**
1. Run `pnpm db:migrate` on the shared `triagecam` database **before the dev server on 3000 serves a request with the new code**. This is safe for the running `main` server.
2. Merge with `git merge --no-ff` and resolve the two backlog hunks by keeping both sides. Push, knowing this deploys to production with migrations.
3. Check that the dev server on 3000 has reloaded, then run `pnpm --filter @triagecam/web smoke` against a server with a private database.
4. Rebuild and reinstall the development build on the phone from merged `main`, **after** the server is updated. Until then, the server's B1 fallback labels the old app's thin sittings low.
5. Run one live sitting on the phone through ngrok, and check that the check-in page, the waiting room and the nurse app agree.

## 8. What I did not verify

- Anything on a device or in the simulator (section 5).
- The true heart rate of any phone sitting.
- Whether my screen model matches a real screen, or whether the owner's steps come from a screen at all.
- The merged tree as a running server.
- Skin-tone groups: there is no labelled data on disk.

## 9. Recommendation

**Merge after named fixes:**

1. **R1.** Either switch `levelsAcrossCuts` off, or show it is safe on a coloured two-level flicker in the band. Show that with a family like mine on phone-noise bases, chosen on tuning data, since held-out cannot carry another decision. Switching it off gives up part of the stepping-light gain in 3.1 (112 against 96 right of 264), so the owner should see this trade. Keeping it on is defensible if the demo has no screen facing the patient, which the checklist requires anyway.
2. **N1:** score the partial NEWS2 rise from the same per-parameter baselines that the baseline-shift rule now uses, so that a lower-confidence check-in cannot give a false "score rose" flag. Add N2: when the client states a confidence, store the lower of that and the server's own rule. N3 to N6 are worth doing before the demo; they are copy and layout only.
3. The merge order in section 7: the migration before the merge reaches the running server, and the phone after the server.
4. Correct the documentation that says another face is never bridged (R3).

None of the engine changes produced a false rate on the 957 controls without a periodic coloured flicker, and the server and dashboard now treat a thin rate the same way on every surface. Merged in that order, the branch is better for the demo than `main`.

## 10. Demo setup checklist (from what the files show)

1. **Light:** one steady source in front of the face, such as a lamp or a window behind the phone, not overhead. The two sittings that passed had 4 and 6 brightness steps in a minute; the failures had 14 to 24.
2. **Screens:** nothing with changing content faces the patient: not the laptop with the dashboard, a monitor or a TV. Turn it away or dim it. A blinking or animated screen is the one case in my controls that produces a confident wrong rate (R1).
3. **Not too bright:** if the face looks washed out on the camera screen, move the light back. `7bcf632a` clipped red at 242 and gave nothing; two more came close (240 and 251).
4. **Framing:** the face large and centred, nobody else in the picture, no face on a poster or screen behind the patient. Two sittings each lost 18 s to the tracker switching faces with no frame lost.
5. **Hair:** off the forehead if that is easy. It costs one region, not the sitting (`2e056c81` passed with a dark forehead).
6. **Stillness:** the patient leans back with hands in the lap and does not talk. Nobody touches the phone after starting; start and stop from the dashboard if possible. The first and last 6 s of most sittings are disturbed.
7. **A full minute:** the sittings that stopped at 18 s and 47 s gave nothing or too little.
8. **When a sitting ends blank or "Lower confidence":** say the camera needs a steadier picture, fix the light or the screen, and repeat once. Do not repeat more than once in front of judges; show a recorded or simulated sitting instead, labelled as such. Plan for a live sitting ending blank: 5 of the 7 stored phone sittings did.
