"""The tuning and held-out split of every dataset's subjects (backlog item A1).

    python3 eval/split.py check                 # eval/split.json still follows from its seed
    python3 eval/split.py write [--data DIR]    # rebuild eval/split.json from the dataset indexes

Engine parameters are tuned on the tuning set only. Every figure that is published comes from
the held-out set. The split is by subject, never by recording, so no person is in both sets.

A subject's place is fixed by the seed alone: subjects are ordered by the SHA-256 of
"<seed>:<dataset>:<subject>", the first half of that order is the tuning set and the rest is the
held-out set. The whole published population is split (all 42 UBFC-rPPG subjects, all 600
MCD-rPPG subjects), so evaluating more of a dataset later moves nobody between sets.
eval/split.json records the seed and the resulting lists; the harness reads the lists.
"""
import argparse
import csv
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FILE = ROOT / "split.json"
SEED = 20261114
TUNING, HELD_OUT = "tuning", "held-out"
NAMES = {TUNING: "Tuning set", HELD_OUT: "Held-out set"}


def assign(dataset, subjects, seed=SEED):
    """(tuning, held-out) for a dataset's subjects, each list in the seeded order."""
    if len(set(subjects)) != len(subjects):
        raise ValueError(f"{dataset}: a subject is listed twice")
    ranked = sorted(subjects, key=lambda subject: hashlib.sha256(f"{seed}:{dataset}:{subject}".encode()).hexdigest())
    half = len(ranked) // 2
    return ranked[:half], ranked[half:]


def load():
    """{dataset: {subject: "tuning" | "held-out"}} from eval/split.json."""
    recorded = json.loads(FILE.read_text())
    return {dataset: {**{s: TUNING for s in sets["tuning"]}, **{s: HELD_OUT for s in sets["heldOut"]}}
            for dataset, sets in recorded["datasets"].items()}


def problems():
    """What is wrong with eval/split.json; empty when it follows from its own seed."""
    recorded = json.loads(FILE.read_text())
    found = []
    for dataset, sets in recorded["datasets"].items():
        subjects = sets["tuning"] + sets["heldOut"]
        try:
            expected = assign(dataset, subjects, recorded["seed"])
        except ValueError as error:
            found.append(str(error))
            continue
        if (sets["tuning"], sets["heldOut"]) != expected:
            found.append(f"{dataset}: the lists do not follow from seed {recorded['seed']}")
    return found


def subjects_on_disk(data):
    """Every subject of each dataset, from the dataset's own index under the data directory."""
    listing = (data / "ubfc/listing.txt").read_text().splitlines()
    ubfc = sorted({line.split("\t")[1].split("/")[1] for line in listing
                   if "\t" in line and line.split("\t")[1].startswith("DATASET_2/") and line.endswith("vid.avi")},
                  key=lambda name: int(name.removeprefix("subject")))
    with (data / "mcd/db.csv").open() as index:
        mcd = sorted({row["patient_id"] for row in csv.DictReader(index)})
    return {"ubfc": ubfc, "mcd": mcd}


def write(data):
    datasets = {}
    for dataset, subjects in subjects_on_disk(data).items():
        tuning, held_out = assign(dataset, subjects)
        datasets[dataset] = {"subjects": len(subjects), "tuning": tuning, "heldOut": held_out}
    FILE.write_text(json.dumps({
        "note": "Written by eval/split.py. Do not edit by hand; `python3 eval/split.py check` verifies it.",
        "seed": SEED,
        "method": "Subjects ordered by sha256('<seed>:<dataset>:<subject>'); the first half is the tuning set, "
                  "the rest is the held-out set.",
        "datasets": datasets,
    }, indent=1) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["check", "write"])
    parser.add_argument("--data", type=pathlib.Path, default=ROOT / "data", help="dataset directory (for write)")
    arguments = parser.parse_args()
    if arguments.action == "write":
        write(arguments.data)
    found = problems()
    if found:
        sys.exit("eval/split.json: " + "; ".join(found))
    recorded = json.loads(FILE.read_text())
    for dataset, sets in recorded["datasets"].items():
        print(f"{dataset}: {len(sets['tuning'])} tuning, {len(sets['heldOut'])} held-out, seed {recorded['seed']}")


if __name__ == "__main__":
    main()
