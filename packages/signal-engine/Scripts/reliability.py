"""Measurements behind docs/research/engine-reliability-results.md.

    python3 packages/signal-engine/Scripts/reliability.py score    --sittings <dir> --set tuning
    python3 packages/signal-engine/Scripts/reliability.py controls --sittings <dir> --set tuning --work <dir>
    python3 packages/signal-engine/Scripts/reliability.py accepts  --work <dir> --set tuning
    python3 packages/signal-engine/Scripts/reliability.py degrade  --sittings <dir> --set tuning --work <dir>
    python3 packages/signal-engine/Scripts/reliability.py adversarial --work <dir> [--weak]

`--sittings` is a folder of sitting files with a `<name>.reference.jsonl` beside each, as the
evaluation harness leaves them in its output directory (`<out>/ubfc`). `--set` is `tuning` or
`heldOut` of the split file (`--split`, default the harness's split.json). `--engine` is an
engine-cli binary (default this package's release build), so the same command scores an older
build for the "before" column. Add `--config '{"field": value}'` to change EngineConfiguration
fields, and `--extra <sitting file>` to `score` or `controls` for a sitting with no reference.

score     coverage, error and readings within 5 bpm of the one-second readings, and how many
          sittings end with a heart rate, by where it came from.
controls  writes negative controls, sittings with no pulse in them, to <work>/controls/<set>:
          each real sitting with its frames shuffled inside blocks of 0.7 to 1.6 s (the colours
          and their noise stay, the rhythm goes), synthetic white noise and a grey wall, and
          skin whose colour wanders (first-order autoregressive noise) with and without steps to
          a new level. `--repeats 4` gives the 588 (tuning) and 636 (held-out) used in the
          results; `--seed` moves every random draw, and the held-out set used 770000.
accepts   runs the controls and counts the seconds and the sittings that gave a heart rate.
degrade   adds white noise of 0 to 3 counts to every colour of the real sittings and scores
          them: does a sitting with a weaker signal still end with the right rate, or a wrong one.
adversarial  writes and runs the synthetic controls of QA round 1 (Scripts/adversarial.py lists the
          families): noise, flicker, lighting, a moving and a bobbing head, splices, short sittings,
          dropouts, periodic jumps, harmonics and a covered face. For sittings with no pulse it counts
          those that end with a heart rate; for sittings with one, those that end right, at double
          the rate, or otherwise wrong. `--weak` adds 648 faint pulses.

Controls and degraded sittings are derived from recordings of real people: keep `--work`
outside the repository. Needs numpy for `controls` and `degrade`.
"""
import argparse
import collections
import concurrent.futures
import json
import pathlib
import statistics
import subprocess
import sys
import tempfile

PACKAGE = pathlib.Path(__file__).resolve().parent.parent
REPO = PACKAGE.parent.parent
# References the harness's report marks as faulty (BUG-19): shown apart, never tuned to.
SUSPECT = {"subject11", "subject18", "subject20", "subject24"}
WITHIN_BPM = 5.0


def diagnose(engine, sitting, config):
    reference = sitting.with_name(sitting.stem + ".reference.jsonl")
    command = [str(engine), "diagnose", str(sitting)] + ([str(reference)] if reference.exists() else [])
    if config:
        command += ["--config", config]
    lines = subprocess.run(command, check=True, capture_output=True, text=True).stdout.splitlines()
    return [json.loads(line) for line in lines[:-1]], json.loads(lines[-1])


def run_all(engine, files, config):
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        return list(pool.map(lambda file: diagnose(engine, file, config), files))


def subjects(arguments):
    names = json.loads(pathlib.Path(arguments.split).read_text())["datasets"]["ubfc"][arguments.set]
    return [name for name in names if (pathlib.Path(arguments.sittings) / f"{name}.jsonl").exists()]


def source_of(summary):
    if summary["heartRate"].get("value") is None:
        return None
    return summary.get("heartRateSource", "readings")  # builds before the whole-sitting estimate have no source


def score_rows(label, files, results, keep):
    seconds = valid = 0
    errors, sources, right, wrong = [], collections.Counter(), 0, 0
    count = 0
    for file, (ticks, summary) in zip(files, results):
        if not keep(file.stem):
            continue
        count += 1
        seconds += len(ticks)
        references = [tick["referenceBpm"] for tick in ticks if "referenceBpm" in tick]
        for tick in ticks:
            if tick["state"] == "valid":
                valid += 1
                if "referenceBpm" in tick:
                    errors.append(tick["value"] - tick["referenceBpm"])
        source = source_of(summary)
        if source:
            sources[source] += 1
            if references:
                close = abs(summary["heartRate"]["value"] - statistics.mean(references)) <= WITHIN_BPM
                right += close
                wrong += not close
    if not count:
        return
    mae = statistics.mean(map(abs, errors)) if errors else float("nan")
    within = sum(abs(error) <= WITHIN_BPM for error in errors) / len(errors) if errors else float("nan")
    print(f"{label}: {count} sittings, {seconds} s, coverage {valid / seconds:.1%}, MAE {mae:.2f} bpm, "
          f"readings within 5 bpm {within:.1%}; sittings with a heart rate {sum(sources.values())} {dict(sources)}, "
          f"within 5 bpm of the mean reference {right}, further off {wrong}")


def score(arguments):
    files = [pathlib.Path(arguments.sittings) / f"{name}.jsonl" for name in subjects(arguments)]
    files += [pathlib.Path(extra) for extra in arguments.extra]
    results = run_all(arguments.engine, files, arguments.config)
    score_rows(f"{arguments.set}, all", files, results, lambda name: True)
    if any(file.stem in SUSPECT for file in files):
        score_rows(f"{arguments.set}, without the four faulty references", files, results, lambda name: name not in SUSPECT)
    print()
    print("| Sitting | Seconds | Valid | Heart rate (bpm) | From | Mean reference | Whole-sitting peak | Quality | Prominence | Support | Stretches | Accepted |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    number = lambda value, form="{:.1f}": "" if value is None else form.format(value)
    for file, (ticks, summary) in zip(files, results):
        references = [tick["referenceBpm"] for tick in ticks if "referenceBpm" in tick]
        whole = summary.get("wholeSitting") or {}
        print(f"| {file.stem[:12]} | {len(ticks)} | {sum(tick['state'] == 'valid' for tick in ticks)} "
              f"| {number(summary['heartRate'].get('value'))} | {source_of(summary) or summary['heartRate'].get('reason', '')} "
              f"| {number(statistics.mean(references) if references else None)} | {number(whole.get('heartRate'))} "
              f"| {number(whole.get('quality'), '{:.2f}')} | {number(whole.get('prominence'))} | {number(whole.get('support'), '{:.2f}')} "
              f"| {whole.get('supportingStretches', '')} | {'yes' if whole.get('accepted') else ''} |")


def shuffled(source, target, generator):
    lines = source.read_text().splitlines()
    frames = [json.loads(line) for line in lines[1:]]
    keys = ("forehead", "leftCheek", "rightCheek")
    start = 0
    while start < len(frames):
        until = frames[start]["t"] + generator.uniform(0.7, 1.6)
        end = start
        while end < len(frames) and frames[end]["t"] < until:
            end += 1
        block = [index for index in range(start, end) if frames[index].get("facePresent")]
        colours = [{key: frames[index].get(key) for key in keys} for index in generator.permutation(block)]
        for index, colour in zip(block, colours):
            for key in keys:
                if colour[key] is not None:
                    frames[index][key] = colour[key]
        start = end
    target.write_text("\n".join([lines[0]] + [json.dumps(frame) for frame in frames]) + "\n")


def wandering(target, generator, numpy, rate, memory, percent, steps):
    count = int(60 * rate)
    base = numpy.array([[182, 136, 118], [176, 128, 112], [174, 126, 110]], float)

    def autoregressive(shape):
        values = numpy.zeros((count,) + shape)
        drive = generator.normal(size=(count,) + shape) * numpy.sqrt(1 - memory * memory)
        for index in range(1, count):
            values[index] = memory * values[index - 1] + drive[index]
        return values

    light = autoregressive((1, 3)) * percent
    own = autoregressive((3, 3)) * percent * 0.7
    white = generator.normal(size=(count, 3, 3)) * 0.3
    level, red = numpy.ones(count), numpy.ones(count)
    if steps:
        for at in numpy.sort(generator.uniform(8, 55, size=8)):
            level[int(at * rate):] *= generator.uniform(0.88, 1.13)
            red[int(at * rate):] *= generator.uniform(0.96, 1.04)
    lines = [json.dumps({"format": "triagecam.sitting", "version": 1, "source": "simulated", "nominalFrameRate": rate,
                         "startedAt": "2026-11-14T00:00:00.000Z", "captureStart": 1000, "note": "negative control: wandering colour"})]
    for index in range(count):
        colour = base * (1 + (light[index] + own[index]) / 100) * level[index] + white[index]
        colour[:, 0] *= red[index]
        frame = {"t": 1000 + index / rate, "facePresent": True, "exposure": "locked", "droppedFrames": 0, "faceTrackId": 1}
        for region, key in enumerate(("forehead", "leftCheek", "rightCheek")):
            frame[key] = dict(zip("rgb", map(float, colour[region])))
        lines.append(json.dumps(frame))
    target.write_text("\n".join(lines) + "\n")


def controls(arguments):
    import numpy
    folder = pathlib.Path(arguments.work) / "controls" / arguments.set
    folder.mkdir(parents=True, exist_ok=True)
    sources = [pathlib.Path(arguments.sittings) / f"{name}.jsonl" for name in subjects(arguments)]
    sources += [pathlib.Path(extra) for extra in arguments.extra]
    for repeat in range(arguments.repeats):
        seed = arguments.seed + 10000 * repeat
        for source in sources:
            for copy in range(3):
                shuffled(source, folder / f"shuffled_{source.stem[:12]}_{copy}_s{seed}.jsonl", numpy.random.default_rng(seed + copy))
        number = 0
        for subject in ("noise", "wall"):
            for noise in ("0.25", "0.5", "1", "2"):
                for rate in ("30", "60"):
                    for copy in range(3):
                        number += 1
                        subprocess.run([str(arguments.engine), "synth", str(folder / f"synth_{subject}_n{noise}_f{rate}_{copy}_s{seed}.jsonl"),
                                        "--subject", subject, "--noise", noise, "--fps", rate, "--seed", str(seed + 100 + number)], check=True)
        number = 0
        for memory in (0.5, 0.9, 0.97, 0.99):
            for percent in (0.2, 0.6, 1.5):
                for rate in (30, 60):
                    for steps in (False, True):
                        number += 1
                        wandering(folder / f"wandering_m{memory}_p{percent}_f{rate}_{'steps' if steps else 'plain'}_s{seed}.jsonl",
                                  numpy.random.default_rng(seed + 1000 + number), numpy, rate, memory, percent, steps)
    print(len(list(folder.glob("*.jsonl"))), "controls in", folder)


def accepts(arguments):
    files = sorted((pathlib.Path(arguments.work) / "controls" / arguments.set).glob("*.jsonl"))
    rows = collections.defaultdict(lambda: collections.Counter())
    listed = []
    for file, (ticks, summary) in zip(files, run_all(arguments.engine, files, arguments.config)):
        kind = file.stem.split("_")[0]
        if kind == "wandering":
            kind += ", with steps" if "steps" in file.stem else ", no steps"
        if kind == "synth":
            kind = "white noise" if "_noise_" in file.stem else "grey wall"
        valid = [tick["value"] for tick in ticks if tick["state"] == "valid"]
        source = source_of(summary)
        for row in (rows[kind], rows["all"]):
            row.update(controls=1, seconds=len(ticks), valid=len(valid), any=bool(valid), ended=source is not None,
                       whole=source == "whole_sitting")
        if source:
            listed.append(f"{file.stem}: {summary['heartRate']['value']:.1f} bpm from {source}, {len(valid)} valid seconds")
    print("| Control | Sittings | Valid seconds | Sittings with a valid second | Sittings ending with a heart rate | Of those, from the whole-sitting estimate |")
    print("|---|---|---|---|---|---|")
    for kind, row in rows.items():
        print(f"| {kind} | {row['controls']} | {row['valid']} of {row['seconds']} ({row['valid'] / row['seconds']:.2%}) | {row['any']} "
              f"| {row['ended']} ({row['ended'] / row['controls']:.1%}) | {row['whole']} |")
    print("\n".join(listed))


def degrade(arguments):
    import numpy
    folder = pathlib.Path(arguments.work) / "degraded" / arguments.set
    folder.mkdir(parents=True, exist_ok=True)
    names = [name for name in subjects(arguments) if name not in SUSPECT]
    for sigma in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0):
        files = []
        for number, name in enumerate(names):
            source = pathlib.Path(arguments.sittings) / f"{name}.jsonl"
            target = folder / f"{name}_n{sigma}.jsonl"
            files.append(target)
            if target.exists():
                continue
            generator = numpy.random.default_rng(arguments.seed + 1000 * number + int(10 * sigma))
            lines = source.read_text().splitlines()
            out = [lines[0]]
            for line in lines[1:]:
                frame = json.loads(line)
                for key in ("forehead", "leftCheek", "rightCheek"):
                    if frame.get(key):
                        for channel in "rgb":
                            frame[key][channel] += sigma * generator.normal()
                out.append(json.dumps(frame))
            target.write_text("\n".join(out) + "\n")
            target.with_name(target.stem + ".reference.jsonl").write_text(source.with_name(source.stem + ".reference.jsonl").read_text())
        score_rows(f"noise {sigma} counts", files, run_all(arguments.engine, files, arguments.config), lambda name: True)


def adversarial(arguments):
    import numpy
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import adversarial as controls_module
    listed = controls_module.generate(pathlib.Path(arguments.work) / "adversarial", numpy, arguments.weak)
    results = run_all(arguments.engine, [path for _, path, _ in listed], arguments.config)
    rows = collections.defaultdict(collections.Counter)
    notes = []
    lingering = collections.defaultdict(list)
    for (family, path, truth), (ticks, summary) in zip(listed, results):
        valid = [tick for tick in ticks if tick["state"] == "valid"]
        value = summary["heartRate"].get("value")
        if family == "cover":
            after = [tick["elapsed"] - 30 for tick in valid if tick["elapsed"] > 30.5]
            lingering[path.stem.split("_")[1]].append(round(max(after)) if after else 0)
            continue
        key = family if family in ("splice", "harmonics", "weak") else f"{family}, {'no pulse' if truth is None else 'with a pulse'}"
        row = rows[key]
        row.update(sittings=1, seconds=len(ticks), valid=len(valid), ended=value is not None,
                   whole=source_of(summary) == "whole_sitting", low=summary.get("heartRateConfidence") == "low")
        if value is None:
            continue
        rates = [] if truth is None else list(truth) if isinstance(truth, tuple) else [truth]
        if any(abs(value - rate) <= WITHIN_BPM for rate in rates):
            row.update(right=1)
        else:
            double = any(abs(value - 2 * rate) <= 6 for rate in rates)
            row.update(double=double, wrong=not double)
            notes.append(f"{path.stem}: {value:.1f} bpm from {source_of(summary)}, {len(valid)} valid seconds"
                         + (f", truth {truth}" if truth is not None else ""))
    print("| Family | Sittings | Valid seconds | End with a heart rate | Right | Double the rate | Otherwise wrong | From the whole-sitting estimate | Lower confidence |")
    print("|---|---|---|---|---|---|---|---|---|")
    for key, row in rows.items():
        pulse = "no pulse" not in key
        print(f"| {key} | {row['sittings']} | {row['valid']} of {row['seconds']} | {row['ended']} "
              f"| {row['right'] if pulse else ''} | {row['double'] if pulse else ''} | {row['wrong']} | {row['whole']} | {row['low']} |")
    print()
    print("Seconds a rate stays after the face is covered at 30 s (one figure per sitting):")
    for step, seconds in lingering.items():
        print(f"  {step}: {sorted(seconds)}")
    print()
    print("\n".join(notes))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("command", choices=["score", "controls", "accepts", "degrade", "adversarial"])
    parser.add_argument("--sittings")
    parser.add_argument("--set", choices=["tuning", "heldOut"], default="tuning")
    parser.add_argument("--split", default=str(REPO / "eval" / "split.json"))
    parser.add_argument("--engine", default=str(PACKAGE / ".build/release/engine-cli"))
    parser.add_argument("--work")
    parser.add_argument("--config")
    parser.add_argument("--extra", action="append", default=[])
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--weak", action="store_true")
    arguments = parser.parse_args()
    if arguments.command not in ("accepts", "adversarial") and not arguments.sittings:
        sys.exit("--sittings is needed")
    if arguments.command != "score" and not arguments.work:
        sys.exit("--work is needed, and belongs outside the repository")
    if arguments.config:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as file:
            file.write(arguments.config)
        arguments.config = file.name
    {"score": score, "controls": controls, "accepts": accepts, "degrade": degrade, "adversarial": adversarial}[arguments.command](arguments)


if __name__ == "__main__":
    main()
