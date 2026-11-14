"""Adversarial synthetic sittings: the controls of QA round 1 (docs/research/engine-reliability-qa1.md),
kept so that they run with every measurement. Used by `reliability.py adversarial`.

Every sitting is generated: skin-coloured regions with sensor noise, and on top of that one thing
the engine must not take for a pulse, or a pulse it must not get wrong. Families:

noise      white, shot and 1/f sensor noise, 30 and 60 frames a second. No pulse.
flicker    mains flicker (100 and 120 Hz) sampled at nine frame rates, grey and coloured. No pulse.
lighting   light that changes in the pulse band: gain, gain before gamma, coloured, added white. No pulse.
movement   a head that nods, chews or talks: colour shares change, with a little brightness and glare.
           Half with no pulse, half with a 64 bpm pulse.
bobbing    a head that bobs: 3% or 6% of brightness at 1.0, 1.3 or 1.8 Hz, 0.2% or 0.6% of colour
           moving with it in a random direction. No pulse. (QA finding 1.)
leak       the same at 1.3 Hz with the colour part from 5% to 100% of the brightness part, at 1%, 3%
           and 6% of brightness. No pulse. Shows where the brightness test stops and the size test starts.
splice     two people, one after the other, with and without a new track id.
short      sittings of 8 to 30 s, with no pulse and with a faint one.
dropout    the face gone for long stretches, with no pulse and with a faint one.
jumps      colour that jumps every 1.85 to 3 s, with no pulse and with a 66 bpm pulse.
harmonics  pulses of 44 to 172 bpm with the second harmonic at 0.2, 1.0 or 1.5 of the fundamental.
weak       pulses of 45 to 175 bpm at a third to two thirds of the usual size (648 sittings; `--weak`).
cover      a 72 bpm person whose regions become pulse-free skin or a hand at 30 s: how long the rate stays.

From QA round 2 (docs/research/engine-reliability-qa2.md), generated as QA's own script did:

sliding    a head that moves so that each region slides over neighbouring skin a few per cent darker
           (eyebrow, hairline, shadow) at 0.9 to 2.2 Hz, with almost no brightness change. No pulse (48),
           and the same on top of a 66 or 96 bpm pulse (48). (QA finding W3.)
stillbeat  a still person with a real pulse of 50 to 110 bpm and a brightness rhythm of 0.1% to 1%
           locked to the beats, near the rate, or at half, double or a third of it (360). (QA finding W4.)
"""
import json
import pathlib

SKIN = [[182, 136, 118], [176, 128, 112], [174, 126, 110]]
GAINS = [1.0, 0.8, 0.8]
PULSE = [0.33, 1.0, 0.55]


def families(numpy, weak=False):
    np = numpy
    skin = np.array(SKIN, float)
    gains = np.array(GAINS)
    signature = np.array(PULSE)

    def times(seconds, fps, jitter=0.05, seed=0, actual=None):
        generator = np.random.default_rng(seed + 7)
        rate = actual or fps
        count = int(seconds * rate)
        t = np.arange(count) / rate + jitter * generator.normal(size=count) / rate
        return np.maximum.accumulate(t + np.arange(count) * 1e-9)

    def wave(t, bpm, harmonic=0.2, seed=0, hrv=30):
        generator = np.random.default_rng(seed + 11)
        beats = [0.0]
        while beats[-1] < t[-1] + 2:
            beats.append(beats[-1] + 60 / bpm + hrv / 1000 * generator.normal())
        beats = np.array(beats)
        index = np.searchsorted(beats, t, side="right") - 1
        phase = 2 * np.pi * (t - beats[index]) / (beats[index + 1] - beats[index])
        return np.cos(phase) + harmonic * np.cos(2 * phase)

    def still(t, generator, noise=0.25, base=skin):
        return base[None] * np.ones((len(t), 1, 1)) + noise * generator.normal(size=(len(t), 3, 3))

    def beating(colours, t, bpm, amplitude=0.35, harmonic=0.2, seed=0):
        return colours + amplitude * wave(t, bpm, harmonic, seed)[:, None, None] * gains[None, :, None] * signature[None, None, :]

    def pink(count, generator, shape):
        white = generator.normal(size=(count,) + shape)
        frequency = np.fft.rfftfreq(count)
        frequency[0] = frequency[1]
        spectrum = np.fft.rfft(white, axis=0) / np.sqrt(frequency)[(slice(None),) + (None,) * len(shape)]
        series = np.fft.irfft(spectrum, n=count, axis=0)
        return series / series.std()

    def noise():
        for seed in range(3):
            for fps in (30, 60):
                t = times(60, fps, seed=seed)
                generator = np.random.default_rng(seed)
                for sigma in (0.1, 1.0, 4.0):
                    yield f"white_s{sigma}_f{fps}_{seed}", t, still(t, generator, sigma)
                yield f"shot_f{fps}_{seed}", t, skin[None] + np.sqrt(skin[None] / 255) * 0.8 * generator.normal(size=(len(t), 3, 3))
                for size in (0.3, 1.0):
                    yield f"pink_a{size}_f{fps}_{seed}", t, still(t, generator, 0.25) + size * pink(len(t), generator, (3, 3))
                yield (f"pinkgain_f{fps}_{seed}", t,
                       skin[None] * (1 + 0.01 * pink(len(t), generator, (1, 1))) + 0.4 * pink(len(t), generator, (3, 3)))

    def flicker():
        for mains in (100, 120):
            for actual in (29.7, 29.85, 29.97, 30.0, 59.4, 59.7, 59.94, 24.4, 49.4):
                for depth in (0.01, 0.05):
                    for coloured in (False, True):
                        t = times(60, round(actual), seed=3, actual=actual, jitter=0.0)
                        generator = np.random.default_rng(int(actual * 10) + mains)
                        lamp = np.sin(2 * np.pi * mains * t)[:, None, None]
                        tint = np.array([1.0, 0.85, 0.6])[None, None, :] if coloured else 1.0
                        yield (f"mains{mains}_fps{actual}_d{depth}_{'col' if coloured else 'grey'}", t,
                               still(t, generator, 0.25) * (1 + depth * lamp * tint))

    def lighting():
        for hz in (0.8, 1.2, 1.7, 2.3):
            for kind in ("gain", "gamma_gain", "coloured", "additive_white"):
                for depth in (0.005, 0.02):
                    t = times(60, 30, seed=5)
                    c = still(t, np.random.default_rng(int(hz * 100)), 0.25)
                    light = np.sin(2 * np.pi * hz * t + 0.3 * np.sin(2 * np.pi * 0.05 * t))
                    if kind == "gain":
                        c = c * (1 + depth * light)[:, None, None]
                    elif kind == "gamma_gain":
                        c = 255 * np.clip((c / 255) ** 2.2 * (1 + 4 * depth * light)[:, None, None], 0, 1) ** (1 / 2.2)
                    elif kind == "coloured":
                        c = c * (1 + depth * light[:, None, None] * np.array([1.0, 0.7, 0.4])[None, None, :])
                    else:
                        c = c + 255 * depth * (1 + light)[:, None, None] * 0.5
                    yield f"{kind}_{hz}Hz_d{depth}", t, c

    def movement():
        for hz, label in ((1.1, "nod"), (1.5, "chew"), (2.0, "nodfast"), (4.0, "talk")):
            for size in (0.003, 0.01, 0.03):
                for bpm in (None, 64):
                    t = times(60, 30, seed=9)
                    c = still(t, np.random.default_rng(int(hz * 1000 + size * 1e5)), 0.25)
                    if bpm:
                        c = beating(c, t, bpm)
                    swing = np.sin(2 * np.pi * hz * t)
                    bright = 0.5 * size * np.sin(2 * np.pi * hz * t + 0.7)
                    glare = 0.3 * size * 255 * np.clip(swing, 0, None)
                    factor = ((1 + bright)[:, None, None] + (size * swing)[:, None, None]
                              * np.array([1.0, 0.6, -0.6])[None, :, None] * np.array([1.0, 0.8, 0.6])[None, None, :])
                    yield f"{label}_{hz}Hz_a{size}_" + (f"pulse{bpm}" if bpm else "nopulse"), t, c * factor + glare[:, None, None], bpm

    def bob(t, generator, hz, bright, chroma):
        c = still(t, generator, 0.25)
        swing = np.sin(2 * np.pi * hz * t + 0.4 * np.sin(2 * np.pi * 0.07 * t))
        direction = generator.normal(size=(3, 3))
        direction /= np.abs(direction).max()
        return c * (1 + bright * swing[:, None, None] + chroma * swing[:, None, None] * direction[None])

    def bobbing():
        for hz in (1.0, 1.3, 1.8):
            for bright in (0.03, 0.06):
                for chroma in (0.002, 0.006):
                    for seed in range(2):
                        t = times(60, 30, seed=21 + seed)
                        generator = np.random.default_rng(int(hz * 1000 + bright * 1e4 + chroma * 1e5 + seed))
                        yield f"{hz}Hz_b{bright}_c{chroma}_{seed}", t, bob(t, generator, hz, bright, chroma)

    def leak():
        for bright in (0.01, 0.03, 0.06):
            for share in (0.05, 0.1, 0.2, 0.33, 0.5, 1.0):
                for seed in range(4):
                    t = times(60, 30, seed=41 + seed)
                    generator = np.random.default_rng(int(bright * 1e4 + share * 1e3 + seed))
                    yield f"b{bright}_leak{share}_{seed}", t, bob(t, generator, 1.3, bright, bright * share)

    def splice():
        for a, b, newtrack in ((62, 108, False), (62, 108, True), (75, 95, False), (58, 120, False)):
            for size in (0.35, 0.12):
                t = times(60, 30, seed=13)
                generator = np.random.default_rng(a * b)
                first = t < 30
                base = np.where(first[:, None, None], skin[None], (skin * np.array([0.8, 0.82, 0.86]))[None])
                c = base + 0.25 * generator.normal(size=(len(t), 3, 3))
                c = c + size * np.where(first, wave(t, a, seed=1), wave(t, b, seed=2))[:, None, None] * gains[None, :, None] * signature
                yield (f"{a}_{b}_amp{size}_{'newtrack' if newtrack else 'sametrack'}", t, c, (a, b), None,
                       np.where(first, 1, 2) if newtrack else None)

    def short():
        for seconds in (8, 12, 16, 20, 25, 30):
            for bpm in (None, 72):
                t = times(seconds, 30, seed=17)
                c = still(t, np.random.default_rng(seconds), 0.25)
                yield f"{seconds}s_{'pulse72weak' if bpm else 'nopulse'}", t, beating(c, t, bpm, amplitude=0.12) if bpm else c, bpm

    def dropout():
        for gaps in (((10, 40),), ((5, 20), (30, 45)), ((12, 14), (24, 26), (36, 38), (48, 50))):
            for bpm in (None, 80):
                t = times(60, 30, seed=19)
                c = still(t, np.random.default_rng(len(gaps) * 7), 0.25)
                if bpm:
                    c = beating(c, t, bpm, amplitude=0.12)
                present = np.ones(len(t), bool)
                for start, end in gaps:
                    present[(t >= start) & (t < end)] = False
                track = 1 + np.cumsum(np.r_[0, np.diff(present.astype(int)) > 0])
                label = "+".join(f"{start}-{end}" for start, end in gaps)
                yield f"{label}_{'pulse80weak' if bpm else 'nopulse'}", t, c, bpm, present, track

    def jumps():
        for period in (1.85, 2.0, 2.4, 3.0):
            for bpm in (None, 66):
                for size in (0.03, 0.08):
                    t = times(60, 30, seed=23)
                    generator = np.random.default_rng(int(period * 100 + size * 1000))
                    c = still(t, generator, 0.25)
                    if bpm:
                        c = beating(c, t, bpm, amplitude=0.2)
                    level = np.ones((len(t), 3, 3))
                    for at in np.arange(3, 60, period):
                        level[t >= at] = 1 + size * generator.normal(size=(3, 3)) * np.array([1, 0.7, 0.5])
                    yield f"every{period}s_size{size}_{'pulse66' if bpm else 'nopulse'}", t, c * level, bpm

    def harmonics():
        for bpm in (44, 46, 50, 56, 60, 66, 75, 145, 150, 160, 172):
            for size, harmonic in ((0.35, 0.2), (0.12, 0.2), (0.08, 0.2), (0.12, 1.5), (0.08, 1.5), (0.35, 1.5), (0.12, 1.0)):
                t = times(60, 30, seed=29)
                generator = np.random.default_rng(bpm * 7 + int(size * 100))
                yield f"hr{bpm}_amp{size}_h{harmonic}", t, beating(still(t, generator, 0.5), t, bpm, amplitude=size, harmonic=harmonic), bpm

    def weak_pulses():
        for bpm in range(45, 176, 5):
            for size in (0.12, 0.16, 0.2, 0.25):
                for harmonic in (0.2, 0.6):
                    for seed in range(3):
                        t = times(60, 30, seed=100 + seed)
                        generator = np.random.default_rng(bpm * 1000 + int(size * 100) * 10 + seed + int(harmonic * 10))
                        yield (f"hr{bpm}_a{size}_h{harmonic}_s{seed}", t,
                               beating(still(t, generator, 0.5), t, bpm, amplitude=size, harmonic=harmonic, seed=seed), bpm)

    def cover():
        hand = np.array([[200, 150, 130]] * 3, float)
        for step in ("none", "bright+5", "bright-10", "hand"):
            for seed in range(8):
                t = times(60, 30, seed=200 + seed)
                c = beating(still(t, np.random.default_rng(300 + seed), 0.25), t, 72, seed=seed)
                empty = still(t, np.random.default_rng(400 + seed), 0.25)
                if step == "bright+5":
                    empty = empty * 1.05
                elif step == "bright-10":
                    empty = empty * 0.9
                elif step == "hand":
                    empty = hand[None] + 0.25 * np.random.default_rng(500 + seed).normal(size=(len(t), 3, 3))
                c[t >= 30] = empty[t >= 30]
                yield f"{step}_{seed}", t, c, 72

    def qa_times(seconds, fps, seed):
        generator = np.random.default_rng(seed + 7)
        count = int(seconds * fps)
        t = np.arange(count) / fps + 0.05 * generator.normal(size=count) / fps
        return np.maximum.accumulate(t + np.arange(count) * 1e-9)

    def qa_pulse(t, bpm, harmonic=0.2, seed=0, hrv_ms=30):
        generator = np.random.default_rng(seed + 11)
        beats = [0.0]
        while beats[-1] < t[-1] + 2:
            beats.append(beats[-1] + 60 / bpm + hrv_ms / 1000 * generator.normal())
        beats = np.array(beats)
        index = np.searchsorted(beats, t, side="right") - 1
        phase = 2 * np.pi * (t - beats[index]) / (beats[index + 1] - beats[index])
        return np.cos(phase) + harmonic * np.cos(2 * phase), phase

    def sliding():
        neighbour = np.array([[-1.0, -1.6, -1.5], [-0.6, -1.0, -1.1], [-0.6, -1.0, -1.1]])
        for with_pulse in (False, True):
            for hz in (0.9, 1.2, 1.6, 2.2):
                for travel in (0.2, 0.5, 1.0):
                    for contrast in (0.02, 0.05):
                        for seed in (0, 1):
                            t = qa_times(60, 30, seed)
                            generator = np.random.default_rng(seed * 7 + int(hz * 10))
                            c = skin[None] * np.ones((len(t), 1, 1)) + 0.25 * generator.normal(size=(len(t), 3, 3))
                            bpm = None
                            if with_pulse:
                                bpm = 66 if abs(hz * 60 - 66) > 12 else 96
                                wave, _ = qa_pulse(t, bpm, seed=seed)
                                c = c + 0.35 * wave[:, None, None] * gains[None, :, None] * signature[None, None, :]
                            position = np.sin(2 * np.pi * hz * t + 0.3 * np.sin(2 * np.pi * 0.07 * t))
                            share = travel * 0.5 * (1 + position) * 0.3
                            c = c * (1 + contrast * share[:, None, None] * neighbour[None])
                            c = c * (1 + 0.002 * travel * position)[:, None, None]
                            name = f"{hz}Hz_tr{travel}_k{contrast}_s{seed}" + (f"_hr{bpm}" if with_pulse else "")
                            yield (name, t, c, bpm) if with_pulse else (name, t, c)

    def stillbeat():
        for bpm in (50, 60, 72, 90, 110):
            for size in (0.35, 0.18):
                for kind, multiple in (("bcg", 1.0), ("near", 0.93), ("near", 1.07), ("half", 0.5), ("double", 2.0),
                                       ("third", 1 / 3)):
                    for swing in (0.001, 0.003, 0.01):
                        for seed in (0, 1):
                            t = qa_times(60, 30, seed)
                            generator = np.random.default_rng(seed * 1000 + bpm)
                            c = skin[None] * np.ones((len(t), 1, 1)) + 0.25 * generator.normal(size=(len(t), 3, 3))
                            wave, phase = qa_pulse(t, bpm, seed=seed)
                            c = c + size * wave[:, None, None] * gains[None, :, None] * signature[None, None, :]
                            if kind == "bcg":
                                rhythm = np.sin(phase - 0.8) + 0.4 * np.sin(2 * (phase - 0.8))
                            else:
                                angle = 2 * np.pi * bpm / 60 * multiple * t + 0.4 * np.sin(2 * np.pi * 0.03 * t)
                                rhythm = np.sin(angle) + 0.3 * np.sin(2 * angle + 0.5) + 0.15 * np.sin(3 * angle + 1)
                            c = c * (1 + swing * rhythm / np.abs(rhythm).max())[:, None, None]
                            yield f"{kind}{multiple:.2f}_hr{bpm}_a{size}_b{swing}_s{seed}", t, c, bpm

    listed = {"noise": noise, "flicker": flicker, "lighting": lighting, "movement": movement, "bobbing": bobbing,
              "leak": leak, "splice": splice, "short": short, "dropout": dropout, "jumps": jumps,
              "harmonics": harmonics, "cover": cover, "sliding": sliding, "stillbeat": stillbeat}
    if weak:
        listed["weak"] = weak_pulses
    return listed


def write(path, t, colours, present=None, track=None):
    """One sitting file. `colours` is frames by region by channel."""
    lines = [json.dumps({"format": "triagecam.sitting", "version": 1, "source": "simulated", "nominalFrameRate": 30,
                         "startedAt": "2026-11-14T00:00:00.000Z", "captureStart": 1000,
                         "note": "adversarial control " + path.stem})]
    for index in range(len(t)):
        there = True if present is None else bool(present[index])
        frame = {"t": 1000 + float(t[index]), "facePresent": there, "exposure": "locked", "droppedFrames": 0,
                 "faceTrackId": (int(track[index]) if track is not None else 1) if there else None}
        if there:
            for region, key in enumerate(("forehead", "leftCheek", "rightCheek")):
                frame[key] = dict(zip("rgb", map(float, colours[index, region])))
        lines.append(json.dumps(frame))
    path.write_text("\n".join(lines) + "\n")


def generate(folder, numpy, weak=False):
    """Writes every family under `folder` and returns [(family, file, truth)], where truth is
    None (no pulse), a rate in bpm, or a pair of rates (splice)."""
    folder = pathlib.Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    listed = []
    for family, make in families(numpy, weak).items():
        for item in make():
            name, t, colours = item[:3]
            truth = item[3] if len(item) > 3 else None
            path = folder / f"{family}_{name}.jsonl"
            if not path.exists():
                write(path, t, colours, item[4] if len(item) > 4 else None, item[5] if len(item) > 5 else None)
            listed.append((family, path, truth))
    return listed
