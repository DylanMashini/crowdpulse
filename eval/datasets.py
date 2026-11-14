"""One loader per dataset. A loader returns recordings:

    {"dataset", "id", "group", "info": {...}, "prepare": callable(sitting_path) -> (counts, reference)}

`prepare` writes the sitting file and returns the converter's counts and [(seconds, bpm)].
Downloads go under <data directory>/<dataset>; bulky video is deleted once it has been converted.
"""
import csv
import datetime
import hashlib
import json
import pathlib
import shutil
import subprocess
import threading
import time

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
    "ubfc": "Real people at a webcam, uncompressed 640x480 video at 30 fps. Reference: the oximeter heart rate in each ground_truth.txt. "
            "Video and ground truth come from a public mirror; each ground-truth file is checked byte for byte against the authors' own "
            "file, or by content hash against two other public uploads when the authors' Drive folder is over its download quota.",
    "scamps": "Rendered faces, so this checks the maths, not real-world performance. Reference: the simulated pulse waveform.",
    "rppg10": "Cropped skin patches, not full faces: the face and region tracking is skipped and the whole frame is every region. Reference: ECG.",
    "cmu": "Cropped skin patches from darker-skinned subjects; the whole frame is every region. Reference: one mean pulse rate per video.",
}
# How each published dataset's reference is built, and why. Printed in the report under the
# dataset. A rule is never changed by comparing held-out results: a change is decided on
# principle or on the tuning set, written here with its reason, and only then is the held-out
# set scored again.
REFERENCE_RULES = {
    "ubfc": "The reference is the heart-rate line of each subject's `ground_truth.txt`: the fingertip oximeter's own rate as the "
            "dataset's authors recorded it, with samples equal to 0 dropped and nothing else filtered, smoothed or derived. "
            "Why this rule: it is the one the harness has used since its first UBFC-rPPG run (commit `3cd1d6d`), before any subject was "
            "assigned to a set (`1bf1907`), so it was fixed with no held-out result in view; and it is the dataset's own rate, so the "
            "reference involves none of our signal processing. A rate derived from the same file's pulse waveform gives different "
            "held-out figures, which is exactly why the choice is not reopened by looking at them. "
            "Known fault, tuning set only: in subjects 11, 18, 20 and 24 the oximeter line drops out and tops out at 127 (BUG-19), "
            "which is most of the tuning set's error. No held-out sample is below 40 or at 127. A fix to the rule is decided on the "
            "tuning set with A2 and A3, recorded here, and only then is the held-out figure computed again.",
}


_fetch_locks = {}
_fetch_guard = threading.Lock()


_reserved = {}  # partial file -> size it will reach, for the downloads in flight
BULKY = {".avi", ".mp4", ".mkv", ".gz"}
ROOM_WAIT_SECONDS = 20 * 60


def remote_size(url):
    """Content-Length of a download, 0 when the server does not say."""
    head = subprocess.run(["curl", "-sIL", "--max-time", "60", url], capture_output=True, text=True).stdout
    sizes = [line.split(":", 1)[1].strip() for line in head.splitlines() if line.lower().startswith("content-length:")]
    return int(sizes[-1]) if sizes and sizes[-1].isdigit() else 0


def reserve_room(partial, size):
    """Hold a download back until the disk can take it, and every download already in flight,
    and still keep core.MIN_FREE_BYTES free. Videos are deleted once converted, so room comes
    back as other workers finish; if it has not after ROOM_WAIT_SECONDS the download is refused."""
    deadline = time.monotonic() + ROOM_WAIT_SECONDS
    while True:
        with _fetch_guard:
            to_come = sum(max(0, total - (p.stat().st_size if p.exists() else 0)) for p, total in _reserved.items())
            free = shutil.disk_usage(partial.parent).free
            if free - to_come - size >= core.MIN_FREE_BYTES:
                _reserved[partial] = size
                return
        if time.monotonic() > deadline:
            raise RuntimeError(f"download refused: {free / 1024 ** 3:.1f} GB free, {(to_come + size) / 1024 ** 3:.1f} GB to come, "
                               f"and {core.MIN_FREE_BYTES / 1024 ** 3:.1f} GB must stay free")
        time.sleep(15)


def fetch(url, path):
    """Download once. Workers that want the same file wait for the first one."""
    with _fetch_guard:
        lock = _fetch_locks.setdefault(path, threading.Lock())
    with lock:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(path.suffix + ".part")
            partial.unlink(missing_ok=True)  # left by a run that was stopped
            reserve_room(partial, remote_size(url) if path.suffix in BULKY else 0)
            try:
                subprocess.run(["curl", "-sfL", "--retry", "5", "--retry-all-errors", "-o", str(partial), url], check=True)
                partial.rename(path)
            finally:
                with _fetch_guard:
                    _reserved.pop(partial, None)
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
# When the Drive folder is over quota even for the small ground-truth files, the mirror's file
# must instead match two further uploads of the dataset on Hugging Face. Their files need a
# signed-in account, but their file listings are public and give each file's git blob hash
# (SHA-1 of the content), which is compared with the hash of the mirror's file. This is weaker
# than the authors' own file: the second upload may be a copy of the first. Each result says
# which check its reference passed (`referenceCheck`).
UBFC_OTHER_COPIES = ["https://huggingface.co/api/datasets/WeiQian98/UBFC-rPPG/tree/main/",
                     "https://huggingface.co/api/datasets/leefangbiao/UBFC-rPPG/tree/main/"]
CHECKED_BY_AUTHORS, CHECKED_BY_COPIES = "authors' file", "content hash of two other public uploads"


def is_web_page(path):
    """Drive answers 200 with a 'Quota exceeded' page instead of the file."""
    return path.read_bytes()[:200].lstrip().lower().startswith((b"<!doctype html", b"<html"))


def ubfc_reference_check(folder, listing, name, download=True):
    """Which independent copy the mirror's ground truth for a subject matches, or None when
    nothing has been fetched yet. Raises when a copy differs."""
    truth = folder / name / "ground_truth.txt"
    official = folder / name / "ground_truth.official.txt"
    if official.exists() and is_web_page(official):
        official.unlink()  # a quota page kept by an earlier run
    if download and not official.exists():
        fetch(UBFC_OFFICIAL + listing[f"DATASET_2/{name}/ground_truth.txt"], official)
        if is_web_page(official):
            official.unlink()
    if official.exists():
        if truth.read_bytes() != official.read_bytes():
            raise RuntimeError("the mirror's ground truth differs from the authors' file")
        return CHECKED_BY_AUTHORS
    listings = [folder / name / f"ground_truth.copy{n}.json" for n in (1, 2)]
    if download:
        for base, saved in zip(UBFC_OTHER_COPIES, listings):
            fetch(f"{base}{name}", saved)
    if not all(saved.exists() for saved in listings):
        return None
    content = truth.read_bytes()
    blob = hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()
    for saved in listings:
        published = [entry["oid"] for entry in json.loads(saved.read_text()) if entry["path"] == f"{name}/ground_truth.txt"]
        if published != [blob]:
            raise RuntimeError("the mirror's ground truth differs from another public copy, and the authors' file is not on disk to settle it")
    return CHECKED_BY_COPIES


def ubfc(subjects):
    folder = core.DATA / "ubfc"
    listing = dict(reversed(line.split("\t")) for line in (folder / "listing.txt").read_text().splitlines() if "\t" in line)
    names = sorted((p.split("/")[1] for p in listing if p.startswith("DATASET_2/") and p.endswith("vid.avi")),
                   key=lambda name: int(name.removeprefix("subject")))[: subjects or None]

    def prepare(name, sitting):
        truth = fetch(f"{UBFC_MIRROR}{name}/ground_truth.txt", folder / name / "ground_truth.txt")
        check = ubfc_reference_check(folder, listing, name)
        video = fetch(f"{UBFC_MIRROR}{name}/vid.avi", folder / name / "vid.avi")
        width, height, fps = core.probe(video)
        counts = core.convert(["-i", str(video)], width, height, fps, sitting)
        video.unlink()
        # The reference rule: see REFERENCE_RULES["ubfc"] before changing this line.
        _, rates, times = (np.array(line.split(), dtype=float) for line in truth.read_text().splitlines()[:3])
        return {**counts, "referenceCheck": check}, [(float(t), float(hr)) for t, hr in zip(times, rates) if hr > 0]

    def check_on_disk(name):
        """For a re-score, which skips `prepare`: the check as the files on disk stand, with no
        download. Raises when a copy on disk differs, so the subject is refused exactly as a
        fresh run refuses it. None when there is no ground truth on disk to check."""
        return ubfc_reference_check(folder, listing, name, download=False) if (folder / name / "ground_truth.txt").exists() else None

    return [{"dataset": "ubfc", "id": name, "group": "All", "info": {"subject": name},
             "prepare": lambda sitting, name=name: prepare(name, sitting),
             "check": lambda name=name: check_on_disk(name)} for name in names]


def ubfc_check_references():
    """Fetch what is missing of each subject's independent copies (the authors' file first) and
    run the check, without scoring anything. A re-score never downloads, so this is the step
    that moves a subject from the hash check to the authors' file once their Drive answers
    again. Returns one line per subject whose ground truth is on disk."""
    folder = core.DATA / "ubfc"
    listing = dict(reversed(line.split("\t")) for line in (folder / "listing.txt").read_text().splitlines() if "\t" in line)
    names = sorted((p.split("/")[1] for p in listing if p.startswith("DATASET_2/") and p.endswith("vid.avi")),
                   key=lambda name: int(name.removeprefix("subject")))
    lines, online = [], True
    for name in names:
        if not (folder / name / "ground_truth.txt").exists():
            lines.append(f"{name}: no ground truth on disk (a run without --rescore fetches it)")
            continue
        try:
            try:
                found = ubfc_reference_check(folder, listing, name, download=online)
            except subprocess.CalledProcessError:
                online = False  # one failed download: the rest are checked as the files on disk stand
                found = ubfc_reference_check(folder, listing, name, download=False)
            lines.append(f"{name}: {found or 'unchecked'}" + ("" if online else " (from the files on disk; a download failed)"))
        except RuntimeError as error:
            lines.append(f"{name}: REFUSED, {error}")
    return lines


LOADERS = {"mcd": mcd, "ubfc": ubfc}
PUBLISHED = ["ubfc"]   # the only datasets whose figures may be shown anywhere
REFERENCE_CHECKED = ["ubfc"]  # datasets whose reference file is checked against an independent copy
DIAGNOSTIC = ["mcd"]   # internal: results go to <out>/internal-diagnostics and are never published
