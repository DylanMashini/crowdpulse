"""One loader per dataset. A loader returns recordings:

    {"dataset", "id", "group", "info": {...}, "prepare": callable(sitting_path) -> (counts, reference)}

`prepare` writes the sitting file and returns the converter's counts and [(seconds, bpm)].
Downloads go under eval/data/<dataset>; bulky video is deleted once it has been converted.
"""
import csv
import datetime
import pathlib
import subprocess
import threading

import numpy as np

import run_eval as core

TITLES = {
    "mcd": "MCD-rPPG",
    "ubfc": "UBFC-rPPG",
    "scamps": "SCAMPS (synthetic)",
    "rppg10": "rPPG-10",
    "cmu": "CMU rPPG biases",
}
NOTES = {
    "mcd": "Real people, three cameras, at rest (before) and after squats (after). MPEG-4 compressed 640x480 video at about 24 fps. "
           "Reference: the contact pulse waveform (100 Hz), reduced to one heart rate per second by `heart_rate_from_pulse`.",
    "ubfc": "Real people at a webcam, uncompressed 640x480 video at 30 fps. Reference: the oximeter heart rate in each ground_truth.txt.",
    "scamps": "Rendered faces, so this checks the maths, not real-world performance. Reference: the simulated pulse waveform.",
    "rppg10": "Cropped skin patches, not full faces: the face and region tracking is skipped and the whole frame is every region. Reference: ECG.",
    "cmu": "Cropped skin patches from darker-skinned subjects; the whole frame is every region. Reference: one mean pulse rate per video.",
}


_fetch_locks = {}
_fetch_guard = threading.Lock()


def fetch(url, path):
    """Download once. Workers that want the same file wait for the first one."""
    with _fetch_guard:
        lock = _fetch_locks.setdefault(path, threading.Lock())
    with lock:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(path.suffix + ".part")
            subprocess.run(["curl", "-sfL", "--retry", "5", "--retry-all-errors", "-o", str(partial), url], check=True)
            partial.rename(path)
    return path


# ---------------------------------------------------------------- MCD-rPPG

MCD_URL = "https://huggingface.co/datasets/kyegorov/mcd_rppg/resolve/main/"
MCD_CAMERAS = {"FullHDwebcam": "front webcam", "IriunWebcam": "phone camera, right", "USBVideo": "camcorder, left"}


def stamped_lines(path):
    """Lines of '<value>  <date> <time>' as (value, seconds since midnight UTC of the epoch)."""
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        moment = datetime.datetime.fromisoformat(f"{parts[1]} {parts[2]}").replace(tzinfo=datetime.timezone.utc)
        rows.append((float(parts[0]), moment.timestamp()))
    return rows


def mcd(subjects):
    folder = core.DATA / "mcd"
    rows = list(csv.DictReader(fetch(MCD_URL + "db.csv", folder / "db.csv").open()))
    chosen = sorted({row["patient_id"] for row in rows})[: subjects or 40]

    def prepare(row, sitting):
        video = fetch(MCD_URL + row["video"], folder / row["video"])
        frames = stamped_lines(fetch(MCD_URL + row["meta"], folder / row["meta"]))
        pulse = stamped_lines(fetch(MCD_URL + row["ppg"], folder / row["ppg"]))
        if len(frames) < 100 or len(pulse) < 1000:
            raise RuntimeError("frame times or pulse waveform missing")
        first = frames[0][1]
        width, height, fps = core.probe(video)
        counts = core.convert(["-i", str(video)], width, height, fps, sitting,
                              timestamps=[t - first for _, t in frames])
        video.unlink()
        # The pulse arrives in bursts, so its samples are spread evenly between the first and last stamp.
        rate = (len(pulse) - 1) / (pulse[-1][1] - pulse[0][1])
        reference = core.heart_rate_from_pulse([v for v, _ in pulse], rate, start=pulse[0][1] - first)
        return counts, reference

    return [
        {"dataset": "mcd", "id": pathlib.Path(row["video"]).stem,
         "group": f"{MCD_CAMERAS[row['camera']]}, {row['step']}",
         "info": {"subject": row["patient_id"], "recordedPulse": float(row["pulse"]) if row["pulse"] else None},
         "prepare": lambda sitting, row=row: prepare(row, sitting)}
        for row in rows if row["patient_id"] in chosen and row["camera"] in MCD_CAMERAS
    ]


# ---------------------------------------------------------------- UBFC-rPPG (Dataset 2)

# The authors' Google Drive folder refuses anonymous video downloads once its daily quota is
# used up, so the videos come from a copy on Hugging Face. Each subject's ground_truth.txt is
# checked byte for byte against the authors' own file (listing.txt holds their Drive ids).
UBFC_MIRROR = "https://huggingface.co/datasets/thachha901/UBFC/resolve/main/UBFC/"
UBFC_OFFICIAL = "https://drive.usercontent.google.com/download?export=download&confirm=t&id="


def ubfc(subjects):
    folder = core.DATA / "ubfc"
    listing = dict(reversed(line.split("\t")) for line in (folder / "listing.txt").read_text().splitlines() if "\t" in line)
    names = sorted((p.split("/")[1] for p in listing if p.startswith("DATASET_2/") and p.endswith("vid.avi")),
                   key=lambda name: int(name.removeprefix("subject")))[: subjects or None]

    def prepare(name, sitting):
        truth = fetch(f"{UBFC_MIRROR}{name}/ground_truth.txt", folder / name / "ground_truth.txt")
        official = fetch(UBFC_OFFICIAL + listing[f"DATASET_2/{name}/ground_truth.txt"], folder / name / "ground_truth.official.txt")
        if truth.read_bytes() != official.read_bytes():
            raise RuntimeError("the mirror's ground truth differs from the authors' file")
        video = fetch(f"{UBFC_MIRROR}{name}/vid.avi", folder / name / "vid.avi")
        width, height, fps = core.probe(video)
        counts = core.convert(["-i", str(video)], width, height, fps, sitting)
        video.unlink()
        _, rates, times = (np.array(line.split(), dtype=float) for line in truth.read_text().splitlines()[:3])
        return counts, [(float(t), float(hr)) for t, hr in zip(times, rates) if hr > 0]

    return [{"dataset": "ubfc", "id": name, "group": "All", "info": {"subject": name},
             "prepare": lambda sitting, name=name: prepare(name, sitting)} for name in names]


LOADERS = {"mcd": mcd, "ubfc": ubfc}
