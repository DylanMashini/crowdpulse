"""Which check refuses heart-rate readings, and how many of the refused windows were right.

    python3 eval/refusals.py eval/out/ubfc [more folders or sitting files]
        [--config overrides.json] [--set tuning|heldOut [--split eval/split.json]]

Runs `engine-cli diagnose` over every sitting file that has a `<name>.reference.jsonl` beside
it (what `run_eval.py` leaves in eval/out) and prints, per check, the seconds it refused and how
many of those windows held a candidate within 5 bpm of the reference. A sitting file without a
reference is still counted, by check only. Build first:

    swift build -c release --package-path packages/signal-engine

`--set` keeps only the sittings of that half of eval/split.json (a sitting belongs to the subject
its file name starts with), so that a change is chosen on the tuning set and checked on the other.
`--config` passes a JSON object of EngineConfiguration fields to change, for example
{"maximumMotionShare": 1} to see the readings with the motion check off.
"""
import collections
import json
import pathlib
import statistics
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
ENGINE = ROOT.parent / "packages/signal-engine/.build/release/engine-cli"
WITHIN_BPM = 5.0
# The order the engine applies its checks in (PulseGate).
GATES = ["no_frames", "no_face", "exposure_adjusting", "warming_up", "recent_gap", "too_few_samples", "motion",
         "incomplete_regions", "flat", "band_edge", "flicker", "illumination", "quality", "agreement"]


def sittings(arguments, subjects):
    for argument in arguments:
        path = pathlib.Path(argument)
        files = sorted(path.glob("*.jsonl")) if path.is_dir() else [path]
        for file in files:
            if file.name.endswith(".reference.jsonl"):
                continue
            # "subject12.jsonl" (UBFC) or "1020_FullHDwebcam_after.jsonl" (MCD): the subject comes first.
            if subjects is None or file.stem.split("_")[0] in subjects:
                yield file


def option(arguments, flag):
    """Removes `flag <value>` from the arguments and returns the value, or None."""
    if flag not in arguments:
        return None
    at = arguments.index(flag)
    value = arguments[at + 1]
    del arguments[at:at + 2]
    return value


def diagnose(sitting, config):
    reference = sitting.with_name(sitting.stem + ".reference.jsonl")
    command = [str(ENGINE), "diagnose", str(sitting)] + ([str(reference)] if reference.exists() else [])
    if config:
        command += ["--config", config]
    lines = subprocess.run(command, check=True, capture_output=True, text=True).stdout.splitlines()
    return [json.loads(line) for line in lines[:-1]], json.loads(lines[-1])


def percent(part, whole):
    return f"{100 * part / whole:.0f}%" if whole else "n/a"


def main():
    arguments = sys.argv[1:]
    config = option(arguments, "--config")
    half = option(arguments, "--set")
    split = option(arguments, "--split") or ROOT / "split.json"
    if not arguments or not ENGINE.exists():
        sys.exit(__doc__)
    subjects = None
    if half:
        datasets = json.loads(pathlib.Path(split).read_text())["datasets"]
        subjects = {subject for dataset in datasets.values() for subject in dataset[half]}

    rows = collections.defaultdict(lambda: collections.Counter())
    errors = collections.defaultdict(list)
    seconds = 0
    summaries = collections.Counter()
    per_sitting = []
    for sitting in sittings(arguments, subjects):
        ticks, summary = diagnose(sitting, config)
        seconds += len(ticks)
        valid = sum(t["state"] == "valid" for t in ticks)
        references = [t["referenceBpm"] for t in ticks if "referenceBpm" in t]
        candidates = [t["candidateBpm"] for t in ticks if "candidateBpm" in t]
        heart = summary["heartRate"]
        summaries["with a heart rate" if heart.get("value") is not None else f"no reading: {heart.get('reason')}"] += 1
        per_sitting.append((sitting.stem, len(ticks), valid, heart.get("value"), heart.get("reason"),
                            statistics.mean(references) if references else None,
                            statistics.median(candidates) if candidates else None))
        for tick in ticks:
            row = rows[tick.get("gate") or "valid"]
            row["seconds"] += 1
            estimate = tick.get("value", tick.get("candidateBpm"))
            if estimate is None:
                continue
            row["candidate"] += 1
            if "referenceBpm" not in tick:
                continue
            row["paired"] += 1
            error = estimate - tick["referenceBpm"]
            errors[tick.get("gate") or "valid"].append(error)
            row["right"] += abs(error) <= WITHIN_BPM

    print(f"{len(per_sitting)} sittings, {seconds} seconds" + (f", {half} set" if half else "")
          + (f", config {pathlib.Path(config).read_text().strip()}" if config else ""))
    print()
    print("| Check | Seconds | Share of seconds | Held a candidate, with a reference | Candidate within 5 bpm | Median abs. error (bpm) | Bias (bpm) |")
    print("|---|---|---|---|---|---|---|")
    refused = collections.Counter()
    for gate in ["valid"] + GATES:
        row = rows.get(gate)
        if not row:
            continue
        e = errors[gate]
        print(f"| {'(valid reading)' if gate == 'valid' else gate} | {row['seconds']} | {percent(row['seconds'], seconds)} "
              f"| {row['paired']} | {row['right']} ({percent(row['right'], row['paired'])}) "
              f"| {statistics.median(map(abs, e)):.1f} | {statistics.mean(e):+.1f} |" if e else
              f"| {'(valid reading)' if gate == 'valid' else gate} | {row['seconds']} | {percent(row['seconds'], seconds)} | 0 | n/a | n/a | n/a |")
        if gate != "valid":
            refused.update(row)
    print(f"| all refused | {refused['seconds']} | {percent(refused['seconds'], seconds)} | {refused['paired']} "
          f"| {refused['right']} ({percent(refused['right'], refused['paired'])}) | | |")
    print()
    print("Sittings:", ", ".join(f"{count} {what}" for what, count in summaries.most_common()))
    scored = [abs(value - reference) for _, _, _, value, _, reference, _ in per_sitting
              if value is not None and reference is not None]
    if scored:
        right = sum(error <= WITHIN_BPM for error in scored)
        print(f"Sitting heart rates within {WITHIN_BPM:.0f} bpm of the mean reference: {right} of {len(scored)} "
              f"({percent(right, len(scored))}); further off: {len(scored) - right}")
    print()
    print("| Sitting | Seconds | Valid | Summary (bpm) | Why none | Mean reference (bpm) | Median candidate, all windows (bpm) |")
    print("|---|---|---|---|---|---|---|")
    number = lambda value: "" if value is None else f"{value:.1f}"
    for name, count, valid, value, reason, reference, candidate in per_sitting:
        print(f"| {name} | {count} | {valid} ({percent(valid, count)}) | {number(value)} | {reason or ''} | {number(reference)} | {number(candidate)} |")


if __name__ == "__main__":
    main()
