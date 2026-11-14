// Builds apps/web/src/components/landing/eval-data.json from the evaluation harness's outputs.
//
//   node apps/web/scripts/build-landing-eval.mjs [path to eval/out]
//
// eval/out is gitignored: it is written by `uv run eval/run_eval.py <dataset>` (see that file).
// Every number on the landing page comes from the file this script writes, and the pooling
// below is the same arithmetic as `summarise` in eval/run_eval.py, so the figures match
// eval/out/report.md. Re-run this after re-running the harness and commit the result.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '../../../eval/out'));
const target = join(here, '../src/components/landing/eval-data.json');

// Titles and notes mirror TITLES and NOTES in eval/datasets.py.
const DATASETS = {
  mcd: {
    title: 'MCD-rPPG',
    video: 'MPEG-4 compressed, 640 × 480, about 24 fps',
    reference: 'Contact pulse waveform at 100 Hz, reduced to one heart rate per second',
    source: 'https://huggingface.co/datasets/kyegorov/mcd_rppg',
  },
  ubfc: {
    title: 'UBFC-rPPG',
    video: 'uncompressed, 640 × 480, 30 fps',
    reference: 'Fingertip oximeter heart rate recorded with each video',
    source: 'https://sites.google.com/view/ybenezeth/ubfcrppg',
  },
};

// MCD groups are "<camera>, <before|after>".
const MCD_CAMERAS = {
  'front webcam': { camera: 'front', cameraLabel: 'Front-facing webcam' },
  'phone camera, right': { camera: 'side-phone', cameraLabel: 'Phone camera, from the right' },
  'camcorder, left': { camera: 'side-camcorder', cameraLabel: 'Camcorder, from the left' },
};
const MCD_CONDITIONS = { before: { condition: 'rest', conditionLabel: 'At rest' }, after: { condition: 'exercise', conditionLabel: 'After exercise' } };

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, places = 4) => (value == null ? null : Number(value.toFixed(places)));

/** Pooled figures for a set of recordings: `summarise` in eval/run_eval.py. */
function summarise(results) {
  const scored = results.filter((r) => !('error' in r));
  const paired = scored.filter((r) => r.pairedReadings);
  const pairs = paired.reduce((sum, r) => sum + r.pairedReadings, 0);
  const weighted = (key) => (pairs ? paired.reduce((sum, r) => sum + r[key] * r.pairedReadings, 0) / pairs : null);
  const summaries = scored
    .filter((r) => r.summaryHeartRateBpm != null && r.referenceMeanBpm != null)
    .map((r) => Math.abs(r.summaryHeartRateBpm - r.referenceMeanBpm));
  const firsts = scored.filter((r) => r.timeToFirstReadingSeconds != null).map((r) => r.timeToFirstReadingSeconds);
  return {
    recordings: results.length,
    failed: results.length - scored.length,
    subjects: new Set(results.map((r) => r.subject)).size,
    withReading: paired.length,
    pairedReadings: pairs,
    maeBpm: round(weighted('meanAbsoluteErrorBpm')),
    biasBpm: round(weighted('biasBpm')),
    within5: round(weighted('within5BpmShare')),
    coverage: scored.length ? round(mean(scored.map((r) => r.coverage))) : null,
    perRecordingMaeBpm: summaries.length ? round(mean(summaries)) : null,
    perRecordingWithin5: summaries.length ? round(summaries.filter((e) => e <= 5).length / summaries.length) : null,
    recordingsWithSummary: summaries.length,
    medianTimeToFirstS: firsts.length ? round(median(firsts)) : null,
  };
}

const datasets = [];
for (const file of readdirSync(outDir).filter((name) => name.endsWith('.json')).sort()) {
  const id = file.replace(/\.json$/, '');
  const meta = DATASETS[id];
  if (!meta) continue;
  const results = JSON.parse(readFileSync(join(outDir, file), 'utf8'));
  const dataset = { id, ...meta, all: summarise(results), groups: [] };

  if (id === 'mcd') {
    const byGroup = Map.groupBy(results, (r) => r.group);
    for (const [group, rows] of byGroup) {
      const comma = group.lastIndexOf(', ');
      const camera = MCD_CAMERAS[group.slice(0, comma)];
      const condition = MCD_CONDITIONS[group.slice(comma + 2)];
      if (!camera || !condition) throw new Error(`unknown MCD group: ${group}`);
      dataset.groups.push({ id: `${camera.camera}-${condition.condition}`, ...camera, ...condition, ...summarise(rows) });
    }
    const cameraOrder = Object.values(MCD_CAMERAS).map((c) => c.camera);
    dataset.groups.sort(
      (a, b) => cameraOrder.indexOf(a.camera) - cameraOrder.indexOf(b.camera) || (a.condition === 'rest' ? -1 : 1) - (b.condition === 'rest' ? -1 : 1),
    );
  }
  datasets.push(dataset);
}

if (datasets.length === 0) throw new Error(`no dataset results in ${outDir}`);

const report = readFileSync(join(outDir, 'report.md'), 'utf8');
const generated = report.match(/Generated (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

writeFileSync(
  target,
  JSON.stringify(
    {
      note: 'Generated by apps/web/scripts/build-landing-eval.mjs from eval/out. Do not edit by hand.',
      evaluatedOn: generated,
      pairing: 'One heart rate per second from the engine, paired with the reference within 1.5 s',
      datasets,
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${target}: ${datasets.map((d) => `${d.id} (${d.all.recordings} recordings)`).join(', ')}`);
