import { BACKERS, DECISIONS, SOURCES } from './viability-data';

function Cite({ n }: { n: number }) {
  return (
    <sup className="lp-cite">
      <a href={`#source-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    </sup>
  );
}

/** Why camera-based vitals are a real technology: the science, the FDA record, the companies. */
export function Viability() {
  return (
    <section id="technology" className="lp-section lp-viability">
      <div className="lp-wrap">
        <header className="lp-section-head">
          <h2 className="lp-h2">The camera pulse is established science with an FDA device class of its own</h2>
          <p className="lp-lead">
            Each heartbeat pushes a little more blood into the skin, and blood absorbs green light. A camera records that as a colour change
            far too faint to see, repeating at the heart rate. In 2008 researchers recovered it with a consumer camera in ordinary room light
            <Cite n={1} />, and the method has a name: remote photoplethysmography, or rPPG.
          </p>
        </header>

        <div className="lp-viability-grid">
          <div className="lp-decisions">
            <h3 className="lp-h3">One regulation, a growing list</h3>
            <p className="lp-decisions-lead">
              In 2021 the FDA granted a De Novo request for Oxehealth Vital Signs and created a device class for software that measures pulse
              and breathing rate with an optical camera, 21 CFR 870.2785
              <Cite n={2} />. Contact-free products from five more companies have been cleared under it since. Each company’s first is listed here.
            </p>
            <ol className="lp-timeline">
              {DECISIONS.map((d) => (
                <li key={d.number} className={d.decision === 'De Novo granted' ? 'lp-decision lp-decision-first' : 'lp-decision'}>
                  <span className="lp-decision-date">
                    <span className="lp-decision-year">{d.year}</span>
                    <span className="lp-decision-day">{d.date}</span>
                  </span>
                  <span className="lp-decision-what">
                    <span className="lp-decision-product">{d.product}</span>
                    <span className="lp-decision-company">{d.company}</span>
                  </span>
                  <span className="lp-decision-kind">
                    {d.decision}
                    <span className="lp-decision-number">
                      {d.number}
                      <Cite n={d.source} />
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="lp-backers">
            <h3 className="lp-h3">Investors are paying for it</h3>
            <ul className="lp-backer-list">
              {BACKERS.map((b) => (
                <li key={b.company}>
                  <span className="lp-backer-name">{b.company}</span>
                  <span>
                    {b.fact}
                    <Cite n={b.source} />.
                  </span>
                </li>
              ))}
            </ul>
            <p className="lp-backers-us">
              Triage Cam is not one of the cleared products. It applies the same measurement principle to one job: re-checking the
              waiting room between check-in and triage.
            </p>
          </div>
        </div>

        <div className="lp-sources">
          <h3 className="lp-sources-title">Sources</h3>
          <ol>
            {SOURCES.map((s) => (
              <li key={s.id} id={`source-${s.id}`}>
                <a href={s.href} rel="noreferrer" className="lp-source-link">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
