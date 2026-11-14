# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "h5py"]
# ///
"""Heart-rate accuracy of the SignalEngine on public rPPG datasets (master plan, section 16).

    uv run eval/run_eval.py mcd --subjects 40
    uv run eval/run_eval.py ubfc | scamps | rppg10 | cmu
    uv run eval/run_eval.py report

Each recording goes through the same path as a phone sitting: video frames -> the capture
module's face regions -> a sitting file -> engine-cli. The dataset's own heart rate (or pulse
waveform) is the reference. Videos are deleted after conversion; sitting files are kept in
eval/out so the engine can be re-scored without downloading again (--rescore).
"""
import argparse
import concurrent.futures
import csv
import datetime
import json
import pathlib
import statistics
import subprocess
import sys
import urllib.request

import numpy as np
from scipy import signal

import datasets

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out"
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


def evaluate(recording, rescore):
    """Prepare (download, convert), score, clean up. Never raises: a failure is a result."""
    sitting = OUT / recording["dataset"] / f"{recording['id']}.jsonl"
    reference_cache = sitting.with_suffix(".reference.jsonl")
    result = {k: recording[k] for k in ("dataset", "id", "group")}
    result.update(recording.get("info", {}))
    try:
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


def run(dataset, recordings, workers, rescore):
    results = []
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        for result in pool.map(lambda r: evaluate(r, rescore), recordings):
            results.append(result)
            status = result.get("error") or (
                f"MAE {result['meanAbsoluteErrorBpm']:.1f} bpm, coverage {result['coverage']:.0%}"
                if result.get("meanAbsoluteErrorBpm") is not None else f"no reading, coverage {result['coverage']:.0%}")
            print(f"[{len(results)}/{len(recordings)}] {dataset} {result['id']}: {status}", flush=True)
    (OUT / f"{dataset}.json").write_text(json.dumps(results, indent=1))
    return results


# ---------------------------------------------------------------- report

def summarise(results):
    """Pooled figures for a set of recordings, in the terms of master plan section 9."""
    scored = [r for r in results if "error" not in r]
    paired = [r for r in scored if r.get("pairedReadings")]
    pairs = sum(r["pairedReadings"] for r in paired)
    weighted = lambda key: sum(r[key] * r["pairedReadings"] for r in paired) / pairs if pairs else None
    summaries = [abs(r["summaryHeartRateBpm"] - r["referenceMeanBpm"]) for r in scored
                 if r.get("summaryHeartRateBpm") is not None and r.get("referenceMeanBpm") is not None]
    firsts = [r["timeToFirstReadingSeconds"] for r in scored if r.get("timeToFirstReadingSeconds") is not None]
    return {
        "recordings": len(results), "failed": len(results) - len(scored), "withReading": len(paired),
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
    number = lambda v, f="{:.1f}": "n/a" if v is None else f.format(v)
    lines = ["# Heart-rate accuracy on public datasets", "",
             f"Generated {datetime.date.today().isoformat()} by `eval/run_eval.py`. Engine: `packages/signal-engine` at its default configuration.", "",
             "Readings are the engine's once-per-second heart rate, paired with the dataset's reference within 1.5 s. "
             "Coverage is the share of seconds with a reading. Per-recording error compares the sitting summary with the mean reference.", ""]
    header = ("| Set | Recordings | With a reading | Paired readings | MAE (bpm) | Bias (bpm) | Within 5 bpm | Coverage | "
              "Per-recording MAE (bpm) | Summaries within 5 bpm | Median time to first (s) |")
    for path in sorted(OUT.glob("*.json")):
        results = json.loads(path.read_text())
        name = path.stem
        lines += [f"## {datasets.TITLES.get(name, name)}", "", datasets.NOTES.get(name, ""), "", header, "|" + "---|" * 11]
        groups = {}
        for r in results:
            groups.setdefault(r["group"], []).append(r)
        if len(groups) > 1:
            groups = {"All": results, **groups}
        for group, rows in groups.items():
            s = summarise(rows)
            lines.append(
                f"| {group} | {s['recordings']} | {s['withReading']} | {s['pairedReadings']} | {number(s['maeBpm'])} | "
                f"{number(s['biasBpm'], '{:+.1f}')} | {number(s['within5'], '{:.0%}')} | {number(s['coverage'], '{:.0%}')} | "
                f"{number(s['perRecordingMaeBpm'])} | {number(s['perRecordingWithin5'], '{:.0%}')} "
                f"(n={s['recordingsWithSummary']}) | {number(s['medianTimeToFirstS'], '{:.0f}')} |")
        failed = [r for r in results if "error" in r]
        if failed:
            lines += ["", f"{len(failed)} recording(s) could not be scored: " + "; ".join(f"{r['id']} ({r['error']})" for r in failed[:5])]
        lines.append("")
    (OUT / "report.md").write_text("\n".join(lines))
    print("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", choices=[*datasets.LOADERS, "report"])
    parser.add_argument("--subjects", type=int, default=None, help="limit the number of subjects")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--rescore", action="store_true", help="reuse sitting files already in eval/out")
    arguments = parser.parse_args()
    if arguments.dataset != "report":
        for tool in (CONVERTER, ENGINE):
            if not tool.exists():
                sys.exit(f"build {tool} first: swift build -c release in its package")
        recordings = datasets.LOADERS[arguments.dataset](arguments.subjects)
        run(arguments.dataset, recordings, arguments.workers, arguments.rescore)
    report()


if __name__ == "__main__":
    main()
