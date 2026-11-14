// Builds apps/web/src/components/landing/eval-data.json from the evaluation harness's outputs.
//
//   node apps/web/scripts/build-landing-eval.mjs [path to eval/out]
//
// eval/out is gitignored: it is written by `uv run eval/run_eval.py` (see that file). Every
// accuracy figure on the landing page comes from the file this script writes. Re-run this after
// re-running the harness and commit the result.
//
// What may be published is narrow, and this script enforces it rather than trusting its input:
//   - UBFC-rPPG only. Nothing else in the output directory is read, and nothing under
//     internal-diagnostics/ (datasets that are never published) can reach the page.
//   - Held-out rows only. Tuning rows are never pooled in and never written out.
//   - Every held-out subject of eval/split.json must be scored, with a checked reference.
//     Otherwise the script stops: a partial held-out set is not the published figure.
// The pooling below is the same arithmetic as `summarise` in eval/run_eval.py, so the figures
// match the held-out table of eval/out/report.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, '../../../eval');
const outDir = resolve(process.argv[2] ?? join(evalDir, 'out'));
const target = join(here, '../src/components/landing/eval-data.json');

const ID = 'ubfc';
const HELD_OUT = 'held-out';
// Title and wording mirror TITLES and NOTES in eval/datasets.py.
const DATASET = {
  id: ID,
  title: 'UBFC-rPPG',
  video: 'uncompressed, 640 × 480, 30 fps',
  reference: 'Fingertip oximeter heart rate recorded with each video',
  source: 'https://sites.google.com/view/ybenezeth/ubfcrppg',
};
// `referenceCheck` on each row, as eval/datasets.py writes it.
const CHECKS = { "authors' file": 'authorsFile', 'content hash of two other public uploads': 'otherCopies' };

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, places = 4) => (value == null ? null : Number(value.toFixed(places)));

/** Pooled figures for scored recordings: `summarise` in eval/run_eval.py. */
function summarise(scored) {
  const paired = scored.filter((r) => r.pairedReadings);
  const pairs = paired.reduce((sum, r) => sum + r.pairedReadings, 0);
  const weighted = (key) => (pairs ? paired.reduce((sum, r) => sum + r[key] * r.pairedReadings, 0) / pairs : null);
  const firsts = scored.filter((r) => r.timeToFirstReadingSeconds != null).map((r) => r.timeToFirstReadingSeconds);
  return {
    subjects: new Set(scored.map((r) => r.subject)).size,
    recordings: scored.length,
    withReading: paired.length,
    pairedReadings: pairs,
    maeBpm: round(weighted('meanAbsoluteErrorBpm')),
    biasBpm: round(weighted('biasBpm')),
    within5: round(weighted('within5BpmShare')),
    coverage: scored.length ? round(mean(scored.map((r) => r.coverage))) : null,
    medianTimeToFirstS: firsts.length ? round(median(firsts)) : null,
  };
}

const stop = (message) => {
  throw new Error(`${message}. Nothing was written.`);
};

const split = JSON.parse(readFileSync(join(evalDir, 'split.json'), 'utf8'));
const sets = split.datasets[ID];
const rows = JSON.parse(readFileSync(join(outDir, `${ID}.json`), 'utf8'));

const unmarked = rows.filter((r) => r.split !== HELD_OUT && r.split !== 'tuning');
if (unmarked.length) stop(`${unmarked.length} ${ID} row(s) carry no set: they were scored before the split existed; run the harness again`);

const heldOut = rows.filter((r) => r.split === HELD_OUT);
const refused = heldOut.filter((r) => 'error' in r);
if (refused.length) stop(`${refused.length} held-out recording(s) were not scored (${refused.map((r) => r.id).join(', ')})`);
const subjects = new Set(heldOut.map((r) => r.subject));
const missing = sets.heldOut.filter((subject) => !subjects.has(subject));
const foreign = [...subjects].filter((subject) => !sets.heldOut.includes(subject));
if (missing.length || foreign.length) stop(`the held-out rows are not the held-out set of eval/split.json (missing: ${missing.join(', ') || 'none'}; not in the set: ${foreign.join(', ') || 'none'})`);
const unchecked = heldOut.filter((r) => !(r.referenceCheck in CHECKS));
if (unchecked.length) stop(`${unchecked.length} held-out recording(s) have no checked reference (${unchecked.map((r) => r.id).join(', ')})`);
if (heldOut.some((r) => typeof r.seenInDevelopment !== 'boolean')) stop('held-out rows do not say whether the subject was seen in development; run the harness again');

const referenceChecks = { authorsFile: 0, otherCopies: 0 };
for (const r of heldOut) referenceChecks[CHECKS[r.referenceCheck]] += 1;

const seen = heldOut.filter((r) => r.seenInDevelopment);
const report = readFileSync(join(outDir, 'report.md'), 'utf8');
const generated = report.match(/Generated (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
if (!generated) stop('eval/out/report.md does not say when it was generated');

const data = {
  note: 'Generated by apps/web/scripts/build-landing-eval.mjs from eval/out. Do not edit by hand.',
  evaluatedOn: generated,
  pairing: 'One heart rate per second from the engine, paired with the reference within 1.5 s',
  dataset: { ...DATASET, totalSubjects: sets.tuning.length + sets.heldOut.length },
  split: { set: HELD_OUT, seed: split.seed, heldOutSubjects: sets.heldOut.length, tuningSubjects: sets.tuning.length },
  // The published figures: every held-out subject.
  heldOut: summarise(heldOut),
  // Held-out subjects the engine had been checked against before the split was drawn
  // (SEEN_IN_DEVELOPMENT in eval/datasets.py), and the figures without them, for the disclosure.
  seenInDevelopment: new Set(seen.map((r) => r.subject)).size,
  heldOutWithoutSeen: seen.length ? summarise(heldOut.filter((r) => !r.seenInDevelopment)) : null,
  // How many held-out reference files were checked against which independent copy.
  referenceChecks,
};

writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
const s = data.heldOut;
console.log(
  `wrote ${target}: ${DATASET.title} ${HELD_OUT}, ${s.subjects} subjects, ${s.pairedReadings} paired readings, ` +
    `MAE ${s.maeBpm.toFixed(1)} bpm, evaluated ${generated}`,
);
