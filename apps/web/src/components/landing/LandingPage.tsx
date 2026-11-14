import { PRIVACY_CAPTURE, PROTOTYPE_NOTICE } from '@triagecam/contracts';
import Link from 'next/link';

import { Icon, type IconName } from '@/components/ds';

import { Accuracy } from './Accuracy';
import { bpm, dataset } from './eval-data';
import { Viability } from './Viability';
import { Viewfinder } from './Viewfinder';
import { WorklistPreview } from './WorklistPreview';

import './landing.css';

const STEPS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'user',
    title: 'Check in',
    body: 'The patient sits down facing a phone on a stand. The operator takes their name, a photo and what they have come in for.',
  },
  {
    icon: 'scan',
    title: 'Sit for a minute',
    body: 'The camera reads the colour of the forehead and cheeks and the rise of the chest. Pulse and breathing rate settle on screen as the operator watches.',
  },
  {
    icon: 'list',
    title: 'Wait, and stay seen',
    body: 'Every sitting joins the worklist, and a re-check is another minute at the station. When a patient’s numbers move away from where they were at check-in, they rise to the top and the nurse’s phone buzzes.',
  },
];

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const rest = dataset('mcd')?.groups.find((g) => g.id === 'front-rest');
  const primary = signedIn ? { href: '/waiting-room', label: 'Open the dashboard' } : { href: '/sign-up', label: 'Create an account' };

  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>

      <div className="lp-hero" data-theme="dark">
        <header className="lp-wrap lp-nav">
          <Link href="/" className="lp-wordmark">
            Triage Cam
          </Link>
          <nav className="lp-nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#accuracy">Accuracy</a>
            <a href="#technology">The technology</a>
          </nav>
          <div className="lp-nav-actions">
            {signedIn ? null : (
              <Link href="/sign-in" className="lp-link-quiet">
                Sign in
              </Link>
            )}
            <Link href={primary.href} className="lp-button lp-button-primary lp-button-small">
              {primary.label}
            </Link>
          </div>
        </header>

        <main id="main" className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 className="lp-h1">Vital signs without touching the patient</h1>
            <p className="lp-hero-lead">
              Triage Cam turns a phone on a stand into a contact-free vitals station. It measures heart rate and breathing from the camera
              alone, and moves the patients whose numbers are changing to the top of the nurse’s list.
            </p>
            <div className="lp-hero-actions">
              <Link href={primary.href} className="lp-button lp-button-primary">
                {primary.label}
              </Link>
              <a href="#how" className="lp-button lp-button-ghost">
                See how it works
              </a>
            </div>
            {rest ? (
              <p className="lp-hero-proof">
                On public recordings of people at rest facing a camera, its heart rate came within {bpm(rest.maeBpm)} bpm of a contact
                sensor on average. <a href="#accuracy">Read the evaluation</a>
              </p>
            ) : null}
          </div>
          <Viewfinder />
        </main>
      </div>

      <section id="how" className="lp-section lp-how">
        <div className="lp-wrap">
          <header className="lp-section-head">
            <h2 className="lp-h2">No cuff, no clip, no contact</h2>
            <p className="lp-lead">
              Vitals are taken once at the desk, and then the waiting room goes quiet. Triage Cam makes every re-check a minute in a
              chair, with nothing to attach and nothing to clean.
            </p>
          </header>
          <ol className="lp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="lp-step">
                <span className="lp-step-mark">
                  <span className="lp-step-number">{index + 1}</span>
                  <Icon name={step.icon} size={20} />
                </span>
                <h3 className="lp-h3">{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="lp-privacy">
            <Icon name="eye-off" size={18} />
            <span>{PRIVACY_CAPTURE}</span>
          </p>
        </div>
      </section>

      <section className="lp-section lp-context">
        <div className="lp-wrap lp-context-grid">
          <div className="lp-context-copy">
            <h2 className="lp-h2">The list reorders itself around who is changing</h2>
            <p className="lp-lead">
              Nurses see one ranked worklist on the dashboard and on their phone. It shows each patient’s face, name and reason for the
              visit beside what was measured and when.
            </p>
            <dl className="lp-context-points">
              <div>
                <dt>Trend flags</dt>
                <dd>A pulse or breathing rate that has drifted since check-in flags the patient for a person to check.</dd>
              </div>
              <div>
                <dt>Overdue rechecks</dt>
                <dd>Anyone who has waited too long since their last sitting is marked, so nobody is forgotten in a corner.</dd>
              </div>
              <div>
                <dt>A handoff in one sentence</dt>
                <dd>The nurse’s phone gets what changed and over how long, ready to act on.</dd>
              </div>
            </dl>
          </div>
          <WorklistPreview />
        </div>
      </section>

      <Accuracy />
      <Viability />

      <section className="lp-cta" data-theme="dark">
        <div className="lp-wrap lp-cta-inner">
          <h2 className="lp-h2">Set up a station with the phone you already have</h2>
          <p className="lp-lead">Create an account, open the app on a phone in camera mode, and run your first sitting in a few minutes.</p>
          <div className="lp-hero-actions">
            <Link href={primary.href} className="lp-button lp-button-primary">
              {primary.label}
            </Link>
            {signedIn ? null : (
              <Link href="/sign-in" className="lp-button lp-button-ghost">
                Sign in
              </Link>
            )}
          </div>
        </div>
        <footer className="lp-wrap lp-footer">
          <span className="lp-wordmark">Triage Cam</span>
          <span>{PROTOTYPE_NOTICE}</span>
        </footer>
      </section>
    </div>
  );
}
