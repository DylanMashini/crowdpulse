# Triage Cam: master plan

EmoryHacks 2026, healthcare track. Working name. Written Friday 13 November 2026, after a four-way adversarial review of the original product plan (`TriageCam_Product_Plan.docx`). This document replaces that plan.

## 1. What we are building

A contact-free vitals station with a trend view for the waiting room.

1. **Check-in mode.** An iPhone on a 3D-printed mount on the back of the laptop lid, rear camera facing the patient. The patient sits for 60 seconds and gets heart rate, breathing rate and (experimentally) heart-rate variability, shown next to a reference device.
2. **Waiting-room mode.** A nurse worklist built on each patient's time series since check-in. It ranks patients by trend against their own baseline and by how long they have gone unobserved, and notifies the nurse who to walk to first.

**One-sentence pitch:** patients are measured once at the front desk and then wait for hours; we make a repeat measurement take 60 seconds with no contact and no consumables, and we turn those measurements into a list of who to look at next.

**Also in scope, after the heart-rate gate (section 15):** collapse detection, video-visit mode, face recognition for re-checks, and LLM-written clinical suggestions.

**What we are not building this weekend:** eight faces at 3 metres and two-camera hand-off.

## 2. Where we stand

Nothing is built. Everything in this plan is written from scratch during the event.

## 3. Before any code

- **Reference devices.** See section 9. The fingertip oximeter alone cannot feed a live plot or validate variability.
- **Fix the stream format and schema** (section 6) before parallel work starts.

## 4. Check-in mode

### Physical setup

- Phone on the back of the laptop lid, rear main camera, landscape, about 0.6 to 0.9 m from the patient.
- Face and upper chest both in frame, so pulse and breathing come from one shot.
- Operator sees the laptop screen; the patient faces the phone. An external monitor faces the judges.
- One steady light next to the patient, not behind the camera. No window or projector behind the patient.
- **Lid wobble is the main mechanical risk.** Typing shakes the phone and that motion lands in the pulse band. Hands off the laptop during a reading; start and stop from the phone or a key press before the reading begins.
- **Mount fallback:** tape, a clamp or a small tripod beside the laptop, in case the print is late.

### The 60-second sitting

| Time | What happens |
|---|---|
| 0 to 5 s | Face found, exposure settles and locks, signal buffer starts. |
| 5 to 20 s | First heart-rate reading appears once three consecutive windows agree. |
| 20 to 60 s | Breathing rate (needs about 45 s of breaths) and beat intervals accumulate. |
| 60 s | Baseline saved: heart rate, breathing rate, variability if valid, each with coverage (share of the sitting that produced a valid reading). |

Each sitting is linked to an anonymous ticket number shown to the patient. Re-checks use the same number, or face recognition for patients who opted in at check-in (section 15). No names or visit reasons on any public screen.

### Measurements

| Measurement | Method | Reference | Status |
|---|---|---|---|
| Heart rate | POS on landmark-anchored skin regions, spectral peak, meeting the requirements in section 7 | Chest strap or BLE oximeter | Must have |
| Breathing rate | Vertical motion of an upper-chest region (optical flow or region tracking), band 0.1 to 0.7 Hz | Manual count over 60 s by a second person | Must have, after heart rate passes its gate |
| Heart-rate variability | Beat-to-beat intervals from the pulse waveform; RMSSD and SDNN | Chest strap that reports beat intervals | Experimental, built last |

### Heart-rate variability: what it takes

- A spectral peak gives an average rate. Variability needs the time of each beat.
- At 30 fps one frame is 33 ms, the same order as the variation being measured. Capture at 60 fps and interpolate the waveform (for example to 250 Hz) before finding peaks.
- Reject intervals that differ sharply from their neighbours, and report variability only when most of the sitting produced valid beats.
- Needs about 60 s of stillness.
- Display rule: shown at check-in only, labelled experimental, with no pain or stress interpretation.

## 5. Waiting-room mode

### Where the time series comes from

The trend engine takes timestamped readings and does not care about the source.

| Source | Needs | Role |
|---|---|---|
| Repeat sittings at the station | Nothing extra | Baseline source; always available |
| Fixed-seat camera at 1 to 1.5 m, one or two marked seats | A second phone and a second gate | Stretch; continuous readings, labelled experimental |
| Recorded sessions replayed through the real pipeline | Logging from the first hour | Demo and testing; always labelled as a recording |

### Tile states

Every patient tile is in exactly one state. There is no "normal" state.

| State | Meaning |
|---|---|
| Observed N min ago | Last valid reading and its age |
| Trend flag | A rule below is met |
| Overdue | No valid observation for longer than the re-check interval; ranks above routine tiles |
| No reading | Sitting attempted but signal was not good enough; ranks as overdue |

### Trend rules

Partial NEWS2 bands, shown as "2 of 7 parameters". Check these against the Royal College of Physicians chart before they go on a slide.

| Parameter | Score 0 | Score 1 | Score 2 | Score 3 |
|---|---|---|---|---|
| Pulse (bpm) | 51 to 90 | 41 to 50, 91 to 110 | 111 to 130 | 40 or below, 131 or above |
| Breathing (per min) | 12 to 20 | 9 to 11 | 21 to 24 | 8 or below, 25 or above |

The estimator searches 42 to 180 bpm, so the lowest pulse band cannot be reported; say so if asked.

A patient is flagged when any of these hold:

- Partial score has risen since check-in and the rise persists across two consecutive observations.
- Pulse or breathing has moved by more than a set amount from the patient's own check-in baseline across two consecutive observations (thresholds chosen from our own recordings, stated on the slide).
- The patient is overdue.

### Notification

- A ranked worklist on the web dashboard and in the nurse role of the mobile app, not an interruptive alarm. One push notification to the nurse's phone per flag episode, with a cool-down and an acknowledge button.
- **Handoff sentence:** a fixed template states the data, for example "Ticket 14: pulse 82 at check-in, 108 now (26 min later); breathing 16 to 24. Last observed 3 min ago." An LLM-written suggestion follows it (section 15).
- We measure and report flag episodes per person-hour from our own sessions.

## 6. Architecture

One mobile app with two roles, a desktop web dashboard and a database. All signal processing happens on the iPhone.

| Part | Built with | Does |
|---|---|---|
| Mobile app, **camera role** | Expo app with a Swift capture module | Rear camera, face landmarks, per-frame mean colour for each skin region, chest-region motion, timestamps, dropped-frame count. Hands frames of numbers to the signal engine. |
| **Signal engine** | Pure Swift package using Accelerate, compiled into the app | All the maths: heart rate, breathing rate, beat intervals, quality and freshness. Sends one reading per second to the server. No camera or UI code inside it, so the same package runs on the Mac against logged sittings. |
| Mobile app, **nurse role** | Same Expo app, React Native screens only | Worklist, push notifications, ticket timeline, acknowledge a flag. Role is chosen at launch. |
| Web dashboard and API | Next.js and React, desktop | Check-in view with the reference overlay, waiting-room worklist, ticket timeline, flag settings, pilot results. API routes receive readings, run the trend rules, write flags and send notifications. Reads the reference strap in Chrome over Web Bluetooth. |
| Database | Postgres, local on the laptop | Tickets, sittings, readings, reference readings, flags, acknowledgements. Numbers only. |

### Why the engine is a Swift package and not a model

- The planned method is classical signal processing (colour projection, filtering, spectral peak, peak timing). It needs no ML runtime, and Accelerate covers it.
- **The offline harness survives the move.** The camera role saves each sitting's raw per-frame numbers and uploads the file after the sitting. The engine package runs on the Mac against those files, so agents can tune and test it without the phone. This is what makes Gate A decidable.
- **A learned model is optional and comes later.** A published rPPG network written in Python can be converted to Core ML with `coremltools` and run on the phone (Core ML is the iOS route; ML Kit is Google's). Treat it as a comparison against the classical engine on our own logged sittings, after Gate A, and ship it only if it beats the classical engine there. A pretrained model has not seen our camera, distance or light.
- **Python stays useful off the phone:** analysing logs, the pilot statistics and the agreement plots.

### Interfaces, fixed first

- **Frame record (inside the phone and in the saved file):** timestamp, face present flag, region colour means, chest motion value, exposure state.
- **Reading (phone to server, once per second):** ticket, sitting, heart rate, breathing rate, quality, coverage, age, and beat intervals at the end of a sitting.
- **Database schema:** `tickets`, `sittings`, `readings`, `reference_readings`, `flags`, `acknowledgements`.
- **Trend rules run in one place,** the Next.js server, because they need every patient's history. The dashboard and nurse role only display flags.
- **Clocks:** the phone and the laptop stamp readings separately. Record the offset at the start of each sitting so estimate and reference line up.

### Notifications

- Remote push through Expo's push service to the nurse role, one per flag episode, with a cool-down and an acknowledge button.
- This needs Apple push credentials on the development build and an internet connection for the laptop, so confirm both early on Saturday. The in-app alert stays as the fallback if the venue network blocks it.

### Other points

- **Network:** phone and laptop on a hotspot with internet access. Everything except push works without the internet.
- **Build order across the seams:** one sitting end to end (camera role, engine, API, Postgres, one dashboard page) before any part is widened. Agents cannot see the camera, so every device test needs a person.
- **Capture settings:** fixed shutter and ISO, white balance and focus locked only after a face is present and exposed correctly, HDR and stabilisation off, `420f` pixel format, 60 fps if sustained capture holds, face detection on a separate queue.
- **Thermal load:** capture and maths now share the phone. Log dropped frames and watch for throttling over a 30-minute run.
- **Privacy statement we can defend:** no video leaves the phone, and no per-frame data is needed by the server; only readings are. Raw per-frame numbers are uploaded during development and the pilot for tuning, from consenting people. Demo filming is separate and disclosed.

## 7. Estimator requirements

The engine must meet all of these before any accuracy number is trusted. Each one guards against a way a camera pulse estimator shows a confident wrong number.

1. Score signal quality at the frequency that is actually reported.
2. Calibrate the quality threshold on negative controls (wall, back of a head, printed face) so that fewer than 5% of windows produce a reading.
3. Require three consecutive agreeing windows before the first reading is shown.
4. Blank the reading on face loss or rejection, with an independent freshness timer for camera or network silence.
5. Reject windows with gaps or too few samples.
6. Do not reward harmonics when picking the peak, except as a tie-break; reject peaks at the edge of the search band.
7. Band-pass the signal to 0.7 to 3 Hz.
8. Use landmark-anchored, temporally smoothed forehead and cheek regions, not a rectangle over the face box.
9. Track motion validity over the whole analysis window, not the last second.
10. Reset signal history whenever the tracked face changes.
11. Do not let smoothing or a prior hold the reading at an old value when the signal has moved; test this with the elevated-rate sitting in Gate A.

## 8. Gates

These are engineering criteria for a demo, not clinical acceptance criteria. They are written down now so that a fail is a fail.

| Gate | When | Pass criteria | If it fails |
|---|---|---|---|
| **A. Heart rate at check-in** | Friday night | Negative control shows "no reading" in at least 95% of windows. One person, three 60 s resting sittings: a reading for at least 80% of seconds, and at least 90% of readings within 5 bpm of the reference. One sitting after stair climbing (reference above 100 bpm) tracked within 5 bpm inside 20 s. Face cover blanks the reading within 2 s. | Nothing else starts. Keep working on the section 7 requirements. If still failing Saturday noon, the project becomes an honest validation workbench: estimate beside reference, with rejected intervals shown. |
| **B. Breathing rate** | Saturday morning | Three people, 60 s each, within 2 breaths per minute of a manual count, including one paced at about 28 per minute. | Ship heart rate only; breathing shown as experimental or cut. |
| **C. Variability** | Saturday evening | Camera beat intervals against chest-strap intervals on at least five sittings. Decide from the agreement plot whether to show it. | Hide it. Mention it as future work. |
| **D. Fixed-seat camera** | Saturday afternoon, only if A and B passed and a second phone exists | Gate A criteria at 1 to 1.5 m. | Waiting-room mode runs on repeat sittings and labelled replay. |

## 9. Validation

- **References:**
  - Heart rate and variability: a Bluetooth chest strap that reports beat intervals, read by the dashboard in Chrome and stored with timestamps.
  - Breathing: manual count by a second person.
  - The fingertip oximeter is a visible second check for judges, not the logged reference.
- **Development and test are separate.** Tune on teammates. Freeze parameters. Then test on volunteers the system has not seen.
- **Pilot:** six volunteers, two 60 s sittings each, about 50 minutes including recruiting.
- **Report:**
  - Mean absolute error and bias.
  - Share of readings within 5 bpm.
  - Coverage, time to first reading and longest dropout.
  - Results per person.
  - Share of all attempted sittings that gave an accurate accepted reading.
- **Public datasets** give a larger sample than the pilot and let agents test the engine without the phone. See section 16.
- **Call it a pilot with n stated.** No skin-tone table at this sample size; if asked, say what the literature reports and that our sample cannot show otherwise.

## 10. Claims

| We say | We do not say |
|---|---|
| Research prototype, not validated for clinical use | Not a medical device; decision support |
| Would be a regulated device; camera vitals for a single still person have been cleared, continuous multi-person use has not | Ready to pilot |
| Measures pulse and breathing rate; variability experimental | Blood oxygen, blood pressure, diagnosis, pain or stress |
| Face recognition is opt-in at check-in, used only to match a returning patient to their ticket, and deleted at discharge | No face recognition; private by construction |
| The suggestion is a draft for the nurse, written from measured values, and the nurse decides | The system recommends treatment or triage level |
| Flags a posture change for a human to check | Detects collapse or a medical emergency |
| Shows who has not been observed and whose numbers have moved | Detects deterioration |
| Declines to show a reading when quality is low, at a rate we measured | It never guesses |
| Repeat observations can be delayed | Nobody measures anything for hours |

## 11. The demo (about 3 minutes)

1. **Hook (20 s).** The gap between triage and bed.
2. **Check-in (60 s).** The presenter sits, wearing the reference. Estimate and reference lines track each other with a running error figure. Breathing rate appears.
3. **Failure handled (20 s).** Cover the face, then point the phone at a wall. "No reading."
4. **Waiting room (50 s).** The worklist on the dashboard with the live ticket plus labelled recorded patients played at speed. One climbs the list; the handoff sentence appears and the flag arrives on a second phone in the nurse role. One goes overdue and rises too. If they passed their cut line: the AI draft suggestion appears under the handoff sentence, and a teammate slumping in the chair raises a posture-change flag.
5. **Close (30 s).** Pilot numbers, what we do not claim, what a real study would need.

After the scripted run, offer the judge the chair.

**Two-minute video:** shot Saturday afternoon straight after the pilot, with the check-in reading in one continuous take.

## 12. Schedule

Assumes submission at 8 AM Sunday and a Devpost draft due Saturday noon; confirm both.

| When | Work |
|---|---|
| Fri evening | New repo, stream format and schema. Record raw sittings with the reference, including one elevated and the negative controls. Local Postgres up with the schema. Agents in parallel: camera role with sitting-file upload, Swift engine package with a Mac test harness, Next.js dashboard and API shell fed from a log. |
| Fri late | Engine meets the section 7 requirements on the recordings. **Gate A.** One live person end to end. Once Gate A passes, agents start the two JavaScript-only features that need no device testing: the LLM suggestions and the video-visit screens. |
| Sat 2 to 7 AM | Sleep. |
| Sat 7 AM to noon | Light check at the judging spot. Breathing rate, **Gate B**. Collapse detection (shares the chest and pose capture work). Reference overlay view. Devpost draft by 11:30. |
| Sat noon to 3 PM | Push credentials confirmed. Trend rules, tile states, worklist, ticket numbers, replay at speed. Nurse role in the mobile app. Face recognition for re-checks. First full rehearsal. |
| Sat 3 to 6 PM | Freeze parameters. Six-person pilot. Shoot the video. **Gate D** if eligible. |
| Sat 6 to 9 PM | Variability and **Gate C**. Handoff sentence, push notification and acknowledge, optional Core ML model comparison, integrate video-visit mode and LLM suggestions, polish. **Feature freeze at 9 PM.** |
| Sat 9 to 11 PM | Second rehearsal, cut the video, finish Devpost. |
| Sat 11 PM to Sun 5 AM | Sleep. |
| Sun 5 to 8 AM | Set up, re-check in morning light, submit an hour early. |

**Parallel workstreams:** camera role; Swift engine package with Mac harness; Next.js dashboard, API, trend rules and Postgres schema; nurse role and push; patient role for video visits; LLM suggestions; collapse detection; face recognition; dataset download and evaluation harness (section 16); mount design and print; pilot protocol and pitch. The mount, the pilot and every on-device test need a person.

## 13. Risks

| Risk | Response |
|---|---|
| Gate A fails | Section 8 fallback; no other work proceeds until it passes |
| Lid wobble corrupts readings | Hands-off rule; clamp or tripod fallback |
| Venue light flickers or changes by morning | Own steady light beside the patient; re-check at the judging spot at judging time |
| Reference device has no data output | Chest strap over Bluetooth; hand-entered readings as last resort |
| Replay looks faked | Recorded tiles are labelled on screen; the live tile and reference run throughout |
| A judge's reading is wrong live | Presenter is the scripted subject; the judge's turn comes after |
| Familiar hackathon idea | Lead with live agreement against a reference and the handled failure, which past entries did not show |
| Four parts meet at interfaces agents cannot test end to end | Stream format and schema fixed first; one sitting end to end before widening; dashboard and nurse role developed against replayed logs |
| Push blocked by venue network or missing credentials | Confirm early Saturday; in-app alert as fallback |
| Scope creep | Nothing below a gate starts before that gate passes |

## 14. Shopping and open decisions

- **Buy or borrow:** Bluetooth chest strap that reports beat intervals; one fingertip oximeter; one steady light; clamp or small tripod.
- **Mount:** phone model and case dimensions, laptop lid thickness, printer access and print time.
- **Second phone:** needed to show the nurse role during the demo while the first phone is the camera; a third device would be needed for the fixed-seat camera.
- **Team:** who sits as the subject, who counts breaths, who presents.
- **Event facts to confirm:** deadlines, judging time and place, prize list.
- **Name:** decide before the Devpost draft.

## 15. Additional features

All four start only after Gate A passes, and each has its own cut line: if it is not working at the Saturday 9 PM freeze, it is left out of the demo.

### Collapse detection

- **How:** Apple's body-pose tracking in the camera role. A flag is raised when head and shoulder height drop sharply from the person's seated baseline and stay there, or when all motion stops for a set time.
- **Wording:** a "posture change" flag that asks a human to look. Reaching for a bag or falling asleep will trigger it, so it ranks as a prompt, not an emergency.
- **Where it runs:** the mounted phone during a sitting, and the fixed-seat camera if a spare device exists.
- **Demo:** a teammate slumps in the chair; the flag reaches the nurse phone.

### Video-visit mode

- **How:** a third role in the mobile app, the **patient role**. The patient's own phone runs the same engine on the front camera and sends readings to the clinician's dashboard during a call.
- **Why not measure from the call video:** video compression removes the small colour changes the method depends on. Measuring on the patient's phone before any encoding avoids that.
- **What we build:** the patient role and a clinician view on the dashboard. The call itself runs in whatever app the two people already use; we do not build a video stack.
- **Sponsor fit:** the candidate for the Chert challenge, once we know what it asks for.

### Face recognition for re-checks

- **What it solves:** a returning patient sits down and is matched to their ticket without typing a number. With a fixed-seat camera it also keeps the right trend attached to someone who changes seats.
- **How:** Apple's Vision framework finds faces and landmarks but, as far as I know, does not expose identity matching. This needs a face-embedding model converted to Core ML, with embeddings compared on the phone or the server.
- **Rules:** opt-in at check-in, embeddings stored against the ticket only, deleted at discharge, and the ticket number always works as the alternative. A low-confidence match asks for the ticket number; a wrong-patient trend is worse than no trend.
- **Cost to the pitch:** the original "no face recognition" privacy line is gone. Some US states regulate face-geometry data, so a real deployment would need legal review; say so if asked.

### LLM-written clinical suggestions

- **How:** the Next.js server sends the Claude API a structured summary for one ticket (values, timestamps, baseline, partial NEWS2 score, gaps, quality) and gets back one or two sentences for the nurse.
- **Guardrails:**
  - Generated only from fresh, accepted readings; never from a stale, low-quality or low-confidence-match tile.
  - The prompt limits the output to reassessment prompts ("consider re-checking", "consider a full set of observations"), with no diagnosis and no treatment.
  - Shown under the templated data sentence and labelled as an AI draft.
  - Only ticket numbers and measurements are sent, no names or visit reasons.
  - If the API is unreachable, the templated sentence stands alone.
- **Regulatory note:** software that analyses physiological signals and recommends action to a clinician is a medical-device function. That does not stop a prototype, but the pitch should say "research prototype" and not "decision support, so not a device".

### Devices needed for the full demo

| Device | Role |
|---|---|
| Phone 1, on the laptop mount | Camera role at check-in |
| Phone 2 | Nurse role, receiving push |
| Phone 3 (optional) | Patient role for the video-visit segment, or the fixed-seat camera |

## 16. Public datasets for evaluation

Access was checked on Friday 13 November 2026 by reading each dataset's own page. Nothing was downloaded, so file contents and download speed are untested. "Open" means no email, signed form or human approval is needed.

### How they plug in

- The datasets are videos; the engine takes per-frame numbers. One script on the Mac runs face landmarks over each video and writes the same frame record the phone produces (section 6). The Swift engine package then runs on them unchanged.
- **They do not replace Gate A.** Different camera, distance, light and compression mean a pass here shows the maths is right, not that the phone setup works.
- **Report them separately from the pilot,** with the dataset named, the number of recordings used, and the same metrics as section 9.
- **Start downloads early.** Most are tens of gigabytes; pull a subset first.

### Use these

**Decision of 14 November 2026:** published evaluation and statistics use UBFC-rPPG only. MCD-rPPG is kept as an internal diagnostic and its figures are not published anywhere.

| Dataset | Why | Ground truth | Size | Terms | Link |
|---|---|---|---|---|---|
| **UBFC-rPPG** | First one to run. Seated people on a webcam, uncompressed video. The standard benchmark, so results compare with published numbers. | Fingertip pulse waveform and heart rate. Beat intervals can be derived from the waveform. No breathing. | About 38 GB; Dataset 1 alone is 7 GB | "Shared for research purpose". Do not show the faces of subjects 21 and 27 anywhere. | [Project page](https://sites.google.com/view/ybenezeth/ubfcrppg), [Drive folder](https://drive.google.com/drive/folders/1o0XU4gTIo46YfwaWjIgbtCncc-oF44Xk) |
| **MCD-rPPG** | Closest to our use: includes phone-camera footage, 600 people, at rest and after exercise, so it covers elevated heart rates. | Pulse waveform at 100 Hz, ECG, and a breathing rate counted by a physician (one number per recording, not a waveform). | 135 GB; download a subset | CC BY 4.0 | [Hugging Face](https://huggingface.co/datasets/kyegorov/mcd_rppg) |
| **SCAMPS** | The only open set with a breathing waveform and beat intervals per frame. | Pulse and breathing waveforms, heart rate, breathing rate, beat intervals. | Full set 593 GB; 10-video sample 1.2 GB | Non-commercial research only | [Repo](https://github.com/danmcduff/scampsdataset), [sample](https://facesyntheticspubwedata.z6.web.core.windows.net/neurips-2022/scamps_videos_example.tar.gz) |
| **rPPG-10** | Tiny, so it works as a smoke test tonight. Skin type is in the metadata. | Synchronised ECG. | 0.12 GB | CC BY-NC-SA 4.0 | [Mendeley Data](https://data.mendeley.com/datasets/bx8982xgwt) |
| **CMU rPPG biases** | Darker skin tones (recorded in India and Sierra Leone). | Mean pulse rate per video only. | 1.9 GB | MIT on the repo | [GitHub](https://github.com/AiPEX-Lab/rppg_biases) |

Limits to state when using them:

- **SCAMPS is synthetic.** The faces are rendered, so it tests the breathing and beat-interval maths, not real-world performance.
- **rPPG-10 and the CMU set are cropped skin patches,** not full faces. They test the colour maths and skip our face and region tracking.
- **MCD-rPPG:** video and pulse were aligned after recording, skin tone is not reported, and the ECG sample rate is not stated. Check the rate before using it for variability.
- **No open dataset has full-face video with a pulse waveform for a meaningful number of darker-skinned people.** The CMU set is the closest, and it supports only an average-rate comparison.
- **No open dataset has a breathing waveform from a chest belt alongside real video.** Our own manual counts remain the breathing reference.

### Also open, lower priority

| Dataset | What it adds | Size | Link |
|---|---|---|---|
| 4TU rPPG benchmark | Three people with three skin tones, ECG reference | 18 GB | [4TU download](https://data.4tu.nl/file/8c901757-d472-41ec-9f96-51425b719f1b/82eb808d-5653-4de2-bba7-2bb4bec28300) |
| EMPD | 83 people, pulse waveform at 60 Hz | 9 parts of about 46 GB | [Zenodo](https://zenodo.org/records/18765701) |
| UBFC-Phys | 56 people under stress tasks, wrist pulse at 64 Hz | About 14 GB per person; needs a free IEEE account | [IEEE DataPort](https://ieee-dataport.org/open-access/ubfc-phys-2) |
| Rice CameraHRV | Built for variability, includes a deep-breathing task | About 648 GB | [Box folder](https://rice.box.com/s/noy6vn7k5g5bfvl9o6ekcjmgc9ng4yel) |
| MR-NIRP Indoor | Eight people, colour plus near-infrared | About 60 GB | [Drive folder](https://drive.google.com/drive/folders/1huO4AZ6Dbr24gwHFgYvpHPbYUSNBWjGC) |

Two open sets are left out on purpose: Toadstool's terms require written permission for use in competitions, and the DLCN authors ask for a signed agreement even though the files download freely.

### Not available this weekend

These need an emailed request, a signed agreement or faculty sign-off, so do not wait on them: PURE, MMPD (including the mini version), COHFACE, iBVP, VIPL-HR, V4V, Vital Videos, VicarPPG-2, SUMS, the full UCLA-rPPG set. COHFACE, SUMS and V4V are the ones with breathing references.

### Tooling

The [rPPG-Toolbox](https://www.github.com/ubicomplab/rPPG-Toolbox) has loaders for UBFC-rPPG and SCAMPS and reference implementations of the classical methods, which gives a baseline to compare our engine against.

