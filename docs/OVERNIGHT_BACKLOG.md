# Overnight backlog

The work list for unattended runs. Read `CLAUDE.md` first: the git rules and the quality bar there apply to everything here.

## Who does the work

The main session is an orchestrator and nothing else. The run lasts all night, and it only survives if the main session's context stays almost empty. **All development and all QA happen in subagents.**

| Role | Model | Does |
|---|---|---|
| Main session | whatever the loop runs on | Picks the next item, spawns agents, relays short reports, decides what is next |
| Development agent | Fable 5.2 (`model: "fable"`) | Builds one backlog item, or fixes one set of QA findings, in granular pushed commits |
| QA agent | Opus 5.5 (`model: "opus"`) | Runs the QA round or the regression round on work it did not write, and reports findings. Does not fix. |

Rules for the main session:

- It reads only the top of this file (down to the tier list), the log at the bottom, and `git log --oneline -20`. It does not open source files, diffs, screenshots, test output, build logs or dataset files, and it does not run builds, tests, dev servers, browsers or simulators. If it needs to know something about the code, it asks an agent and takes a one-line answer.
- It briefs agents by pointing, not pasting: the item id (the agent reads the item text here itself), `CLAUDE.md`, and the commit range or findings file from the previous step.
- Every agent's final report is at most ten lines: status (done, blocked, partial), commit range, what was verified, what was not, what is open. Detail goes into files, not the report: QA findings into `.claude/qa/<item>-round<n>.md`, progress into the log here. `.claude/` is git-ignored (commit `fdd828e`); nothing under `.claude/` is ever staged.
- The development agent updates this file (ticks the item, writes the log entry, adds to "Needs a person") and commits it. The main session does not edit files.
- One app item at a time, because agents share one database and the simulators. A tier A or tier G item may run alongside it in its own git worktree, since those touch no app code. Each agent uses its own dev-server port.
- Agents are told the git rules in `CLAUDE.md` apply to them. A development agent never QAs its own work; a QA agent never edits code.

## How to run one iteration

1. Main session: read the log and `git log --oneline -20`. If revision 1 (`rev1/*` branches) has not finished merging into `main`, or another agent's worktree is active, choose from tiers A and G only, or wait.
2. **If the log has no "Baseline regression" entry, this iteration is the baseline regression (below) and nothing else.**
3. If the "Open bugs" section has unticked entries, or the last iteration left a feature unfinished, that comes first: a development agent fixes them, a QA agent re-checks, as in the fix step below.
4. Otherwise take the highest item not yet done whose dependencies are met. Items inside a tier are in priority order. Tiers A to C matter most; do not start F before A to C are done.
5. Spawn a **development agent** (Fable 5.2) for the item. It builds in granular commits, pushes as it goes, and reports the commit range.
6. Spawn a **QA agent** (Opus 5.5) with the item id and commit range. It runs the QA round below and writes findings to the findings file.
7. If there are findings, spawn a development agent to fix them (each fix its own commit), then a fresh QA agent for another full round. Repeat until a round comes back clean. Three rounds without converging: the development agent reverts the item with `git revert`, logs why, and the loop moves on.
8. The development agent ticks the item and writes the log entry. Commit and push.
9. Every fourth item, a QA agent runs the regression round instead of a new feature starting. Its findings go to "Open bugs" and are fixed and re-checked as in step 7 before the next feature starts.

Skip an item rather than half-build it. If an item is blocked (missing key, needs the phone, needs a decision), log why and move on. Never leave `main` failing typecheck, tests or build.

### When the backlog runs out

When every item is ticked or logged as blocked, the loop does not stop and does not invent features. The goal becomes hardening what exists, in this order, repeating until the user returns:

1. **Regression.** A QA agent runs the full regression round on web and both simulators. Each pass goes deeper than the last: vary the data (empty database, 200 patients, long names, non-Latin names, missing photo), vary the conditions (slow network, server restart mid-sitting, two operators on the same patient, clock skew), and try the paths the previous pass skipped. Record what each pass covered in the log so the next one does not repeat it.
2. **Bug fixes.** A development agent fixes every finding, each in its own commit, followed by a fresh QA round as in step 7. Bugs on the demo path come first.
3. **Light polish, documented.** Only when a regression pass comes back clean. A QA agent lists small rough edges it saw; a development agent fixes them. Light means: spacing and alignment, copy, loading, empty and error states, transitions, focus and contrast, rounding and units, consistency between web and mobile, dead code and warnings. It does not mean: new features, new pages or screens, new dependencies, schema or contract changes, changes to engine behaviour or published numbers, redesigns, or refactors beyond the lines being polished. If a polish would change what a screen does or how the demo runs, it is not light: write it under "Proposed" and leave it.

Every polish gets a line in the "Polish log" section at the bottom of this file, written in the same commit: what changed, where, why, the commit hash, and a before and after screenshot path when it is visual. The user must be able to read that list in the morning and revert any single entry with `git revert`. One polish per commit, each followed by the affected part of the QA round.

Ideas bigger than light polish go into the "Proposed" section as one-line items, unbuilt.

### Baseline regression (the very first iteration)

Before any feature work, a QA agent runs the regression round on `main` as it stands, so the night starts from a known state and later breakage can be told apart from what was already broken. Wait for revision 1 to finish merging first.

- The simulator rig (B0) and dataset video (B1) do not exist yet. Run everything that does: all checks, the web demo path and every page in a browser, the API smoke test, `swift test`, a dataset eval run for the accuracy baseline, and the mobile app as far as it can be taken (typecheck, lint, unit tests, and a simulator build and launch with the simulated source if that works without the rig). Say plainly in the log what could not be covered.
- Record the baseline in the log under the heading "Baseline regression": commit hash, which checks pass, accuracy figures, and screenshot directory.
- Every confirmed defect goes into "Open bugs". They are fixed and re-checked before the first feature starts.
- When B0 and B1 land, the next regression round repeats the parts the baseline could not cover.

### Bugs: where they are recorded

The detail of each finding (steps, expected, actual, screenshots) stays in the QA agent's findings file under `.claude/qa/`. Every **confirmed** finding from a regression round, and any finding from a feature QA round that is not fixed within that same iteration, also gets one line in the "Open bugs" section of this file: an id, severity (demo path, major, minor), one sentence, the findings file path, and the commit where it was found. That section is what carries a bug from one iteration to the next: the findings files are not read by the main session, and a later iteration only knows a bug exists if it is listed there.

- Open bugs are fixed before new feature work starts, demo-path severity first.
- A bug is ticked only after a QA agent has re-checked the fix, with the fixing commit hash added to its line. Ticked entries stay in the file.
- A bug that cannot be fixed (needs the phone, needs a decision) moves to "Needs a person" with the reason.
- Minor bugs may be deferred behind tiers A to C if there are more than a handful; say so on the line. Demo-path and major bugs are never deferred.

### QA round (after every feature and after every bug fix)

Run by a QA agent. Every part that the change could affect is run; when unsure, run it.

**Checks.** `pnpm typecheck`, both lints, `pnpm test`, `pnpm --filter @triagecam/web build`, and the smoke test against a running dev server on the agent's own port.

**Web, in a browser.** Drive the feature against seeded data: happy path, empty state, error state (kill the API mid-request, bad input, expired session), 1280 and 390 px widths, keyboard only, reduced motion. Take screenshots and look at them. Console and network panels must be clean.

*Which browser.* The Claude in Chrome extension drives the user's real Chrome and has been crashing it. Treat it as optional and fall back to headless Chrome without waiting:

- Switch to headless as soon as any of these happens: a browser tool call errors or times out twice in a row, the extension stops responding, a tab or the browser disappears mid-test, or Chrome is not running. Do not relaunch the user's Chrome, do not keep retrying the extension, and do not stop to ask. Once an agent has switched, it stays on headless for the rest of its round.
- Headless means Playwright with its own bundled Chromium (`chromium.launch({ headless: true })`), a separate browser with a fresh profile that cannot touch the user's Chrome, tabs or sign-ins. Playwright's Chromium is already downloaded on this machine (`~/Library/Caches/ms-playwright`); if the package is missing from the repo, add `@playwright/test` as a dev dependency of `apps/web` in its own commit, and run `pnpm exec playwright install chromium` only if the launch reports the browser missing.
- Everything in the round still applies in headless: set the viewport to 1280 and 390 px wide, emulate reduced motion, drive by keyboard, save screenshots to the findings directory and look at them, and collect console messages, page errors and failed network requests through Playwright's `console`, `pageerror` and `requestfailed` events. A round is not clean if those were not captured.
- Never kill a Chrome process the agent did not start. Close every headless browser the agent launched before it reports.
- Write in the findings file which browser the round used. Note the first extension crash of the night once in the log, with the time.
- Once B3 exists, the Playwright suite is the default for web QA and the extension is used only for something the suite cannot do.

**Mobile, in the iOS simulator.** Required for any change under `apps/mobile` or `packages/contracts`, any API change the app consumes, and any Swift change. Uses the rig from item B0.

- Boot the two project simulators ("TriageCam Camera" and "TriageCam Nurse") with `simslim boot <udid>`. They are kept slim with `simslim on <udid> --profile apps/mobile/simslim.json` so two simulators, Metro, the web server and Postgres fit on one Mac alongside other agents. Run `simslim doctor <udid> --requires <features>` after boot; if a feature the app needs (push, networking, keychain) is reported broken, re-enable it with `simslim enable` and save it to the profile.
- Build the development build once per native change (`xcodebuild` for the simulator, or `expo run:ios`), install with `xcrun simctl install`, launch with `xcrun simctl launch`. JavaScript-only changes reload through Metro and need no rebuild.
- Reach screens by deep link (`xcrun simctl openurl <udid> <scheme>://…`, the routes are the files in `apps/mobile/src/app`) and by launch arguments for role and session. Drive taps, typing and scrolling with the UI flows from B0. Screenshot every screen with `xcrun simctl io <udid> screenshot` and look at each one.
- Walk the feature on both roles: camera role runs a sitting (simulated source, and dataset video once B1 exists) while the nurse role, on the second simulator, shows the patient arrive, update and flag. Send a push with `xcrun simctl push` and confirm the banner and the tap-through.
- Cover the states: signed out, empty worklist, server unreachable, slow network, app backgrounded mid-sitting and resumed, dark and light appearance (`simctl ui appearance`), largest Dynamic Type size, small phone (iPhone 17e) and large (iPhone 18 Pro Max).
- Read the logs: `xcrun simctl spawn <udid> log stream` filtered to the app, and the Metro output. No red boxes, no yellow-box warnings introduced by the change, no native crashes.
- Shut the simulators down with `simslim shutdown` when the round ends. Never run `simslim erase`, `delete`, `disk-clean` or `off` on a simulator the rig did not create.

The simulator cannot show: real camera capture, exposure lock, thermal behaviour, real push delivery through Apple, or Liquid Glass rendering exactly as on hardware. Each of those goes on "Needs a person" the first time a change depends on it.

**Dataset video.** Once B1 exists: for any change that touches capture, the engine, intake, sittings, the live view, face matching, the worklist or flags, run a dataset video through the real pipeline (the Mac script always; the simulator route as well when mobile or Swift code changed) and check the result against the fixture's reference: face visible in the live view, reading within 5 bpm on the resting fixtures, the elevated fixture scored in the right NEWS2 band, the negative control blank. A reading that is confidently wrong is a failed round.

**Code review.** Read the diff with the aim of breaking it: race conditions, stale live data, wrong patient shown, unrounded numbers, copy that hedges or overclaims, accessibility, contract drift between web and mobile, git rules broken.

**Report.** Findings go into the findings file, each with steps to reproduce, what was expected, what happened, and a screenshot path. The report to the main session is the count by severity and the file path. A fix is only done when the round after it is clean.

### Regression round (every fourth item)

Run by a QA agent, on web and on both simulators. Walk the whole demo path on a freshly reset and seeded database: sign up, verify, sign in, intake a patient from every dataset video fixture (B1) through both the Mac script and the simulator, watch the live sitting and compare each reading with its reference, re-check one subject to confirm face matching, confirm the negative control gives no reading, waiting room ranks, a flag fires, the handoff sentence reads correctly, acknowledge, patient detail, statistics, settings, landing page, sign out. The same path from the phone side: camera role through a full sitting on one simulator, every nurse tab on the other, the flag arriving and being acknowledged from the nurse app and that acknowledgement appearing on the web dashboard. Then every other page and screen. Then `swift test` and a dataset eval run to confirm accuracy has not moved backwards. Fix and log.

## Tier A. Measurement accuracy (the claim everything else rests on)

No UI and no phone needed, so this is always safe to work on.

- [ ] **A1. Evaluation at full size.** Download the rest of UBFC-rPPG Dataset 2 (42 subjects; only 6 are local) and a larger MCD-rPPG subset, convert, and re-run. Split subjects into a tuning set and a held-out set, fixed by a seed and recorded in the repo. Every number published anywhere comes from the held-out set. Never show the faces of UBFC subjects 21 and 27.
- [ ] **A2. Fix the negative bias.** MCD shows a bias of about -11 bpm and far worse after exercise, which points at the engine locking onto a sub-harmonic or a breathing-band component at elevated rates. Diagnose with per-recording spectra, fix in the engine, add a regression test with a synthetic elevated-rate sitting. Master plan section 7 requirements still hold: a wrong confident number is worse than no reading.
- [ ] **A3. Raise coverage without raising error.** Coverage is 57% on UBFC and 5% on MCD (after the BUG-3 fixes; 58% and 6% at the baseline). Tune on the tuning set only: candidates are CHROM or POS variants with adaptive windowing, per-region quality weighting, better detrending, a tracker that follows the peak across windows. Report the coverage and error trade-off as a curve, pick the operating point, and write down why.
- [ ] **A4. Negative controls in the test suite.** Wall, printed face, back of head and noise sittings must give no reading in at least 95% of windows. Make this a test that fails the build.
- [ ] **A5. Breathing rate evaluation.** Run the SCAMPS sample (breathing waveform per frame) and MCD (physician-counted rate). Report MAE and share within 2 breaths per minute. Fix what it shows.
- [ ] **A6. Heart-rate variability evaluation.** Derive beat intervals from the UBFC contact waveform and compare RMSSD and SDNN with `BeatAnalyzer`. Bland-Altman plot. Decide from the data whether variability is shown, shown as experimental, or hidden.
- [ ] **A7. Skin-tone equity analysis.** Run the CMU rPPG-biases set and rPPG-10 (skin type in the metadata). Report error by skin-tone group honestly, including where it is worse. This is the question a healthcare judge will ask.
- [ ] **A8. Baseline comparison.** Run the published classical methods (GREEN, CHROM, POS from rPPG-Toolbox or a clean reimplementation) on the same held-out recordings so the landing page can say how the engine compares with the literature.
- [ ] **A9. Robustness sweep.** Re-encode held-out video at lower bitrate, lower frame rate, lower light and with added motion, and chart error against each. Gives a "works down to" statement that is measured.
- [ ] **A10. Publish.** Regenerate the evaluation summary the landing and statistics pages read, with dataset, n, split and date stated beside every figure.

## Tier B. Demo that cannot fail

- [ ] **B0. Simulator test rig.** First item of the night after anything already in progress: every mobile QA round depends on it.
  - Two dedicated simulators, "TriageCam Camera" and "TriageCam Nurse", made with `simslim clone` from a stock iPhone so nothing of the user's is touched. A committed `apps/mobile/simslim.json` profile that keeps what the app needs (push, networking, keychain) and drops the rest; `simslim doctor` passes on both; `simslim measure` before and after recorded in the log.
  - A simulator development build of the app that installs and launches on both, pointed at a local web server, with the camera role on one and the nurse role on the other. Check that the app's URL scheme and deep links reach every route.
  - A way to drive the UI without a person: Maestro flows in `apps/mobile/.maestro/` if it installs cleanly (`brew install maestro`), otherwise an XCUITest target or deep links plus launch arguments. Whichever is chosen, there are committed flows for sign-in, role choice, a full sitting in the camera role, and each nurse tab, each ending in screenshots.
  - One script, `apps/mobile/scripts/sim-qa.sh` or similar, that boots both simulators slim, installs, launches, runs the flows and collects screenshots and logs into a git-ignored directory. Document it in `CLAUDE.md` under Commands.
  - Done when a QA agent with no prior context can run that script and get screenshots of every screen in both roles.
- [ ] **B1. Dataset video as the camera.** Do this straight after B0 and before any other item in tiers B to F: the QA and regression rounds depend on it. Real footage of a real face, with a known reference heart rate, goes through the same path as the phone camera, so check-in can be tested with no device. Two parts:
  - **In the simulator.** A `VideoFileSource` in `apps/mobile/modules/triage-capture/ios` that conforms to `FrameSource`, reads a video file with `AVAssetReader`, paces frames in real time on the capture clock, loops, and hands each pixel buffer to the code `CameraSource` runs after capture (face tracker, region sampler, chest motion, preview encoder, face crop). Refactor that shared path out of `CameraSource` rather than copying it. Simulator builds only (`#if targetEnvironment(simulator)`), chosen when a video path is supplied by launch argument or environment variable; with none, `SimulatedSource` stays the default. The sitting header and the server record say `source: "video"` (additive contract change, update `docs/CONTRACTS.md`), so a dataset sitting can never be mistaken for a live measurement. Build and run with `xcodebuild` and `xcrun simctl`; screenshot with `simctl io`. If Vision landmarks do not work in the simulator, log exactly what fails and rely on the second part.
  - **From the Mac, no simulator.** A script (`eval/` or `apps/web/scripts`) that plays the same video through the real API as if it were the phone: device sign-in, intake, a sitting, once-per-second readings from the engine via `video-to-sitting` and `engine-cli`, live preview frames at the relay's frame rate, finish. This is what the Playwright suite (B3) and every QA round use, because it needs no Xcode build.
  - **Fixtures.** The dataset videos are not on disk (`eval/data/*/` holds only ground truth and converted sittings). Download a small fixed set into `eval/data/fixtures/` (git-ignored): two resting UBFC-rPPG subjects, one MCD-rPPG front-webcam "before" and one "after" recording for an elevated rate, and one negative control (a video of a wall or an empty chair that you generate). Record names, sources, checksums and reference heart rates in a committed manifest. Never use UBFC subjects 21 or 27. Dataset faces never go into git, screenshots committed to the repo, the landing page, seed data or submission material.
  - **Done when:** a dataset video played through either route shows the subject's face in the live view on the check-in page, the profile photo is captured from it, face matching recognises the same subject on a second sitting and does not match a different subject, the reading lands within 5 bpm of the reference for the resting fixtures, and the negative control shows no reading.
- [ ] **B2. Demo mode.** One command resets the database and seeds a believable waiting room: a dozen patients with names, photos, reasons for visit and several hours of history, replayed through the real trend engine at adjustable speed. One patient climbs the list and flags on cue, one goes overdue. Replayed patients are marked as recorded in the data. A presenter control (keyboard shortcut or hidden panel) triggers each beat of the three-minute script.
- [ ] **B3. End-to-end suites.** Playwright tests for the web demo path and every page, and the B0 simulator flows extended to cover every mobile screen and the cross-device path (sitting on the camera simulator, flag on the nurse simulator, acknowledgement on the web). Both run in every QA round from now on.
- [ ] **B4. Live-path hardening.** Reconnect and backfill when the stream drops, phone sleeps, laptop changes network or the server restarts mid-sitting. Clear on-screen state for each case. No spinner that never ends, no stale number shown as current.
- [ ] **B5. Performance pass.** Live video latency and frame rate measured and logged, worklist with 200 patients stays smooth, no layout shift, landing page Lighthouse 95+.
- [ ] **B6. Error and empty states everywhere.** Every page, every panel, designed, not default.

## Tier C. Clinical depth (what makes judges believe a nurse would use it)

- [ ] **C1. Full NEWS2.** The camera gives 2 of 7 parameters. Let the nurse enter the rest (oxygen saturation, supplemental oxygen, systolic pressure, temperature, consciousness) from web or phone, and show the complete score with the Royal College of Physicians bands and escalation level. Camera-measured and hand-entered values are visibly distinct. Verify the bands against the published chart.
- [ ] **C2. Acuity and re-check schedule.** ESI level (1 to 5) set at intake. Re-check interval follows acuity and is editable. The worklist shows a countdown to each patient's next check and ranks overdue high-acuity patients first.
- [ ] **C3. Chief-complaint red flags.** The reason for visit is checked against a reviewed list of high-risk presentations (chest pain, shortness of breath, stroke signs, and so on) and raises priority with the reason shown. Rule-based first so it works offline and is explainable.
- [ ] **C4. AI handoff note.** With `ANTHROPIC_API_KEY` set, the server sends Claude a structured summary of one patient (values, baseline, trend, score, gaps, quality) and gets back a short SBAR note for the nurse. Guardrails from master plan section 15: only from fresh accepted readings, reassessment prompts only, no diagnosis or treatment, labelled as an AI draft, no names sent. Without the key, the templated sentence stands alone and nothing breaks. Read the `claude-api` skill before writing this.
- [ ] **C5. Patient timeline.** One page per patient: photo, intake, every sitting, every score change, flags, acknowledgements, notes, as a single readable history with charts of pulse and breathing against baseline.
- [ ] **C6. Nurse notes and actions.** Add a note, mark "seen in person", escalate, move to a room, discharge, left without being seen. Each is an event on the timeline with who and when.
- [ ] **C7. Audit log.** Every read and write of patient data recorded with user, time and action, viewable by an admin. Photos and face embeddings deleted at discharge, with a test that proves it.
- [ ] **C8. Shift handoff report.** A printable one-page summary of the current waiting room for the incoming nurse: who is waiting, scores, open flags, overdue checks.
- [ ] **C9. FHIR export.** Each sitting as FHIR R4 `Observation` resources (heart rate LOINC 8867-4, respiratory rate 9279-1) and the patient as a `Patient`, from an API route and a download button. Validate against the published schema. This is the "how does it reach the EHR" answer.
- [ ] **C10. Operations analytics.** On the statistics page: door-to-first-vitals time, time between observations, re-check compliance, flags per hour, time to acknowledge, patients waiting by acuity. Real figures from the database, with the comparison "one set of vitals at triage" baseline shown.

## Tier D. Accessibility and patient experience (the track names accessibility)

- [ ] **D1. WCAG 2.2 AA audit.** Contrast, focus order, labels, live regions for changing vitals, reduced motion, screen reader pass on every page. Fix everything found.
- [ ] **D2. Guided sitting.** During the 60 seconds the patient sees what to do and why a reading is not coming ("hold still", "face the camera", "more light"), driven by the engine's reason codes, with a calm progress display.
- [ ] **D3. Patient-facing waiting-room screen.** A public display that shows first name and initial, place in the queue and "your next check is in about N minutes", with nothing clinical on it. Separate route, safe to put on a TV.**
- [ ] **D4. Results the patient can keep.** A plain-language summary of their own readings by QR code at the end of a sitting, with what the numbers mean and what they do not.

## Tier E. Product surface and polish

- [ ] **E1. Live pulse waveform.** Show the pulse signal and its spectrum live on the check-in page as the reading forms. The single most convincing visual that the number is measured, not made up. Needs an additive field on the reading or a small side channel from the engine; update contracts first.
- [ ] **E2. Landing page, second pass.** Run the `unslop` and `frontend-design` skills over it. Interactive accuracy explorer fed by the Tier A output, a "how it works" section that animates the signal path from face to number, the clinical problem with cited figures on emergency department waits, the FDA and funded-company section with every claim linked to its source.
- [ ] **E3. Dashboard design pass.** The same treatment for every dashboard page: density, hierarchy, motion, loading skeletons, command palette (search any patient), keyboard shortcuts, toast and notification centre.
- [ ] **E4. Nurse app depth.** In the tabbed nurse app: worklist, patient detail with charts, flags inbox, hand-entered vitals (C1), notes (C6), search, settings, pull to refresh, haptics, offline cache. Typecheck, lint and unit tests only; goes on the device list.
- [ ] **E5. Multi-station and roles.** Admin, nurse and registration roles with different views; more than one camera station feeding one waiting room; station health (last frame, battery, thermal state) on a devices page.
- [ ] **E6. Onboarding.** First-run setup for a new site: pair a phone by QR code, test the camera position and light with a live quality score, done.
- [ ] **E7. Dark mode** for the dashboard, from tokens.

## Tier F. Stretch, only after A to C

- [ ] **F1. Posture-change flag.** Body-pose tracking in the capture module; a sharp sustained drop from the seated baseline raises a "posture change" flag. Develop against video on the Mac through `video-to-sitting`; device list.
- [ ] **F2. Learned model comparison.** Convert a published rPPG network to Core ML and compare it with the classical engine on the held-out set. Ship only if it wins there.
- [ ] **F3. Video-visit mode.** A patient role on the patient's own phone using the front camera, sending readings to a clinician view.
- [ ] **F4. Deterioration forecast.** From the per-patient series, a simple and explainable projection ("at this rate, score 5 in about 20 minutes") with its uncertainty shown. Rule or regression, not a black box.

## Tier G. Submission material (safe at any time, touches no app code)

- [ ] **G1. README.** What it is, architecture diagram, how to run it, evaluation results with links to the harness.
- [ ] **G2. Devpost write-up** in `docs/submission/`: inspiration, what it does, how we built it, challenges, accomplishments, what we learned, what is next. Every figure traceable to the repo.
- [ ] **G3. Demo script and video storyboard.** The three-minute live script tied to the B2 presenter controls, and a shot list for the two-minute video.
- [ ] **G4. Judge questions.** The thirty hardest questions (accuracy, skin tone, privacy, regulation, why not a pulse oximeter, liability, cost) with short honest answers and the evidence for each.
- [ ] **G5. Pitch deck.** Problem, product, proof, market, path to clearance.
## Needs a person

Add to this list; do not try to resolve these yourself.

- Anything that has to be confirmed on a real iPhone.
- Keys that are not set. `ANTHROPIC_API_KEY` is set in `apps/web/.env.local` in the main checkout (not in worktrees, which do not share that file); read it from the environment only, never print or commit it.
- A git remote, if `git remote -v` is empty. **It is empty as of 2026-11-14 05:30 EST** (baseline regression): nothing has been pushed, and commits stay local until the user adds a remote.
- `CLAUDE.md` at the repo root is untracked (it was untracked when the night started and no agent has staged it). The user should decide whether to commit it.
- `CLAUDE.md`, "Engine accuracy today": the line says UBFC coverage 58% and MCD coverage 6%. After the BUG-3 engine fixes (`af575e3`) the report says 57% and 5%; MAE 3.0 bpm is unchanged. The file is untracked and is the user's, so the fix round left it alone. The line also starts with a doubled `- **`.

## Open bugs

One line per confirmed bug: `- [ ] BUG-<n> (severity) sentence. Findings: <path>. Found at <commit>.` Tick with the fixing commit once a QA agent has re-checked it.

- [ ] BUG-1 (major) An expired session leaves the dashboard showing "Live" and signed in; actions and pages say "Sign in to continue" with no redirect or link, and "Try again" cannot succeed. Findings: `.claude/qa/baseline-round1.md`. Found at 3ea94a2.
- [ ] BUG-2 (major) At 1280 px the waiting-room worklist cuts off its Source column and the statistics patient table its Flags column, with no scroll cue. Findings: `.claude/qa/baseline-round1.md`. Found at 3ea94a2.
- [ ] BUG-3 (major) `pnpm test` exits 1: `swift test` fails `alternatingHarmonicNeverAgrees`, `repeatedColouredLightStepsDoNotMakeANumber` and `noBreathingButNoisyChest` in `QAAdversarialTests.swift` (pre-existing since 3cd1d6d; two are confident wrong readings). Findings: `.claude/qa/baseline-round1.md`. Found at 3ea94a2.
- [ ] BUG-4 (minor) One deterioration opens two flags with identical text that each need acknowledging, and the timeline lists them before the sitting that raised them. Findings: `.claude/qa/baseline-round1.md`. Found at 3ea94a2.

QA's note on order: no demo-path severity defects were found. BUG-1 and BUG-2 come first because they are on demo-path screens. BUG-3 is engine work that overlaps A2 and A4, but it is not deferred: it keeps `pnpm test` red for every change.

## Proposed

Ideas found along the way that are too big to do unasked. One line each. Not built until the user moves them into a tier.

## Polish log

One line per polish made after the backlog ran out: what, where, why, commit, screenshots.

## Log

Newest first. One entry per iteration: date and time, item, commit range, what was verified, what was not, what is open.

- 2026-11-14 06:10 EST. **Fix round 1: BUG-1 to BUG-4.** Development agent (Fable 5.2). Not signed off: a QA agent re-checks, and the bugs stay unticked until it has.
  - **Commits:** `c079c5a..837df00` on `main` (11 commits), plus this entry. Local only; there is no remote.
  - **BUG-1** (`c079c5a`). Any request refused with `unauthenticated` now reaches the app shell, which takes the dashboard down and goes to `/sign-in?next=<page and query>`. Signing out on purpose still lands on a plain `/sign-in`. Browser: session cookie cleared, then Acknowledge on `/patients/2`, a nav click, and sitting idle on the waiting room (the 10 s device refresh catches it); each landed on sign-in with the right `next`, and signing in again returned to the page.
  - **BUG-2** (`9f63829`). Table cells keep 12 px at the card edges and 8 px between columns, and the worklist's empty Source cell says "No sitting yet" (was "No finished sitting"). At 1280 px the worklist needs 955 px and the statistics table 947 px inside the 974 px card (were 1031 and 1003). Where a table is still wider than its card, a new `TableFrame` (worklist, statistics, patients list) fades the cut edge, prints "Scroll sideways for more columns" and takes keyboard focus; checked at 1120, 1024 and 390 px, arrow keys scroll it.
  - **BUG-3** (`c45afa9`, `af575e3`, `22fa122`). All three tests were right and the engine was wrong; no test was weakened. `swift test` 116 of 116, `pnpm test` exits 0.
    - `noBreathingButNoisyChest`: a fast chest move was left out of the position but the move straight back was kept, turning tracking noise into a random walk, and the band-pass cut a peak out of its slope. The frame after a fast move is now left out too, and a breathing peak is overruled when something slower in the unfiltered position is at least as strong. Noise-only sittings: 13 of 295 windows gave a rate before (5 seeds), 0 after (also 0 over 12 seeds). Real breathing in the same noise keeps every reading.
    - `alternatingHarmonicNeverAgrees`: the subharmonic check measured noise as the median of the whole band, which in a 6 to 8 s window is mostly the two peaks' own main lobes. The noise is now the median away from the two peaks. `hasSubharmonic` gained a parameter, so its unit test passes one more argument and asserts what it did.
    - `repeatedColouredLightStepsDoNotMakeANumber`: a peak is rejected when under a tenth of what the two colour-difference signals hold at its frequency survives the projection (`minimumProjectionYield`). Wall under a light cycling at 75 a minute: 34 of 472 windows read 75 bpm before, 0 after. A first attempt (reject when the two signals are in antiphase) was dropped because the eval showed it removing correct readings on real video.
    - **The published figures moved, by the harmonic fix only** (`run_eval.py ubfc --subjects 6 --rescore` and `mcd --subjects 30 --rescore`, engine-cli rebuilt): UBFC-rPPG 199 to 196 paired readings, coverage 58% to 57%, MAE 3.0 bpm, bias -2.1 and 86% within 5 bpm unchanged. MCD-rPPG all: 1873 to 1656 readings, MAE 12.1 to 11.6 bpm, bias -10.7 to -10.3, within 5 bpm 67% to 68%, coverage 6% to 5%. Front webcam at rest: MAE 3.4, bias -1.3, 83% unchanged, coverage 9% to 8%. After exercise: MAE 5.2 to 5.1, 86% to 88%. The yield check removes 1 MCD reading and moves nothing; the breathing fixes do not touch heart rate. `eval-data.json` for the landing page was regenerated (`7d45669`) and the page shows the new figures.
  - **BUG-4** (`50cf33c`, `426554e`, `6135a37`, `958af5a`, `837df00`). Server: acknowledging an open trend flag also acknowledges the patient's other open trend flag if nobody has (one `flag_acknowledged` event each; overdue flags are separate); the timeline puts entries at the same instant in causal order and shows an acknowledgement that covered both flags once. Web: trend flags with the same numbers are one card naming both rules with one Acknowledge, and the timeline's acknowledgement says which alert. No schema or wire-shape change; CONTRACTS sections 4 and 6 describe the behaviour. Browser on `/patients/2`: one card, one keyboard Acknowledge, timeline reads sitting, two flags opened, one acknowledgement; the overdue flag kept its own card and button.
  - **Checks, all at `837df00`:** `pnpm typecheck`, both lints, `pnpm test` (contracts, web with 5 new timeline tests, mobile, 116 Swift), web build: pass. Smoke on port 3102 with the push sink: pass, 23 steps, including one push for two flags, both flags acknowledged in one request, one timeline entry, sitting before flags.
  - **Browser:** headless Playwright Chromium (playwright-core in the scratchpad, the cached chromium-1234 headless shell), reduced motion, 1280 and 390 px, own database `triagecam_dev3102` seeded, own server on 3102 with `.next-3102`. Sweep of waiting room, wall view, check-in, patients, patient 2, patient 9999, statistics, flag settings and landing: no page-level sideways scroll, console clean apart from the deliberate 401s and the 404 for patient 9999. Screenshots looked at.
  - **Not verified:**
    - Anything in the mobile app. The acknowledge change is consumed by the nurse role: it refreshes after an acknowledgement, so the second flag should show as acknowledged, but no simulator rig exists (B0) and nobody has seen it. The nurse role still lists the two trend flags as two cards (their badges differ: "Score above check-in", "Change from check-in"), and may raise two banners for one deterioration. The first regression round after B0 should look at both.
    - Engine changes on a real phone, and on dataset video through the live path (B1). The breathing drift check is new behaviour on real chest motion: if a real sitting shows no breathing rate where it used to, look there first (`BreathingTracker.analyse`).
    - `SMOKE_OVERDUE=1`, `intake:sim`, and a live sitting on the check-in page were not re-run; nothing in this round touches them.
    - Sign-in is limited to 10 attempts per address in 5 minutes. A browser script that signs in for every page hits it; reuse the session (Playwright `storageState`).
  - **Teardown:** dev server stopped, `triagecam_dev3102` dropped, `apps/web/.next-3102` and the `.next` left by the build deleted, headless browsers closed. A `chrome-headless-shell` with the profile `~/.pollev-monitor` was running before this round and is not this agent's; it was left alone. The shared `triagecam` database was not touched. `eval/out` holds the re-scored report (git-ignored).
  - **Open:** QA re-check of BUG-1 to BUG-4. `CLAUDE.md`'s accuracy line is one point stale (see "Needs a person").
- 2026-11-14 05:30 EST. **Baseline regression.** QA agent (Opus 5.5), round run 04:55 to 05:30; recorded here by a development agent, which fixed nothing.
  - **Commit:** `3ea94a2` on `main` (HEAD is `main`, no `rev1/*` branches left, one worktree). No commit range: the round changed no tracked file.
  - **Checks:** typecheck pass, web lint pass, mobile lint pass, web build pass, smoke pass (22 steps, and 24 with the push sink and overdue), `intake:sim` pass (15 fps, 5 ms median capture to dashboard). **`pnpm test` fails:** the JS tests pass (contracts 7, web 82, mobile 67) but `swift test` fails 3 of 116 (BUG-3, pre-existing since `3cd1d6d`).
  - **Web:** demo path walked in headless Playwright Chromium at 1280 and 390 px on a fresh seeded database (sign up, verify, sign in, live check-in, waiting room, wall view, flag, acknowledge, patient detail, statistics, flag settings, landing, sign out), keyboard only, API-down and 500 states: pass apart from BUG-1, BUG-2 and BUG-4. The Chrome extension was not used.
  - **Accuracy** (`run_eval.py --rescore` on the sitting files already in `eval/out`; the report is unchanged): UBFC-rPPG, 6 recordings: MAE 3.0 bpm, bias -2.1 bpm, 86% within 5 bpm, coverage 58%. MCD-rPPG, 180 recordings: MAE 12.1 bpm, bias -10.7 bpm, 67% within 5 bpm, coverage 6% (front webcam at rest: MAE 3.4 bpm, coverage 9%).
  - **Mobile:** typecheck, lint and unit tests pass. The simulator build succeeds and the app installs and launches to the Expo dev launcher without a crash. Nothing past the dev launcher was reached.
  - **Screenshots:** `.claude/qa/baseline-round1/shots/` (73 files). **Findings:** `.claude/qa/baseline-round1.md`.
  - **Not covered** (the next regression round repeats these once B0 and B1 land):
    - Every mobile screen in both roles, the push banner and its tap-through, appearances, Dynamic Type, server-unreachable on mobile, and flag and acknowledge across devices from the nurse app. There is no UI driver and there are no project simulators until B0.
    - Dataset video through the live path, face enrol and match with real faces, and the negative-control video. There are no fixtures until B1.
    - Anything on a real device: camera capture, exposure, thermal behaviour, real push delivery through Apple.
  - **Side effects of the round that later agents need to know:**
    - `pod install` was run in `apps/mobile/ios` (generated, git-ignored). The Pods project there was older than `LiveUploader.swift`, so the first `xcodebuild` failed with `cannot find 'LiveUploader' in scope`; this is local state, not a repo defect. Anyone building the simulator app runs `pod install` (or `expo run:ios`) first, and B0's script should do it every time.
    - `eval/data/ubfc/subject*/` now holds ground-truth text files, without video, for UBFC subjects that were never downloaded: an eval run without `--subjects` began fetching them and was stopped, and the partial video files were deleted. A subject folder existing there does not mean its video is present. A1 fetches these subjects anyway. Pass `--subjects` to `run_eval.py` unless a full download is intended.
    - Dev servers: use a port and dist dir from the table in CONTRACTS section 9 (`.next-3100`, `.next-3101`, `.next-3102`, `.next-3200`). `apps/web/tsconfig.json`, a tracked file, already lists those dist dirs (and `.next-ui`), so Next does not rewrite it. With a dist dir that is not listed, Next adds it to that file on start; if that happens, do not commit the change unless the new port is also being added to section 9. The QA agent used 3100 and `.next-3100` for this reason. "Your own port" in `CLAUDE.md` means one of these, not an arbitrary number. (The rewrite itself is as stated in CONTRACTS and the QA findings; this entry did not reproduce it.)
    - The round used its own database (`triagecam_qa3100`, dropped afterwards); the shared `triagecam` database was not touched. The temporary simulator, Metro, the dev server and `.next-3100` were removed.
  - **Git:** `git remote -v` is empty, so nothing is pushed and commits stay local (noted once here; see "Needs a person"). `.claude/` was already git-ignored by `fdd828e`, so no `.gitignore` commit was needed tonight. `CLAUDE.md` is untracked and left alone (see "Needs a person").
  - **Open:** BUG-1 to BUG-4, all unfixed. They are fixed and re-checked before the first feature starts.
