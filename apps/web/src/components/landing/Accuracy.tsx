import { AccuracyChart } from './AccuracyChart';
import { bpm, dataset, evaluatedOn, longDate, pairing, percent, signedBpm, type EvalSummary } from './eval-data';

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

const counts = (s: EvalSummary) =>
  `${s.pairedReadings.toLocaleString('en-US')} one-second readings from ${s.withReading} of ${s.recordings} recordings`;

/** The accuracy section. Every figure is read from eval-data.json. */
export function Accuracy() {
  const mcd = dataset('mcd');
  const ubfc = dataset('ubfc');
  const rest = mcd?.groups.find((g) => g.id === 'front-rest');
  const exercise = mcd?.groups.find((g) => g.id === 'front-exercise');
  if (!mcd || !rest) return null;

  const side = mcd.groups.filter((g) => g.camera !== 'front').map((g) => g.maeBpm ?? 0);
  const date = longDate(evaluatedOn);

  return (
    <section id="accuracy" className="lp-section lp-accuracy">
      <div className="lp-wrap">
        <header className="lp-section-head">
          <h2 className="lp-h2">Checked against contact sensors, second by second</h2>
          <p className="lp-lead">
            We ran the same engine that ships on the phone over public recordings of real people, each filmed while wearing a contact pulse
            sensor, and compared every one-second reading with the sensor.
          </p>
        </header>

        <div className="lp-result">
          <div className="lp-result-what">
            <h3 className="lp-h3">Facing the camera, at rest</h3>
            <p>
              The condition the station is built for. {mcd.title}: {rest.subjects} people filmed by a front-facing webcam before exercise.
            </p>
            <p className="lp-result-n">{counts(rest)}</p>
          </div>
          <dl className="lp-figures">
            <Figure value={bpm(rest.maeBpm)} unit="bpm" label="Mean absolute error" />
            <Figure value={percent(rest.within5)} label="Readings within 5 bpm" />
            <Figure value={signedBpm(rest.biasBpm)} unit="bpm" label="Bias against the sensor" />
          </dl>
        </div>

        <div className="lp-result-pair">
          {exercise ? (
            <div className="lp-result lp-result-small">
              <div className="lp-result-what">
                <h3 className="lp-h3">Same camera, after exercise</h3>
                <p>The same {exercise.subjects} people straight after squats, with heart rates still falling.</p>
                <p className="lp-result-n">{counts(exercise)}</p>
              </div>
              <dl className="lp-figures">
                <Figure value={bpm(exercise.maeBpm)} unit="bpm" label="Mean absolute error" />
                <Figure value={percent(exercise.within5)} label="Within 5 bpm" />
              </dl>
            </div>
          ) : null}
          {ubfc ? (
            <div className="lp-result lp-result-small">
              <div className="lp-result-what">
                <h3 className="lp-h3">Uncompressed webcam video</h3>
                <p>
                  {ubfc.title}: the first {ubfc.all.subjects} of its 42 subjects, seated at a webcam, against a fingertip oximeter.
                </p>
                <p className="lp-result-n">{counts(ubfc.all)}</p>
              </div>
              <dl className="lp-figures">
                <Figure value={bpm(ubfc.all.maeBpm)} unit="bpm" label="Mean absolute error" />
                <Figure value={percent(ubfc.all.within5)} label="Within 5 bpm" />
              </dl>
            </div>
          ) : null}
        </div>

        <div className="lp-chart-block">
          <div className="lp-chart-copy">
            <h3 className="lp-h3">Why the patient faces the phone</h3>
            <p>
              {mcd.title} films every person from three positions at once. Side-on cameras see less skin and more shadow, and their error
              is {bpm(Math.min(...side))} to {bpm(Math.max(...side))} bpm. That is the reason check-in seats the patient square to the
              camera.
            </p>
          </div>
          <AccuracyChart groups={mcd.groups} />
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
              <dt>{mcd.title}, front-facing, at rest</dt>
              <dd>
                A reading in {percent(rest.coverage)} of seconds, and at least one in {rest.withReading} of {rest.recordings} recordings.
                First reading after a median {rest.medianTimeToFirstS} s. Footage: {mcd.video}.
              </dd>
            </div>
            {ubfc ? (
              <div>
                <dt>{ubfc.title}</dt>
                <dd>
                  A reading in {percent(ubfc.all.coverage)} of seconds, and at least one in {ubfc.all.withReading} of {ubfc.all.recordings}{' '}
                  recordings. First reading after a median {ubfc.all.medianTimeToFirstS} s. Footage: {ubfc.video}.
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <details className="lp-table-details">
          <summary>Every condition as a table</summary>
          <div className="lp-table-scroll">
            <table className="lp-table">
              <thead>
                <tr>
                  <th scope="col">Dataset and condition</th>
                  <th scope="col">Recordings</th>
                  <th scope="col">With a reading</th>
                  <th scope="col">Paired readings</th>
                  <th scope="col">MAE, bpm</th>
                  <th scope="col">Bias, bpm</th>
                  <th scope="col">Within 5 bpm</th>
                  <th scope="col">Seconds with a reading</th>
                  <th scope="col">Sitting summary MAE, bpm</th>
                </tr>
              </thead>
              <tbody>
                {mcd.groups.map((g) => (
                  <Row key={g.id} label={`${mcd.title}: ${lowerFirst(g.cameraLabel)}, ${lowerFirst(g.conditionLabel)}`} s={g} />
                ))}
                <Row label={`${mcd.title}: all six conditions`} s={mcd.all} />
                {ubfc ? <Row label={`${ubfc.title}: ${ubfc.all.subjects} of 42 subjects`} s={ubfc.all} /> : null}
              </tbody>
            </table>
          </div>
        </details>

        <p className="lp-method">
          Method: {lowerFirst(pairing)}. Each video goes through the same path as a sitting on the phone: frames, face regions, signal engine
          at its default settings. References: {mcd.title}, {lowerFirst(mcd.reference)}
          {ubfc ? `; ${ubfc.title}, ${lowerFirst(ubfc.reference)}` : ''}. Datasets:{' '}
          <a href={mcd.source} rel="noreferrer">
            {mcd.title}
          </a>
          {ubfc ? (
            <>
              ,{' '}
              <a href={ubfc.source} rel="noreferrer">
                {ubfc.title}
              </a>
            </>
          ) : null}
          .{date ? ` Evaluated ${date}.` : ''}
        </p>
      </div>
    </section>
  );
}

function Row({ label, s }: { label: string; s: EvalSummary }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{s.recordings}</td>
      <td>{s.withReading}</td>
      <td>{s.pairedReadings.toLocaleString('en-US')}</td>
      <td>{bpm(s.maeBpm)}</td>
      <td>{signedBpm(s.biasBpm)}</td>
      <td>{percent(s.within5)}</td>
      <td>{percent(s.coverage)}</td>
      <td>
        {bpm(s.perRecordingMaeBpm)} <span className="lp-table-n">(n={s.recordingsWithSummary})</span>
      </td>
    </tr>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
