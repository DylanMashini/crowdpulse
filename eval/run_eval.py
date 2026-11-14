# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "h5py"]
# ///
"""Heart-rate accuracy of the SignalEngine on public rPPG datasets (master plan, section 16).

    uv run eval/run_eval.py --workers 2                  # UBFC-rPPG, all 42 subjects, 1.9 GB of video each
    uv run eval/run_eval.py --rescore --split tuning     # score again after an engine change, tuning set only
    uv run eval/run_eval.py report
    uv run eval/run_eval.py check-references             # fetch the authors' ground-truth files and check every reference
    uv run eval/run_eval.py --diagnostics mcd --subjects 100 --workers 3

UBFC-rPPG is the published dataset and the default: <out>/ubfc.json and <out>/report.md hold
nothing else, and they are the only source for a figure shown anywhere. MCD-rPPG is an internal
diagnostic (the bias at elevated heart rates), run only when asked for with --diagnostics; its
results go to <out>/internal-diagnostics/ and are never published.

Each recording goes through the same path as a phone sitting: video frames -> the capture
module's face regions -> a sitting file -> engine-cli. The dataset's own heart rate (or pulse
waveform) is the reference. Videos are deleted after conversion; sitting files are kept in the
output directory so the engine can be re-scored without downloading again (--rescore, which
also resumes a run that was stopped: recordings without a sitting file are fetched).

A re-score checks each UBFC reference again from the files on disk and refuses a subject whose
ground truth differs from an independent copy, as a fresh run does. It downloads nothing for a
subject that has a sitting file, so it cannot move a reference from the hash check to the
authors' file: `check-references` does that, and the next re-score records the result.

Subjects are split into a tuning set and a held-out set by eval/split.json (see eval/split.py).
Tune on the tuning set only (--split tuning). Every published figure comes from the held-out set.

The UBFC-rPPG reference is the dataset's own oximeter heart rate, samples at 0 dropped: the rule
the harness used before the split existed. It is written out with its reason in
datasets.REFERENCE_RULES and printed in the report. Do not change it, or choose between
references, by comparing held-out results; decide on principle or on the tuning set, record why
there, and only then score the held-out set again.

Directories: --data and --out, or TRIAGECAM_EVAL_DATA and TRIAGECAM_EVAL_OUT, default eval/data
and eval/out. A git worktree has neither, so point it at one shared data directory and at an
output directory of its own. Downloads are held back, and after 20 minutes refused, when they
and the downloads in flight would leave the data directory's disk with less than --min-free-gb
free (default 6). With 1.9 GB UBFC videos, --workers 2 needs about 10 GB free to make progress.
"""
import argparse
import concurrent.futures
import csv
import datetime
import json
import os
import pathlib
import statistics
import subprocess
import sys
import urllib.request

import numpy as np
from scipy import signal

import datasets
import split

ROOT = pathlib.Path(__file__).resolve().parent
DATA = pathlib.Path(os.environ.get("TRIAGECAM_EVAL_DATA") or ROOT / "data").resolve()
OUT = pathlib.Path(os.environ.get("TRIAGECAM_EVAL_OUT") or ROOT / "out").resolve()
MIN_FREE_BYTES = 6 * 1024 ** 3  # downloads wait, then are refused, rather than leave less than this free
CONVERTER = ROOT / "video-to-sitting/.build/release/video-to-sitting"
ENGINE = ROOT.parent / "packages/signal-engine/.build/release/engine-cli"


# ---------------------------------------------------------------- video -> sitting file

def probe(video):
    """Width, height and frames per second of a video file."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,avg_frame_rate,r_frame_rate", "-of", "json", str(video)],
        check=True, capture_output=True, text=True).stdout
    stream = json.loads(out)["streams"][0]
    rate = stream["avg_frame_rate"] if stream["avg_frame_rate"] not in ("0/0", "") else stream["r_frame_rate"]
    numerator, denominator = (float(x) for x in rate.split("/"))
    return stream["width"], stream["height"], numerator / denominator


def convert(ffmpeg_input, width, height, fps, sitting, mode="face", timestamps=None, stdin=None):
    """Decode with ffmpeg to full-range BT.709 NV12 (what the phone's 420f camera delivers) and
    reduce every frame to a frame record. Returns the converter's counts."""
    width, height = width // 2 * 2, height // 2 * 2
    sitting.parent.mkdir(parents=True, exist_ok=True)
    command = [str(CONVERTER), "--width", str(width), "--height", str(height), "--fps", str(fps),
               "--out", str(sitting), "--mode", mode]
    if timestamps is not None:
        stamps = sitting.with_suffix(".timestamps")
        stamps.write_text("\n".join(f"{t:.6f}" for t in timestamps))
        command += ["--timestamps", str(stamps)]
    decode = subprocess.Popen(
        ["ffmpeg", "-v", "error", *ffmpeg_input, "-fps_mode", "passthrough", "-vf",
         f"scale={width}:{height}:out_range=full:out_color_matrix=bt709,format=nv12", "-f", "rawvideo", "-"],
        stdin=stdin, stdout=subprocess.PIPE)
    result = subprocess.run(command, stdin=decode.stdout, capture_output=True, text=True)
    decode.stdout.close()
    decode.wait()
    if timestamps is not None:
        stamps.unlink()
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "converter failed")
    return json.loads(result.stdout)


# ---------------------------------------------------------------- reference heart rate

def heart_rate_from_pulse(values, rate, start=0.0, window=8.0):
    """One heart rate per second from a contact pulse waveform (or ECG): beats are located,
    implausible intervals dropped, and the rate is 60 over the mean interval in a window.
    Returns [(seconds, bpm)]; seconds with too few clean beats are left out."""
    values = np.asarray(values, dtype=float)
    if len(values) < rate * window:
        return []
    b, a = signal.butter(2, [0.7, 3.5], btype="band", fs=rate)
    filtered = signal.filtfilt(b, a, values - values.mean())
    peaks, _ = signal.find_peaks(filtered, distance=max(1, int(rate * 0.3)), prominence=0.5 * filtered.std())
    beats = peaks / rate
    intervals, middles = np.diff(beats), (beats[1:] + beats[:-1]) / 2
    samples = []
    for second in np.arange(window / 2, len(values) / rate - window / 2 + 1e-9, 1.0):
        inside = intervals[np.abs(middles - second) <= window / 2]
        if len(inside) < 4:
            continue
        median = np.median(inside)
        clean = inside[(np.abs(inside - median) <= 0.25 * median) & (inside > 0.33) & (inside < 1.5)]
        if len(clean) >= 0.7 * len(inside):
            samples.append((start + float(second), 60.0 / float(clean.mean())))
    return samples


# ---------------------------------------------------------------- scoring

def score(sitting, reference):
    """engine-cli compare of a sitting file against [(seconds, bpm)]."""
    reference_file = sitting.with_suffix(".reference.jsonl")
    reference_file.write_text("".join(json.dumps({"t": t, "heartRate": hr}) + "\n" for t, hr in reference))
    out = subprocess.run([str(ENGINE), "compare", str(sitting), str(reference_file)],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def results_folder(dataset):
    """Where a dataset's results and sitting files go. The output directory itself holds published
    datasets only, so anything that reads it (the report, the landing page's data script) cannot
    pick up a diagnostic dataset by accident."""
    return OUT / "internal-diagnostics" if dataset in datasets.DIAGNOSTIC else OUT


def evaluate(recording, rescore):
    """Prepare (download, convert), score, clean up. Never raises: a failure is a result."""
    sitting = results_folder(recording["dataset"]) / recording["dataset"] / f"{recording['id']}.jsonl"
    reference_cache = sitting.with_suffix(".reference.jsonl")
    result = {k: recording[k] for k in ("dataset", "id", "group", "split")}
    result.update(recording.get("info", {}))
    try:
        if rescore and recording.get("check"):
            # A re-score checks the reference too, from the files on disk: a subject whose
            # ground truth differs from an independent copy is refused, never scored unchecked.
            result["referenceCheck"] = recording["check"]()
        if rescore and sitting.exists() and reference_cache.exists():
            reference = [(r["t"], r["heartRate"]) for r in map(json.loads, reference_cache.read_text().splitlines())]
        else:
            counts, reference = recording["prepare"](sitting)
            result.update(counts)
        if not reference:
            raise RuntimeError("no usable reference heart rate")
        result.update(score(sitting, reference))
    except Exception as error:  # noqa: BLE001 - one bad recording must not stop the run
        result["error"] = f"{type(error).__name__}: {error}"[:300]
    return result


def with_split(dataset, recordings, only=None):
    """Mark each recording with its subject's set from eval/split.json; keep one set if asked."""
    sets = split.load().get(dataset, {})
    for recording in recordings:
        subject = recording["info"]["subject"]
        if subject not in sets:
            sys.exit(f"{dataset} subject {subject} is not in eval/split.json; see eval/split.py")
        recording["split"] = sets[subject]
    return [r for r in recordings if only in (None, r["split"])]


def run(dataset, recordings, workers, rescore, only=None):
    """Evaluate the recordings and write <out>/<dataset>.json. When only one set was asked for,
    the other set's rows from the last run are kept, so the report still shows both."""
    path = results_folder(dataset) / f"{dataset}.json"
    kept = []
    if only and path.exists():
        kept = [r for r in json.loads(path.read_text()) if r.get("split") not in (None, only)]
    results = []
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        for result in pool.map(lambda r: evaluate(r, rescore), recordings):
            results.append(result)
            status = result.get("error") or (
                f"MAE {result['meanAbsoluteErrorBpm']:.1f} bpm, coverage {result['coverage']:.0%}"
                if result.get("meanAbsoluteErrorBpm") is not None else f"no reading, coverage {result['coverage']:.0%}")
            print(f"[{len(results)}/{len(recordings)}] {dataset} {result['id']}: {status}", flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(kept + results, indent=1))
    return results


# ---------------------------------------------------------------- report

def summarise(results):
    """Pooled figures for a set of recordings, in the terms of master plan section 9.
    Subjects and recordings are the scored ones: a recording that was refused or failed is
    counted under `failed` and nowhere else. The per-sitting error holds the sitting summary
    against the mean of the reference over the seconds that had a reading (the seconds the
    summary is built from), not over the whole recording."""
    scored = [r for r in results if "error" not in r]
    paired = [r for r in scored if r.get("pairedReadings")]
    pairs = sum(r["pairedReadings"] for r in paired)
    weighted = lambda key: sum(r[key] * r["pairedReadings"] for r in paired) / pairs if pairs else None
    summaries = [abs(r["summaryHeartRateBpm"] - r["pairedReferenceMeanBpm"]) for r in scored
                 if r.get("summaryHeartRateBpm") is not None and r.get("pairedReferenceMeanBpm") is not None]
    firsts = [r["timeToFirstReadingSeconds"] for r in scored if r.get("timeToFirstReadingSeconds") is not None]
    return {
        "subjects": len({r.get("subject") for r in scored}),
        "recordings": len(scored), "failed": len(results) - len(scored), "withReading": len(paired),
        "pairedReadings": pairs,
        "maeBpm": weighted("meanAbsoluteErrorBpm"), "biasBpm": weighted("biasBpm"),
        "within5": weighted("within5BpmShare"),
        "coverage": statistics.mean(r["coverage"] for r in scored) if scored else None,
        "perRecordingMaeBpm": statistics.mean(summaries) if summaries else None,
        "perRecordingWithin5": sum(e <= 5 for e in summaries) / len(summaries) if summaries else None,
        "recordingsWithSummary": len(summaries),
        "medianTimeToFirstS": statistics.median(firsts) if firsts else None,
    }


def report():
    """<out>/report.md from the published datasets, and <out>/internal-diagnostics/diagnostics.md
    from the diagnostic ones. Only the first may be quoted anywhere."""
    recorded = json.loads(split.FILE.read_text())
    method = [f"Generated {datetime.date.today().isoformat()} by `eval/run_eval.py`. Engine: `packages/signal-engine` at its default configuration.", "",
              "Readings are the engine's once-per-second heart rate, paired with the dataset's reference within 1.5 s. "
              "Coverage is the share of seconds with a reading. Subjects and recordings are the ones that were scored; "
              "a recording that was refused is listed under its set and counted nowhere. "
              "The sitting-summary error compares each sitting's summary heart rate with the mean of the reference over the seconds that had a reading.", "",
              f"Subjects are split into a tuning set and a held-out set by `eval/split.json` (seed {recorded['seed']}, by subject, "
              "half of every subject in the dataset each). Engine parameters are tuned on the tuning set only."]
    published = write_report(
        OUT / "report.md", datasets.PUBLISHED, recorded,
        ["# Heart-rate accuracy on public datasets", "", *method[:-1],
         method[-1] + " **Published figures come from the held-out set.**", ""])
    write_report(
        results_folder(next(iter(datasets.DIAGNOSTIC))) / "diagnostics.md", datasets.DIAGNOSTIC, recorded,
        ["# Internal diagnostics: not for publication", "",
         "These datasets are used to find engine faults (for example the bias at elevated heart rates). "
         "No figure in this file is published or quoted anywhere; published accuracy is `report.md`, " +
         " and ".join(datasets.TITLES[name] for name in datasets.PUBLISHED) + " only.", "", *method, ""])
    print(published)


def write_report(target, names, recorded, lines):
    """One section per dataset in `names` that has results; nothing is written when none has."""
    number = lambda v, f="{:.1f}": "n/a" if v is None else f.format(v)
    lines = list(lines)
    header = ("| Set | Subjects | Recordings | With a reading | Paired readings | MAE (bpm) | Bias (bpm) | Within 5 bpm | Coverage | "
              "Sitting-summary MAE (bpm) | Summaries within 5 bpm | Median time to first (s) |")
    paths = [path for path in (results_folder(name) / f"{name}.json" for name in names) if path.exists()]
    for path in paths:
        results = json.loads(path.read_text())
        name = path.stem
        lines += [f"## {datasets.TITLES.get(name, name)}", "", datasets.NOTES.get(name, ""), ""]
        if name in datasets.REFERENCE_RULES:
            lines += ["**Reference rule.** " + datasets.REFERENCE_RULES[name], ""]
        sets = recorded["datasets"].get(name, {})
        for key, listed in ((split.HELD_OUT, "heldOut"), (split.TUNING, "tuning")):
            in_set = [r for r in results if r.get("split") == key]
            scored = len({r.get("subject") for r in in_set if "error" not in r})
            refused = len({r.get("subject") for r in in_set if "error" in r} - {r.get("subject") for r in in_set if "error" not in r})
            lines += [f"### {split.NAMES[key]}: {scored} of the dataset's {len(sets.get(listed, []))} {key} subjects scored"
                      + (f", {refused} not scored" if refused else ""), ""]
            if not in_set:
                lines += ["Not evaluated.", ""]
                continue
            lines += [header, "|" + "---|" * 12]
            groups = {}
            for r in in_set:
                groups.setdefault(r["group"], []).append(r)
            if len(groups) > 1:
                groups = {"All": in_set, **groups}
            for group, rows in groups.items():
                s = summarise(rows)
                lines.append(
                    f"| {group} | {s['subjects']} | {s['recordings']} | {s['withReading']} | {s['pairedReadings']} | {number(s['maeBpm'])} | "
                    f"{number(s['biasBpm'], '{:+.1f}')} | {number(s['within5'], '{:.0%}')} | {number(s['coverage'], '{:.0%}')} | "
                    f"{number(s['perRecordingMaeBpm'])} | {number(s['perRecordingWithin5'], '{:.0%}')} "
                    f"(n={s['recordingsWithSummary']}) | {number(s['medianTimeToFirstS'], '{:.0f}')} |")
            checks = [r["referenceCheck"] for r in in_set if r.get("referenceCheck")]
            if checks:
                lines += ["", "Reference checked against: "
                          + ", ".join(f"{check} ({checks.count(check)} recordings)" for check in sorted(set(checks))) + "."]
            unchecked = [r["id"] for r in in_set if "error" not in r and not r.get("referenceCheck")] if name in datasets.REFERENCE_CHECKED else []
            if unchecked:
                lines += ["", f"**Reference not checked, {len(unchecked)} recording(s):** {', '.join(unchecked)}. "
                          "Their ground truth was not on disk when they were scored again; do not publish this set until they are checked."]
            failed = [r for r in in_set if "error" in r]
            if failed:
                reasons = {}
                for r in failed:
                    reasons.setdefault(r["error"], []).append(r["id"])
                lines += ["", f"Not scored and not counted above, {len(failed)} recording(s): "
                          + "; ".join(f"{', '.join(ids[:10])}{' and others' if len(ids) > 10 else ''} ({reason})" for reason, ids in reasons.items()) + "."]
            lines.append("")
        unmarked = sum(r.get("split") not in (split.HELD_OUT, split.TUNING) for r in results)
        if unmarked:
            lines += [f"{unmarked} recording(s) carry no set (scored before the split existed) and are left out. Run the dataset again.", ""]
    if not paths:
        return ""
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines))
    return "\n".join(lines)


def set_directories(data, out, min_free_gb):
    """This file runs as __main__ while datasets.py imports it again as run_eval: both copies are told."""
    for module in (sys.modules[__name__], datasets.core):
        if data:
            module.DATA = pathlib.Path(data).resolve()
        if out:
            module.OUT = pathlib.Path(out).resolve()
        if min_free_gb is not None:
            module.MIN_FREE_BYTES = int(min_free_gb * 1024 ** 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", nargs="?", choices=[*datasets.PUBLISHED, "report", "check-references"], default=datasets.PUBLISHED[0],
                        help="the published dataset to evaluate (default); `report` only rewrites the reports; "
                             "`check-references` fetches the authors' ground-truth files that are missing and checks every reference, scoring nothing")
    parser.add_argument("--diagnostics", choices=datasets.DIAGNOSTIC, default=None,
                        help="evaluate an internal diagnostic dataset instead; its results are never published")
    parser.add_argument("--subjects", type=int, default=None, help="limit the number of subjects")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--rescore", action="store_true", help="reuse sitting files already in the output directory")
    parser.add_argument("--split", choices=[split.TUNING, split.HELD_OUT], default=None,
                        help="evaluate one set only; the other set's rows from the last run are kept")
    parser.add_argument("--data", default=None, help="dataset directory (default TRIAGECAM_EVAL_DATA, else eval/data)")
    parser.add_argument("--out", default=None, help="output directory (default TRIAGECAM_EVAL_OUT, else eval/out)")
    parser.add_argument("--min-free-gb", type=float, default=None, help="downloads never leave less than this much disk free (default 6)")
    arguments = parser.parse_args()
    set_directories(arguments.data, arguments.out, arguments.min_free_gb)
    found = split.problems()
    if found:
        sys.exit("eval/split.json: " + "; ".join(found))
    dataset = arguments.diagnostics or arguments.dataset
    if dataset == "check-references":
        print("\n".join(datasets.ubfc_check_references()))
        return
    if dataset != "report":
        for tool in (CONVERTER, ENGINE):
            if not tool.exists():
                sys.exit(f"build {tool} first: swift build -c release in its package")
        recordings = with_split(dataset, datasets.LOADERS[dataset](arguments.subjects), arguments.split)
        run(dataset, recordings, arguments.workers, arguments.rescore, arguments.split)
    report()


if __name__ == "__main__":
    main()
