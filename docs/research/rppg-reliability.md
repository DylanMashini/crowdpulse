# How camera pulse measurement is made reliable: an outside view

Research for the engine reliability rework, 14 November 2026. The trigger: a still, seated intake sitting returned no reading. This document covers what the literature, the open-source toolboxes and the public material of shipping products say about getting an answer reliably, stated relative to what `packages/signal-engine` does today. It ends with a ranked list of changes.

Rules followed here: every figure comes from the source linked beside it. Where I derived a number myself it is marked "my arithmetic". Where I could not open a source, it is listed in section 10 and no figure from it is used.

## 1. What our engine does today

Read from `packages/signal-engine/Sources/SignalEngine` and `apps/mobile/modules/triage-capture/ios` at commit `85f4853`.

| Stage | Today |
|---|---|
| Regions | Three: forehead, left cheek, right cheek, colour means computed on the phone. |
| Pulse extraction | POS only, 1.6 s sliding window, overlap-add (`PulseAnalyzer.project`). |
| After the projection | Straight-line detrend, FFT brick-wall band-pass 0.7 to 3.0 Hz with 0.1 Hz roll-off. |
| Region fusion | Each region scored alone, waveforms summed with weight = quality squared. |
| Window | 6 s growing to 10 s, one analysis per second. Never spans a gap of more than 0.25 s. |
| Spectrum | One Hann-windowed FFT, zero-padded to 4096, log-parabolic peak interpolation. |
| Harmonics | Lower peak wins only when within 0.8 of the top peak's power; a separate sub-harmonic test can halve the rate. |
| Quality score | Share of all band power that lies within ±1.25 / window length of the reported peak (±7.5 bpm for a 10 s window). Fundamental only. |
| Gates on one window | quality ≥ 0.5; not within 2 bpm of the 42 to 180 bpm search edge; not within 6 bpm of a mains-flicker alias; projection-yield test; no more than 5% of frames "in motion" (brightness more than 2% off a 1 s baseline, or chest speed); at least 85% of expected frames. |
| Gate across windows | Three consecutive windows must each pass and agree within 5 bpm. One failed window empties the run. |
| Segment resets | A single frame with no face, or with exposure not locked, discards the signal history. The next reading is then at least 6 s plus three windows away. |
| Sitting summary | Median of the valid one-second readings; needs at least 3. No valid readings means no heart rate for the sitting. There is no other path to a number. |
| Breathing | Chest position at 10 Hz, 0.1 to 0.7 Hz, first window after 40 s, 45 s maximum, same quality ≥ 0.5 and three-window agreement. |
| Capture | 60 fps requested (30 fps fallback), 4:2:0 full-range frames, HDR off, stabilisation off, low-light boost off, sRGB. Exposure, white balance and focus are metered on the face for 0.5 s and then locked. |

The structural point: every gate is a veto, the vetoes are multiplied together, and there is nothing behind them. A product that must return a number for a still subject needs a second, slower path. The rest of this document is the evidence for what that path and the gates should look like.

## 2. Pulse extraction algorithms

### What the benchmarks report

rPPG-Toolbox (Liu et al., NeurIPS 2023), unsupervised methods, whole-face crop, heart rate from the FFT peak. MAE in bpm and MAPE in per cent, Table 2 of https://arxiv.org/pdf/2210.00716:

| Method | PURE MAE | PURE MAPE | UBFC-rPPG MAE | UBFC-rPPG MAPE | UBFC-Phys MAE | MMPD MAE |
|---|---|---|---|---|---|---|
| GREEN | 10.09 | 10.28 | 19.81 | 18.78 | 13.55 | 21.68 |
| ICA | 4.77 | 4.47 | 14.70 | 14.34 | 10.03 | 18.60 |
| CHROM | 5.77 | 11.52 | 3.98 | 3.78 | 4.49 | 13.66 |
| LGI | 4.61 | 4.96 | 15.80 | 14.70 | 6.27 | 17.08 |
| PBV | 3.91 | 4.82 | 15.90 | 15.17 | 12.34 | 17.95 |
| POS | 3.67 | 7.25 | 4.00 | 3.86 | 4.51 | 12.36 |

The appendix tables of the same paper add the mean signal-to-noise ratio (de Haan definition, see section 5): POS 6.87 dB on PURE and −2.39 dB on UBFC-rPPG; CHROM 4.58 dB and −2.96 dB. Only POS and CHROM hold up on both datasets. ICA, LGI and PBV are competitive on PURE (uncompressed images) and fall apart on UBFC-rPPG in this benchmark.

Wang et al. 2017, the POS paper, compare eight methods on their own uncompressed 20 fps recordings using SNR in dB (Table I, https://pure.tue.nl/ws/files/31563684/TBME_00467_2016_R1_preprint.pdf). For the stationary case of the luminance category: G 8.10, G−R 10.14, PCA 8.70, ICA 11.61, CHROM 9.42, 2SR 10.53, POS 10.51. Overall average across all challenges: POS 5.16, 2SR 4.93, CHROM 3.86, G−R 3.67, PBV 3.56, ICA 1.92, PCA 0.05, G −1.90. Their reading: ICA is best when the subject is truly stationary, but "PCA and ICA almost break down" under periodic motion; 2SR is strong only when the skin mask is clean; G−R is surprisingly good for two channels; POS is the best all-rounder. They also note that PBV has "a modest loss in signal quality when the subject is (nearly) stationary".

Face2PPG (Álvarez Casado and Bordallo López, 2022, https://ar5iv.labs.arxiv.org/html/2202.04101) reports MAE ± SD in bpm for its baseline pipeline: on PURE, POS 1.9 ± 3.1 and CHROM 1.6 ± 2.0; on UBFC1, POS 1.8 ± 0.4 and CHROM 2.2 ± 0.8; on UBFC2 (all 42 videos), POS 7.9 ± 10.4 and CHROM 8.3 ± 10.9. Its own method OMIT (thin QR factorisation of the RGB matrix, pulse taken from the component orthogonal to the first column of Q) with multi-region selection reaches 1.7 ± 2.6 on PURE, 0.8 ± 0.4 on UBFC1 and 1.1 ± 1.2 on UBFC2. The authors claim OMIT is robust to compression artefacts but give no ablation for that claim.

The same nominal method scores very differently between benchmarks (POS on PURE: 3.67 in rPPG-Toolbox, 1.9 in Face2PPG). The difference is everything around the projection: region, filtering, window, spectral estimate. That is the main lesson of this section: the choice between POS and CHROM matters less than the steps in sections 3 to 5.

### What this means for us

- POS is the right primary method. Nothing in these benchmarks beats it consistently without training data.
- CHROM is the natural second opinion: equally cheap, close in accuracy, and built on a different assumption (standardised skin tone, not a plane orthogonal to the skin-tone direction), so its failures are not the same failures. The rPPG-Toolbox implementation uses a 1.6 s Hann window with 50% overlap, a third-order Butterworth 0.7 to 2.5 Hz applied to the chrominance signals before the alpha ratio, Xs = 3R − 2G, Ys = 1.5R + G − 1.5B, pulse = Xf − αYf (https://github.com/ubicomplab/rPPG-Toolbox/blob/main/unsupervised_methods/methods/CHROME_DEHAAN.py).
- G−R on normalised channels is a third, nearly free candidate (Wang et al. rate it above the blind source separation methods overall).
- ICA has the best stationary SNR in Wang's table and the worst robustness. It needs a component-selection step that is itself a source of wrong answers. Not worth it for a hackathon.
- GREEN is a poor fallback: worst in every table above.
- Our POS is implemented as in the paper. One difference from the reference code: rPPG-Toolbox follows POS with smoothness-priors detrending (λ = 100) and a first-order Butterworth 0.75 to 3 Hz (https://github.com/ubicomplab/rPPG-Toolbox/blob/main/unsupervised_methods/methods/POS_WANG.py); we use a straight-line detrend and a brick-wall filter. See section 4.

## 3. Region of interest

- Kim, Lee and Sohn 2021 ranked 31 anatomical face regions on UBFC-rPPG and LGI-PPGI (https://pmc.ncbi.nlm.nih.gov/articles/PMC8659899/). Best five: right malar (cheekbone), glabella (between the brows), lower medial forehead, upper medial forehead, left malar. Worst: the sides of the nose and the upper lip. Their top-five combination against whole-face skin on UBFC: POS MAE 1.85 against 1.87, CHROM 1.5 against 2.67; on LGI-PPGI: POS 3.61 against 4.04, CHROM 2.93 against 4.04. So well-chosen patches match or beat the whole face with about a tenth of the pixels. Skin types I and II only.
- Face2PPG, Table 3 (CHROM, LGI-PPGI): forehead alone 5.4 ± 6.3, cheeks alone 6.5 ± 5.5, forehead and cheek patches combined 5.1 ± 4.5, a 9 × 9 grid over the normalised face with dynamic selection 3.9 ± 3.6. "A moderately large number of regions results in smaller errors." On the easy datasets the gain is still visible: UBFC1 POS baseline 1.8 against multi-region CHROM and OMIT 0.8.
- DistancePPG (Kumar, Veeraraghavan, Sabharwal 2015, https://ar5iv.labs.arxiv.org/html/1502.08040) splits the face into seven tracked planar regions of 20 × 20 px patches and combines them by a weighted average in the spirit of maximum ratio combining. The weight is a "goodness metric": power in a band around the pulse rate divided by the power in the rest of the 0.5 to 5 Hz passband, computed per region per epoch (10 s when static). The pulse rate used for the metric is a coarse estimate from an equal-weight average. Regions with goodness below 0.25 (−6 dB) are dropped, as are regions whose max-minus-min amplitude in the epoch exceeds 8 intensity units (a motion or specular spike). Reported gain over plain face averaging: about 4.1 dB SNR across skin tones, 6 to 7 dB for non-white skin tones, 6.5 dB in low light for a brown-skinned subject. Static pulse-rate agreement: bias −0.02 bpm, limits −0.75 to 0.72, against −0.40 bpm, limits −4.5 to 3.7, for face averaging.
- pyVHR's patch mode produces one rate per patch per window and reports the median with the median absolute deviation as the spread; a newer mode clusters the patch spectra into two groups by cosine distance and picks the group with the narrower, higher-SNR peak (https://github.com/phuselab/pyVHR/blob/master/pyVHR/BPM/BPM.py). The median is a region vote: one patch with a glint or a hair shadow cannot move it.
- Google's finger-camera heart rate uses the same idea at small scale: full frame plus four halves, keep only regions with SNR ≥ 0 dB, report the region with the highest SNR (https://pmc.ncbi.nlm.nih.gov/articles/PMC9053269/).

Relative to us: our three regions with quality-squared weights are a small DistancePPG. What we lack is (a) more regions, in particular the glabella and separate forehead thirds, so that a vote is meaningful; (b) the amplitude veto per region instead of a motion veto on the whole window; (c) a vote, in addition to the weighted sum, to use as a confidence signal. More regions needs a capture change, because the phone computes the region means.

## 4. From raw signal to a rate

### Detrending and band-pass

- Smoothness-priors detrending (Tarvainen) with λ = 100 is the convention in rPPG-Toolbox and is applied both to the POS output and before evaluation (https://github.com/ubicomplab/rPPG-Toolbox/blob/main/evaluation/post_process.py; note the code squares λ internally). It behaves like a time-varying high-pass and removes slow wander that a straight line does not. Our straight-line detrend leaves any curved drift for the band-pass to deal with.
- Band-pass choices in the sources: rPPG-Toolbox paper, second-order Butterworth 0.75 to 2.5 Hz, with the remark that "the choice of filtering parameters can have a significant impact on downstream results"; its code default is first-order 0.6 to 3.3 Hz; Face2PPG, Kaiser FIR (β = 25) 0.75 to 4 Hz; pyVHR, 0.65 to 4 Hz; DistancePPG, 0.5 to 5 Hz; Google, 0.5 to 6 Hz for the finger. Our 0.7 to 3.0 Hz is within the range people use. A band that stops at 2.5 or 3 Hz removes the second harmonic of any rate above 75 to 90 bpm, which matters if the quality score is to count the harmonic (section 5).

### Window length and overlap

- Face2PPG: 10 s windows, 1 s step. pyVHR examples: 6 s windows; its spectrogram default is 5 s with a 1 s step. TROIKA (wrist PPG): 8 s, 2 s step (https://ar5iv.labs.arxiv.org/html/1409.5181). DistancePPG: 10 s static, 5 s in motion. Google's passive face heart rate: 8 s clips (https://research.google/blog/towards-passive-heart-health-monitoring-via-smartphone-camera/).
- Regulatory-grade spot checks use longer windows for the number they stand behind: PanopticAI Vital Signs, 30 s (K240890, https://www.accessdata.fda.gov/cdrh_docs/pdf24/K240890.pdf); FaceHeart FH Vitals SDK, 1 min, and its predicate Oxehealth, 9 s for pulse and 30 s for breathing (K223622, https://www.accessdata.fda.gov/cdrh_docs/pdf22/K223622.pdf); NuraLogix Anura, 30 s in 5 s chunks (https://docs.deepaffex.ai/points/metadata/SNR.html); Binah's accuracy study, 60 s recordings with the final result computed at the end (https://www.binah.ai/wp-content/uploads/2025/03/MED-000026-Pulse-Rate-Accuracy-Report-of-SDK-5.9.1-Final-Rev2-Final.pdf).

Our 6 to 10 s live window is in line with the research pipelines. What differs is that the products above report a sitting-level number from 30 to 60 s of signal, and we report the median of live windows that each passed every gate.

### Spectral estimation

- rPPG-Toolbox: plain periodogram, zero-padded to the next power of two, argmax inside the band. No interpolation, no averaging. pyVHR: Welch, nfft 2048, argmax. Our Hann window, 4096-point padding and parabolic interpolation are already finer than both. There is nothing to gain in resolution.
- Averaging spectra is the tool we do not use. Google's breathing algorithm sums the power spectra of five regions before picking the peak (https://pmc.ncbi.nlm.nih.gov/articles/PMC9053269/); pyVHR sums the spectra of a patch cluster. Summing power spectra across regions, methods or successive windows keeps a peak that is present in most of them and averages down peaks that are present in one. For a resting subject whose rate moves by a few bpm in a minute this is the cheapest way to turn several marginal windows into one clear answer.

### Harmonics and sub-harmonics

- The de Haan SNR counts the first two harmonics as signal (section 5). A real pulse has a second harmonic; a score that counts it as noise penalises exactly the cleanest waveforms.
- TROIKA uses the harmonic as evidence rather than as a threat: it looks for a peak near the previous rate and a peak near twice the previous rate; if they form a pair, the lower one is the heart rate; if only the harmonic is found, it is mapped back to the fundamental. Peaks count only above 30% of the strongest peak in the search range.
- We do the opposite of the first point (the harmonic is in the denominator of our quality score) and have a careful version of the second (the sub-harmonic test). Requirement 6 of the master plan says harmonics must not be rewarded when picking the peak. That stands: the harmonic should count towards quality at the chosen frequency, not towards the choice.

### Tracking across windows

- TROIKA's spectral peak tracking: search ±16 bins (about ±16 bpm at their resolution) around the previous window's rate; if no peak is found, hold the previous value; limit the change between successive windows (trigger at about 11 bpm, step 2 bins); after three held windows, widen the search to ±20 bins and nudge in the direction of a polynomial trend. Initialisation is from a few quiet seconds.
- Temko's wrist-PPG work adds an offline Viterbi decode over the whole recording's spectrogram; I have this from a search summary only and did not read the paper (section 10).
- Google's passive heart rate weights each 8 s clip's rate by its confidence and runs a Kalman filter over them to get a daily resting value.
- Requirement 11 of the master plan forbids a prior that holds a stale value when the rate has moved. A tracker is compatible with it if it is used to choose among this window's peaks (a peak near the last accepted rate needs less quality than a peak far from it) and never to output a value this window does not contain. For the sitting summary, where the whole recording is available, the offline version is safe by construction: find the best path through the spectrogram, then report its median.

### Consensus

Sources combine estimates in three ways: weighted sum of waveforms (DistancePPG, us), sum of spectra (Google, pyVHR clusters), median of per-estimator rates with MAD as the spread (pyVHR). I did not find a source that formally evaluates "agreement between POS and CHROM" as a quality index; the closest are pyVHR's median over patches and Karlen's Smart Fusion for breathing, which drops a window when the individual estimates disagree (section 8). Treat method agreement as a reasonable engineering extension, not a published result.

## 5. Signal quality and gating

### What people measure

- **Spectral SNR, de Haan and Jeanne 2013.** As restated by Wang et al.: "the ratio between the energy around the first two harmonics and remaining parts in the frequency spectrum". The rPPG-Toolbox implementation: windows of ±6 bpm around the rate and around twice the rate, signal = power in both windows, noise = the rest of 0.6 to 3.3 Hz (0.75 to 2.5 Hz in the paper), SNR = 10 log10(signal / noise) (https://github.com/ubicomplab/rPPG-Toolbox/blob/main/evaluation/post_process.py). In benchmarks the harmonic locations come from the reference; a live system uses its own candidate.
- **Goodness metric, DistancePPG.** The same ratio for the fundamental only, over 0.5 to 5 Hz.
- **Vendor SNR, NuraLogix.** "Relative strength of the extracted facial blood-flow" against the background, in dB, range −10 to +20, available after 5 s. The formula is not published.
- **Confidence from a model.** Google's passive heart rate has the network output a confidence score and reports accuracy "after gating with a minimum confidence score". Binah reports a confidence level (low, medium, high, unknown) with each final vital sign (https://developer.binah.ai/ios/latest/vital-signs/confidence-level.html, via search summary).
- **Waveform SQIs from contact PPG.** Elgendi 2016 compared eight indices on 106 recordings of 60 s and found skewness best at separating usable from unfit signals, ahead of the perfusion index (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5597264/). Orphanidou et al. 2015 gate on physiological plausibility of the beat series plus correlation of each beat with an average-beat template; I could not open the paper to confirm its thresholds (section 10). These need clean individual beats and suit our beat-interval stage more than the rate gate.

### Thresholds that are published

| Source | Rule |
|---|---|
| NuraLogix DeepAffex | SNR below 0.5 dB: no results are computed. For a 30 s measurement in 5 s chunks: cancel if SNR < 0.5 at 15 s; cancel if SNR < 0.5 for two of the remaining three chunks; do not display results if SNR < 0.5 for the last chunk. https://docs.deepaffex.ai/points/metadata/SNR.html |
| Google, finger heart rate | Keep regions with SNR ≥ 0 dB; if none, no heart rate is reported. Up to three tries. https://pmc.ncbi.nlm.nih.gov/articles/PMC9053269/ |
| Google, breathing | Below −6.0 dB (version A) or −4.0 dB (version B) the algorithm does not refuse; it switches from the spectral peak to counting zero crossings. Same source. |
| DistancePPG | A region is dropped below goodness 0.25 (−6 dB). The measurement is not. |
| Binah | Low-confidence pulse-rate results are not reported by the SDK (stated in its 2024 accuracy report, via search summary). |

### How our gate compares

Our score is the share of band power within ±1.25 / T of the peak, fundamental only, and the threshold is 0.5. A share of 0.5 is 0 dB in ratio terms (my arithmetic). For comparison, the mean de Haan SNR of POS on UBFC-rPPG in rPPG-Toolbox is −2.39 dB even with the second harmonic counted and the reference rate known, which is a share of about 0.37 (my arithmetic), and those recordings give POS an MAE of 4.0 bpm. On PURE the mean is 6.87 dB, a share of about 0.83. In McDuff et al.'s stationary task the raw-video SNR is −7.80 dB with a pulse-rate error of 1.78 bpm (Table I, https://www.microsoft.com/en-us/research/uploads/prod/2020/11/McDuff_2017_Impact2.pdf; SNR definitions differ in detail between papers, so compare the order of magnitude only).

Two conclusions follow, and both agree with the suspicion that the gates are too strict:

1. Typical good webcam recordings sit below our threshold on a comparable scale, while still yielding the right rate. Our 58% coverage on UBFC-rPPG is what one would expect from a gate set near the dataset's median quality.
2. Our score leaves the second harmonic in the noise term, so a cleaner, more pulse-shaped waveform can score lower than a sinusoid-like one.

None of this says what the threshold should be. The plan's requirement 2 is the right procedure: calibrate on negative controls. What the literature adds is that the calibrated number is likely to land well under 0.5 once the score counts the harmonic, and that the other systems' gates are a single SNR test on a long window, not a product of seven vetoes on a short one.

### Show, show with lower confidence, or refuse

The pattern across the products:

- Live values are provisional. Binah sends "instantaneous" values during the measurement and separate final results with a confidence level at the end. NuraLogix shows an SNR every 5 s and decides at the end.
- The final number comes from the whole measurement and gets one quality decision.
- There are at least three outcomes: a result, a result with a stated lower confidence, and no result with a reason the user can act on.
- A second measurement is part of the design. Google's study allowed three tries: 316 of 379 recordings (83.4%) gave a heart rate on the first try and 361 (95.3%) within three. A single-try success rate in the eighties is normal for a shipped, validated product with a finger on the lens. Planning the demo around one try at 100% is planning against the evidence.

## 6. Graceful degradation in shipping products

**Binah.ai.** Default mode since SDK 5.4 is non-strict: every frame with a detected face is processed, including frames that violate the guidance, and no gap warnings are raised. Strict mode processes only valid frames, warns when invalid frames persist for more than 0.5 s, and ends the session without results on the third such gap (https://developer.binah.ai/ios/latest/measuring/measurement-guidance.html). Frame validity reasons are device orientation, no face, tilted head, face too far, uneven light (https://developer.binah.ai/ios/latest/images/image-validity.html). The accuracy study had subjects at about 20 to 40 cm with the face filling most of the frame, phone on a stand at forehead level, glasses off, no talking, 60 s, fixed artificial light; its Bland-Altman plots cover 0.20 to 0.45 m and light down to under 150 lux.

**NuraLogix Anura.** 30 s measurement. Before it starts the SDK enforces constraints (face presence, position, distance, rotation, movement, with optional lighting and backlight checks) and shows a countdown; the message during exposure calibration is "Please hold still while the camera is calibrating...". On iOS the constraints are enforced before the measurement by default and not during it (`defaultConstraintsDuringMeasurementEnabled` defaults to false), so a small movement mid-measurement does not abort (https://docs.deepaffex.ai/core/print.html). Camera requirements: minimum 25 fps, recommended 30 fps, accurate millisecond timestamps, about 12 px/cm on the face (a 480p selfie). Troubleshooting advice in order: hold still, phone in a stand, even light on both sides of the face, more light for darker skin, move as close as the tracker allows ("the closer you are to the camera, the higher the SNR will be"), remove glasses and caps, clean the lens (https://docs.deepaffex.ai/guide/6_troubleshooting_guide.html). An on-device "star rating" of optical quality is shown before measuring; it does not guarantee SNR.

**Google Fit.** Heart rate was finger-on-rear-camera, not face; breathing was front camera, head and upper torso, 30 s. Fallbacks: best region by SNR, a time-domain method when the spectrum is weak, and retries. The app told users to prop the phone on a table and to wait after moving (https://pmc.ncbi.nlm.nih.gov/articles/PMC9053269/). Google's later passive face heart rate keeps only confident 8 s clips and aggregates many of them.

**FDA-cleared software.** FaceHeart FH Vitals SDK (K223622): spot measurement "when the subject is still", 1 min, 50 to 180 bpm within ±3 bpm, light above 300 lux, distance 0.5 to 1.5 m, VGA at 30 fps, "support minor movement (speak or nod slightly)". Its verification table lists the response to each bad condition as a warning message (missing face, bad face position, motion, low frame rate), not as silence. Its own test found MAE of 11.77 to 42.06 bpm under exercise or large movement. PanopticAI Vital Signs (K240890): iPhone or iPad front camera, 30 s window, 50 to 130 bpm within 3 bpm RMSE, bench-tested at 0.4 to 0.6 m and 100 to 500 lux, reported RMSD 1.81 bpm. Oxehealth (predicate): fixed camera, 9 s pulse window, 30 s breathing window, accuracy "may be reduced" above 110 bpm.

**Philips.** The public pages describe the principle (skin colour for pulse, chest and abdomen movement for breathing, face tracking) and give no measurement flow or thresholds (https://www.philips.com/a-w/about/innovation/ips/ip-licensing/programs/biosensing-by-rppg.html). The technical substance is in the de Haan and Wang papers cited above, which are Philips research.

**Noldus FaceReader** (a vendor guide worth copying for the operator page): diffuse frontal light, no bright spots on the forehead, face at least 100 × 100 px, 0.5 to 1 m, at least 15 fps and preferably 30, minimal compression, shoulders in view for breathing (https://noldus.com/shared/resources/book/noldus-product-documentation/chapter/facereader/page/facereader-10-guidelines-for-an-optimal-vital-signs-measurement).

The common shape: guide before measuring; be lenient during; decide once at the end on a long window; say why when it fails; make a retry cheap.

## 7. Camera-side factors on an iPhone

What we already do right: fixed frame duration, exposure, white balance and focus locked after metering on the face, HDR off, stabilisation off, low-light boost off, uncompressed frames straight from the sensor pipeline (so the compression findings below apply to our evaluation datasets, not to the live path).

- **Local tone mapping stays on under exposure lock.** An Apple media engineer, replying to a developer who saw brightness in a fixed patch change when something dark entered the edge of the frame with exposure locked: "What you are seeing is called local tone mapping, which is still active even when your exposure is locked", and it can be replaced by setting `globalToneMappingEnabled` on the capture device, which "will still adapt slightly, but less noticeably" (https://developer.apple.com/forums/thread/780406). We do not set it. This is a plausible silent cause of both lost signal and false "motion" (our motion flag is a 2% brightness deviation), for example when the operator or anything else moves at the edge of the frame. It is a hypothesis to test, not a diagnosis.
- **Lock timing.** Developers report that custom exposure takes effect with a delay (https://developer.apple.com/forums/thread/749574, via search summary). We mark frames as locked from the completion handler, which is the right approach; worth confirming in the sitting file that no brightness step follows the first "locked" frame.
- **Mains flicker.** Lamps flicker at twice the mains frequency. A rolling-shutter sensor shows it as bands unless the exposure time is a whole number of flicker periods (US 8711245, https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8711245, via search summary). At 60 Hz mains that means exposure of 1/120 s or 1/60 s; at 60 fps under 60 Hz mains the flicker is also synchronous with the frame rate. Our lock keeps whatever duration auto-exposure chose, which need not be flicker-safe. The engine's flicker veto then throws away any window whose peak is within 6 bpm of the alias, which at a frame rate that drifts slightly off 60 can sit anywhere. Fixing the exposure time at capture is better than vetoing in the engine. I found no Apple document on this; the mechanism is from patents and camera guides.
- **Frame rate.** Blackford and Estepp 2015 reduced 120 fps to 60 and 30 fps and halved the resolution with "little observable difference" in pulse-rate error (https://doi.org/10.1117/12.2083940, abstract only). DeepAffex asks for 25 fps minimum, 30 recommended. FaceHeart's cleared configuration is VGA at 30 fps. So 60 fps buys nothing for heart rate; it helps beat timing (DistancePPG notes ±16.6 ms peak ambiguity at 30 fps) at the price of a shorter maximum exposure and more noise per frame. In dim rooms 30 fps with a 1/60 s exposure is the better trade.
- **Dropped frames and timestamps.** DeepAffex requires accurate per-frame timestamps; we already resample from timestamps. Our 85% sample-share and 0.25 s gap rules are stricter than Binah's 0.5 s tolerance.
- **Compression** (affects `eval/`, not the phone). McDuff, Blackford and Estepp 2017, stationary task, x264: pulse-rate error 1.78 bpm on raw video, 2.17 at CRF 6, 3.35 at CRF 18, 7.01 at CRF 30; SNR falls from −7.80 dB raw to −11.3 dB at CRF 18. "At CRF values of 30 or above, the signal is severely reduced", and the damage starts before the picture looks worse (https://www.microsoft.com/en-us/research/uploads/prod/2020/11/McDuff_2017_Impact2.pdf; figures as I read them from the extracted table). This is the likely reason MCD-rPPG scores so badly for us, and a reason not to tune gates on compressed footage.
- **Light level and distance.** FaceHeart: above 300 lux. PanopticAI: tested 100 to 500 lux. Google: no significant difference between 95 to 110 lux and 160 to 200 lux for the finger method. DistancePPG: most recordings at about 500 lux. NuraLogix: closer is better, more light for darker skin. Binah: face filling most of the frame at 20 to 40 cm.
- **Sensor exposure of the face.** Our lock accepts face luma from 50 to 215 of 255. I found no source giving an optimal value; the general argument (more photons, no clipping) favours the upper middle of the range. Unverified, so no number is proposed.

## 8. Breathing rate

- **Chest motion.** Google: torso region from the face box (1.4 × face height, 2.5 × face width), vertical optical flow averaged over the full region and four quadrants, power spectra summed, peak within 6 to 60 breaths per minute, 30 s of video, zero-crossing count when spectral SNR is low. MAE 0.78 ± 0.61 breaths per minute in 50 people, and "both versions of the algorithm successfully estimated RR in all of the study subjects" (https://pmc.ncbi.nlm.nih.gov/articles/PMC9053269/). Noldus requires the shoulders in view. Oxehealth's cleared claim is 8 to 31 breaths per minute within ±2 on a 30 s window (K223622 comparison table).
- **Respiration in the pulse signal.** van Gastel, Stuijk and de Haan 2016 take the colour-channel weights that best extract the pulse (CHROM or PBV, per sub-region, chosen by pulse SNR) and apply the same weights to the 10 to 40 breaths per minute band, which recovers the baseline modulation while suppressing motion. Guided breathing, visible light, CHROM: r = 0.962, MAE 1.74 breaths per minute; under head motion 2.10. Shallow breathing is worse (3.22). The data are four adults (https://pmc.ncbi.nlm.nih.gov/articles/PMC5175543/). The authors suggest combining it with a motion-based method.
- **Fusion.** Karlen et al. 2013 estimate breathing from three modulations of the PPG (frequency, intensity, amplitude) and average them, discarding windows where the three disagree; the reported mean RMSE is 3.0 breaths per minute for the fusion against 3.9 to 6.2 for the single modulations (via search summary of the abstract; the disagreement threshold itself I could not verify). Charlton et al. 2016 found the best of 314 algorithms were combinations of time-domain estimation with modulation fusion (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5390977/, via search summary).

Relative to us: one chest signal, one spectrum, a 40 s minimum window, then three agreeing windows, so the first breathing value cannot appear before about 42 s of a 60 s sitting, and any chest tracking gap over 0.5 s restarts it. The sources get an answer from 30 s, use several sub-regions, and fall back to counting in the time domain instead of refusing.

## 9. Ranked changes for the engine

Ordered by reliability gained per unit of effort. "Engine" means maths in `packages/signal-engine` only; "Capture" means a change in `apps/mobile/modules/triage-capture` (no new native dependency in any of them); "Contract" means an additive change in `packages/contracts`.

Every threshold below is a starting value. Requirement 2 of the master plan still decides: after each change, replay the negative controls and set the threshold so that fewer than 5% of control windows (or control sittings, for item 1) produce a value.

**1. Give the sitting its own estimate, computed from the whole recording. (Engine)**
At `finish()`, independent of how many live readings were valid:
- Take every 10 s window at a 1 s step over the usable frames, with no agreement gate and no quality veto. For each, compute the fused pulse waveform and its Hann-windowed power spectrum on the existing 4096-bin grid, normalised to unit total power in 0.7 to 3 Hz.
- Sum the normalised spectra (weight each by its window's SNR from item 2, floor 0). Take the strongest peak of the sum with the existing edge and sub-harmonic logic. Score it with the item 2 SNR on the summed spectrum.
- Cross-check: the median of the per-window peak rates must lie within 5 bpm of the summed-spectrum peak, and at least half of the windows must have their own peak within 5 bpm of it. If so, report it as the sitting's heart rate with a confidence tier (item 3). If the resting rate drifted more than that, fall back to the median of per-window rates that pass the item 2 gate.
- Sources: summed spectra, Google (PMC9053269) and pyVHR; decision on the whole measurement, Binah final results, NuraLogix 30 s rule, PanopticAI 30 s and FaceHeart 1 min windows.
- Why first: it converts "no three consecutive perfect windows" into "the same peak shows up across the minute", which is the situation of a still subject with a weak signal. It leaves the live gates and requirement 11 untouched because it never feeds the live value.

**2. Replace the quality score with the de Haan SNR and recalibrate. (Engine)**
- signal = power within ±6 bpm (±0.1 Hz) of the candidate f plus power within ±6 bpm of 2f; noise = remaining power in the band; SNR = 10 log10(signal / noise). Keep evaluating it at the frequency that is reported (requirement 1). For short windows keep a floor on the half-width of 1.25 / T so the main lobe is covered.
- Widen the scored band to 0.7 to 4 Hz (pyVHR and Face2PPG use 4 Hz) while keeping the search range at 42 to 180 bpm, so the second harmonic of rates up to 120 bpm is inside the band.
- Recalibrate on the negative controls. Reference points for where it may land, not targets: NuraLogix refuses below 0.5 dB on its own scale, Google's finger method below 0 dB, DistancePPG drops a region below −6 dB, and POS on UBFC-rPPG averages −2.39 dB.
- Source: https://github.com/ubicomplab/rPPG-Toolbox/blob/main/evaluation/post_process.py; Wang et al. 2017 section V.

**3. Three outcomes instead of two, and k-of-n agreement instead of three in a row. (Engine, Contract)**
- Add a "low confidence" state between valid and none. High: SNR above the calibrated threshold and methods agree (item 5). Low: a peak exists, SNR is between a lower calibrated bound and the threshold, and it agrees with the last accepted rate or with the sitting estimate within 5 bpm. None: otherwise, with the reason. The dashboard shows low-confidence values in the muted style and the operator page offers "measure again".
- Agreement gate: accept when 3 of the last 5 windows produced a rate within 5 bpm of each other, instead of 3 consecutive. One failed window no longer empties the run.
- Tracking prior without holding: when choosing among peaks, any peak within ±16 bpm of the last accepted rate and above 30% of the strongest peak is preferred (TROIKA's Δ and η); the value shown is still this window's own peak, so requirement 11 holds. Keep the Gate A elevated-rate test as the guard.
- Sources: Binah confidence levels; NuraLogix chunk rules (two of three chunks); TROIKA, https://ar5iv.labs.arxiv.org/html/1409.5181.

**4. Stop discarding the history for sub-second dropouts. (Engine)**
- A run of frames with no face, or with exposure not locked, shorter than 0.5 s should be bridged (interpolate the region means across it and mark those frames as invalid for the window's sample share) instead of calling `endSegment()`. Only a longer run, or a changed face track id, resets. Raise `maximumGapSeconds` from 0.25 to 0.5 to match.
- Source: Binah processes every frame with a face by default, and even its strict mode tolerates 0.5 s gaps twice before ending a session (https://developer.binah.ai/ios/latest/measuring/measurement-guidance.html).
- Why: one missed face detection today costs at least 8 s of a 60 s sitting.

**5. Run CHROM beside POS and use their agreement. (Engine)**
- CHROM per region with the parameters in section 2 (1.6 s Hann windows, 50% overlap, band-pass before the alpha ratio). Fuse regions as for POS.
- If the POS and CHROM rates agree within 5 bpm: report the POS rate, and count agreement towards "high" confidence. If they disagree: report the one with the higher item 2 SNR as low confidence, or none if neither passes the lower bound.
- In item 1, add both methods' spectra to the sum.
- Sources: rPPG-Toolbox Table 2 (POS and CHROM are the only two that hold on both PURE and UBFC-rPPG); Wang et al. Table I. Agreement as a quality index is my extrapolation from pyVHR's median over estimators, not a published result.

**6. Make motion a weight, not a veto, and check the 2% brightness rule. (Engine)**
- Replace "more than 5% of frames in motion rejects the window" with DistancePPG's rule applied per region: drop a region from this window's fusion when its max-minus-min in the window exceeds a threshold (they use 8 of 255 intensity units on a green-filtered camera; calibrate ours on recorded sittings), and reject the window only when no region is left.
- The FDA-cleared FaceHeart flow "supports minor movement (speak or nod slightly)" and NuraLogix says "small movements are acceptable"; POS exists to tolerate them. A 5% frame budget is far stricter than either.
- Source: https://ar5iv.labs.arxiv.org/html/1502.08040 section 7.1.

**7. Capture: global tone mapping, flicker-safe shutter, 30 fps in dim light. (Capture)**
- Set `isGlobalToneMappingEnabled = true` when the format supports it, before metering (Apple forum thread 780406). Confirm the property name against the SDK in use.
- When locking, choose the exposure duration from the flicker-safe set (1/120 s or 1/60 s for 60 Hz mains; 1/100 s or 1/50 s for 50 Hz) nearest to what auto-exposure metered, and let ISO absorb the difference via `setExposureModeCustom(duration:iso:)`. With that in place the engine's flicker veto can be reduced to a diagnostic.
- If metered ISO is high at 60 fps, drop to 30 fps and 1/60 s (Blackford and Estepp; DeepAffex recommends 30 fps).
- Needs a person with a device to verify; add to the backlog's "needs a person" list.

**8. Guide before measuring, and say why afterwards. (Capture, web copy)**
- Pre-measurement checks on the operator page with a short countdown, as Anura and Binah do: face size (Binah: face fills most of the frame, 20 to 40 cm; PanopticAI: 0.4 to 0.6 m), face centred and frontal, even light on both cheeks (Binah's `unevenLight`: compare left and right cheek luma, which we already sample), enough light (FaceHeart: above 300 lux; we can use metered ISO as the proxy), glasses and caps off.
- On a low-confidence or failed sitting, show the single most likely cause from the engine's reasons and a "measure again" button. Google's data says a retry policy lifts success from 83% to 95%.

**9. More regions and a vote. (Capture, Engine, Contract)**
- Sample at least seven regions on the phone: three forehead thirds, glabella, two malar regions, chin (DistancePPG's seven; Kim et al.'s top five are a subset).
- Keep the weighted sum, and add the median of per-region rates with its MAD (pyVHR). A MAD under about 3 bpm across regions is a strong confidence signal; a single outlier region is ignored. The threshold is my suggestion and needs calibrating.
- Sources: Kim et al. Table 8 (top-five regions against whole face, CHROM on UBFC 1.5 against 2.67); Face2PPG Table 1 (UBFC1 POS 1.8 single region against 0.8 multi-region).
- Lower in the list only because it touches the capture module, the sitting file format and the contract.

**10. Smoothness-priors detrending. (Engine)**
- Replace the straight-line detrend of the projected signal with Tarvainen's method, λ = 100 at 30 Hz as in rPPG-Toolbox (scale λ for our 60 Hz grid so the cut-off stays the same; the regulariser is a second difference, so the equivalent λ grows with the square of the rate ratio, my derivation, verify numerically). Solve the pentadiagonal system directly; it needs no dependency beyond Accelerate.
- Expected gain is small for a still subject because the band-pass already removes most drift; it helps the open-band sub-harmonic test, which today sees straight-line-detrended data.

**11. Breathing: 30 s window, sub-regions, time-domain fallback. (Engine, optionally Capture)**
- Lower `breathingMinimumWindowSeconds` from 40 to 30 (Google and Oxehealth both use 30 s).
- When the spectral peak fails the quality gate, count zero crossings of the band-passed chest signal over the window and report half the count per minute as low confidence, as Google does below −6 or −4 dB.
- Give breathing the same whole-sitting estimate as item 1.
- With a capture change: report chest motion for the full torso box and four quadrants and sum their spectra (Google).
- Second opinion from the pulse signal: apply the fused POS or CHROM waveform's region weights to the 10 to 40 breaths per minute band of the same colour signals (van Gastel et al.) and require agreement within 2 breaths per minute for high confidence.

Items 1 to 6 are engine-only and can be verified on saved sittings with `engine-cli` and `eval/run_eval.py` before anyone touches a phone. Coverage on UBFC-rPPG (58% today) is the number to watch alongside the negative-control rate.

## 10. What I could not verify

- **de Haan and Jeanne 2013 (CHROM), original paper.** Not openly available. The SNR definition is taken from Wang et al.'s restatement and from the rPPG-Toolbox code; the exact harmonic window widths in the original are not confirmed.
- **Orphanidou et al. 2015, PPG signal quality rules.** Could not open the paper; the commonly quoted template-correlation threshold is therefore not given here.
- **Karlen et al. 2013, Smart Fusion disagreement threshold.** Abstract-level information only.
- **Charlton et al. 2016.** Abstract-level information only; the best PPG algorithm's limits of agreement were cut off in what I could read.
- **Temko 2017, Viterbi decoding for PPG heart rate.** Known from a search summary only.
- **pyVHR benchmark numbers on UBFC and PURE.** The PeerJ paper refused automated access. Only the code behaviour is reported.
- **Lam and Kuno 2015 (random patch voting).** Could not fetch; not used.
- **Blackford and Estepp 2015.** Abstract only; "little observable difference" is their wording, the statistics are not confirmed.
- **Binah confidence-level thresholds and measurement length in the SDK.** The pages I reached name the levels but not the rules. "Low confidence results are not reported" comes from a search summary of the 2024 accuracy report, not from a page I read in full.
- **NuraLogix's SNR formula.** Not published; their 0.5 dB threshold cannot be mapped onto ours.
- **FaceHeart K223622 comparison table.** Extracted from a PDF with a multi-column layout; I read "1 min" as the subject device's measurement window and "9 seconds" as the predicate's, which matches the PanopticAI summary's description of the same predicate.
- **McDuff et al. 2017 Table I.** Read from extracted text of a multi-column table; the stationary x264 row is as quoted, but check the PDF before putting any of it on a slide.
- **Philips.** No public description of measurement flow or failure handling found.
- **Apple guidance on flicker and on optimal face exposure for rPPG.** None found. The flicker mechanism is from patents and camera guides, and the tone-mapping statement is from one forum reply by an Apple engineer.
- **Our own failure.** Nothing here diagnoses the sitting that returned no reading. The comparisons in section 5 say the gates are stricter than the field's; which gate fired is the other agent's question.
