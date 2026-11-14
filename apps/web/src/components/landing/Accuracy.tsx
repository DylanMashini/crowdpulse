import {
  bpm,
  dataset,
  evaluatedOn,
  heldOut,
  heldOutWithoutSeen,
  longDate,
  pairing,
  percent,
  provenance,
  referenceChecks,
  seenInDevelopment,
  signedBpm,
  split,
  type EvalSummary,
} from './eval-data';

function Figure({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="lp-figure">
      <dd className="lp-figure-value">
        {value}
        {unit ? <span className="lp-figure-unit">{unit}</span> : null}
      </dd>
      <dt className="lp-figure-label">{label}</dt>
    </div>
  );
}

/**
 * The accuracy section. Every figure is read from eval-data.json, which holds one thing: the
 * held-out set of UBFC-rPPG. Each group of figures carries its provenance line (dataset, set, n,
 * date), and the error figures say they are measured on the seconds that had a reading.
 *
 * The held-out figure is never shown without its disclosure: some held-out subjects had been
 * used in engine checks before the split was drawn. They stay in the figure, and the figure
 * without them is printed beside it.
 */
export function Accuracy() {
  const s = heldOut;
  const unseen = heldOutWithoutSeen;
  const date = longDate(evaluatedOn) ?? evaluatedOn;

  return (
    <section id="accuracy" className="lp-section lp-accuracy">
      <div className="lp-wrap">
        <header className="lp-section-head">
          <h2 className="lp-h2">Checked against a contact sensor, second by second</h2>
          <p className="lp-lead">
            We ran the same engine that ships on the phone over public recordings of real people, each filmed while wearing a fingertip
            oximeter, and compared every one-second reading with the oximeter.
          </p>
        </header>

        <div className="lp-result">
          <div className="lp-result-what">
            <h3 className="lp-h3">Seated, facing a webcam</h3>
            <p>
              The condition the station is built for. {dataset.title}: {s.subjects} people seated at a webcam, each wearing a fingertip
              oximeter. The dataset&apos;s {dataset.totalSubjects} subjects were divided by a fixed seed, and these {s.subjects} are the
              held-out set.
            </p>
            <p className="lp-result-n">{provenance()}.</p>
          </div>
          <div className="lp-figure-groups">
            <div className="lp-figure-group">
              <p className="lp-figure-caption">
                Second by second{' '}
                <span>
                  Every one-second reading against the oximeter at that second. Error is measured on the seconds when the engine gave a
                  reading, which was {percent(s.coverage)} of seconds.
                </span>
              </p>
              <dl className="lp-figures">
                <Figure value={bpm(s.maeBpm)} unit="bpm" label="Mean absolute error" />
                <Figure value={percent(s.within5)} label="Readings within 5 bpm" />
                <Figure value={signedBpm(s.biasBpm)} unit="bpm" label="Bias against the oximeter" />
              </dl>
            </div>
          </div>
        </div>

        <div className="lp-silence">
          <div>
            <h3 className="lp-h3">When it is not sure, it says No reading</h3>
            <p>
              A reading appears only after three consecutive windows agree and the signal clears a quality threshold. Otherwise the
              dashboard prints the words No reading and the reason, not a dash, a zero or the last good number.
            </p>
          </div>
          <dl className="lp-silence-facts">
            <div>
              <dt>How often it gave a reading</dt>
              <dd>
                A reading in {percent(s.coverage)} of seconds, and at least one in {s.withReading} of {s.recordings} recordings. First
                reading after a median {s.medianTimeToFirstS} s. {provenance()}.
              </dd>
            </div>
            <div>
              <dt>How that share is counted</dt>
              <dd>
                In each recording, the share of one-second ticks, counting the warm-up, in which the engine gave a heart rate. The shares
                are averaged over the {s.recordings} recordings, each counting equally.
              </dd>
            </div>
          </dl>
        </div>

        <div className="lp-silence">
          <div>
            <h3 className="lp-h3">How the test set was kept apart</h3>
            <p>
              Subjects were split into a tuning set and a held-out set by a fixed seed before the new recordings were scored. Every figure
              here comes from the held-out set.
            </p>
          </div>
          <dl className="lp-silence-facts">
            {unseen ? (
              <div>
                <dt>
                  {numberWord(seenInDevelopment)} of the {s.subjects} were not new to the engine
                </dt>
                <dd>
                  {numberWord(seenInDevelopment)} of the {s.subjects} held-out subjects had been used to check the engine during earlier
                  development. They stay in the figures above. Without them, the mean absolute error is {bpm(unseen.maeBpm)} bpm, with{' '}
                  {percent(unseen.within5)} of readings within 5 bpm ({unseen.subjects} subjects,{' '}
                  {unseen.pairedReadings.toLocaleString('en-US')} one-second readings, evaluated {date}).
                </dd>
              </div>
            ) : null}
            <div>
              <dt>The reference</dt>
              <dd>
                The fingertip oximeter heart rate recorded with the dataset. For {referenceChecks.authorsFile} of the {s.subjects} subjects
                the reference file was checked against the dataset authors&apos; copy; for the other {referenceChecks.otherCopies}, against
                two other public copies of the dataset.
              </dd>
            </div>
          </dl>
        </div>

        <details className="lp-table-details">
          <summary>The figures as a table</summary>
          <div className="lp-table-scroll">
            <table className="lp-table">
              <thead>
                <tr>
                  <th scope="col">Dataset and set</th>
                  <th scope="col">Subjects</th>
                  <th scope="col">Recordings with a reading</th>
                  <th scope="col">Paired readings</th>
                  <th scope="col">MAE, bpm</th>
                  <th scope="col">Bias, bpm</th>
                  <th scope="col">Within 5 bpm</th>
                  <th scope="col">Seconds with a reading</th>
                  <th scope="col">Median time to first reading, s</th>
                </tr>
              </thead>
              <tbody>
                <Row label={`${dataset.title}, held-out set, evaluated ${date}`} s={s} />
                {unseen ? <Row label={`The same, without the ${seenInDevelopment} subjects used in earlier engine checks`} s={unseen} /> : null}
              </tbody>
            </table>
          </div>
        </details>

        <p className="lp-method">
          Method: {lowerFirst(pairing)}. Each video goes through the same path as a sitting on the phone: frames, face regions, signal engine
          at its default settings. Footage: {dataset.video}. Reference: {lowerFirst(dataset.reference)}. Dataset:{' '}
          <a href={dataset.source} rel="noreferrer">
            {dataset.title}
          </a>
          , {dataset.totalSubjects} subjects, divided by a fixed seed into {split.tuningSubjects} for tuning the engine and{' '}
          {split.heldOutSubjects} held out; every figure here is from the held-out set. Evaluated {date}. Not a clinical validation.
        </p>
      </div>
    </section>
  );
}

function Row({ label, s }: { label: string; s: EvalSummary }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{s.subjects}</td>
      <td>
        {s.withReading} of {s.recordings}
      </td>
      <td>{s.pairedReadings.toLocaleString('en-US')}</td>
      <td>{bpm(s.maeBpm)}</td>
      <td>{signedBpm(s.biasBpm)}</td>
      <td>{percent(s.within5)}</td>
      <td>{percent(s.coverage)}</td>
      <td>{s.medianTimeToFirstS ?? 'n/a'}</td>
    </tr>
  );
}

/** "Four" for 4: counts that open a sentence are spelled out. */
const numberWord = (n: number) => ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n] ?? String(n);

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
