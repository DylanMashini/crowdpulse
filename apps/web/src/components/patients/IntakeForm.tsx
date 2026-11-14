'use client';

import { EARLIEST_DATE_OF_BIRTH, INTAKE_LIMITS, type Patient, type PatientSex, type UpdatePatientRequest } from '@triagecam/contracts';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from 'react';

import { Button, Field, PatientAvatar } from '@/components/ds';
import { api, errorMessage } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { cx } from '@/lib/cx';
import { forgetIntakeDraftIfUnchanged, keepIntakeDraft, readIntakeDraft } from '@/lib/intake-draft';

type TextKey = 'name' | 'reasonForVisit' | 'allergies' | 'notes';
/** What has been typed or picked here and may not have reached the server yet. */
type Draft = Partial<{
  name: string;
  dateOfBirth: string;
  sex: PatientSex | null;
  reasonForVisit: string;
  painScore: number | null;
  allergies: string;
  notes: string;
}>;
type DraftKey = keyof Draft;

/** Typing pauses for this long before what was typed is saved. */
const SAVE_AFTER_MS = 400;

const SEXES: Array<{ value: PatientSex; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

const PAIN = Array.from({ length: 11 }, (_, score) => score);

/**
 * The unsaved fields kept for this patient in the tab (`intake-draft.ts`), for example from
 * before the session ended and staff signed in again. Only what the form could have written.
 */
function keptDraft(patientNumber: number): Draft {
  const kept = readIntakeDraft(patientNumber);
  const draft: Draft = {};
  if (!kept) return draft;
  for (const key of ['name', 'reasonForVisit', 'allergies', 'notes', 'dateOfBirth'] as const) {
    const value = kept[key];
    if (typeof value === 'string') draft[key] = value;
  }
  const { sex, painScore } = kept;
  if (sex === null || SEXES.some((each) => each.value === sex)) draft.sex = sex as PatientSex | null;
  if (painScore === null || PAIN.some((score) => score === painScore)) draft.painScore = painScore as number | null;
  return draft;
}

/** Today on this screen's calendar, as YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** What is wrong with a typed date of birth, or null. A date box reports half-typed years too. */
function dateOfBirthError(value: string | undefined): string | null {
  if (!value) return null;
  if (value > today()) return 'The date of birth cannot be in the future';
  if (value < EARLIEST_DATE_OF_BIRTH) return `Enter a date from ${EARLIEST_DATE_OF_BIRTH.slice(0, 4)} on`;
  return null;
}

/** The part of the draft the server will take. A date of birth out of range waits in its box. */
function sendable(draft: Draft): Draft {
  const sending = { ...draft };
  if (dateOfBirthError(sending.dateOfBirth)) delete sending.dateOfBirth;
  return sending;
}

function toRequest(draft: Draft): UpdatePatientRequest {
  const request: UpdatePatientRequest = {};
  if (draft.name !== undefined) request.name = draft.name;
  if (draft.reasonForVisit !== undefined) request.reasonForVisit = draft.reasonForVisit;
  if (draft.allergies !== undefined) request.allergies = draft.allergies;
  if (draft.notes !== undefined) request.notes = draft.notes;
  if (draft.dateOfBirth !== undefined) request.dateOfBirth = draft.dateOfBirth === '' ? null : draft.dateOfBirth;
  if (draft.sex !== undefined) request.sex = draft.sex;
  if (draft.painScore !== undefined) request.painScore = draft.painScore;
  return request;
}

export interface IntakeFormProps {
  patient: Patient;
  /** The server's answer after a save, a new photo or a completed intake. */
  onSaved: (patient: Patient) => void;
  /** The camera phone looking at this patient, when the photo can be retaken from its picture. */
  cameraDeviceId?: string | null;
  cameraLive?: boolean;
  /** Puts the cursor in the name box when the form appears for a patient with no name. */
  autoFocus?: boolean;
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string };

/**
 * The intake form. There is no save button: each field is saved a moment after it changes,
 * so the name is on the worklist while the sitting is still running. Mount it with
 * `key={patient.number}`.
 */
export function IntakeForm({ patient, onSaved, cameraDeviceId, cameraLive, autoFocus }: IntakeFormProps) {
  // Starts from what was typed here and never reached the server, if the tab still holds any.
  const [draft, setDraft] = useState<Draft>(() => keptDraft(patient.number));
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [photo, setPhoto] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [completing, setCompleting] = useState(false);
  /** Staff removed the photo on this form: nothing takes a new one until they ask. */
  const [removed, setRemoved] = useState(false);

  const draftRef = useRef<Draft>(draft);
  const focused = useRef<DraftKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const saved = useRef(onSaved);
  const number = patient.number;
  useEffect(() => {
    saved.current = onSaved;
  });

  // flush schedules itself again when more was typed while a save was in the air.
  const again = useRef<() => void>(() => {});
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) return;
    const sending = sendable(draftRef.current);
    if (Object.keys(sending).length === 0) return;
    inFlight.current = true;
    setSave({ kind: 'saving' });
    try {
      const response = await api.updatePatient(number, toRequest(sending));
      saved.current(response.patient);
      // What was sent and has not changed since is now the server's. A box the cursor is still
      // in keeps its text as typed, so a trailing space is not trimmed away mid-sentence.
      const next = { ...draftRef.current };
      for (const key of Object.keys(sending) as DraftKey[]) {
        if (next[key] === sending[key] && focused.current !== key) delete next[key];
      }
      const unsent = (Object.keys(next) as DraftKey[]).some((key) => next[key] !== sending[key]);
      draftRef.current = next;
      setDraft(next);
      keepIntakeDraft(number, next);
      setSave({ kind: 'saved', at: Date.now() });
      inFlight.current = false;
      if (unsent) timer.current = setTimeout(() => again.current(), SAVE_AFTER_MS);
    } catch (error) {
      inFlight.current = false;
      setSave({ kind: 'error', message: errorMessage(error) });
    }
  }, [number]);

  useEffect(() => {
    again.current = () => void flush();
  }, [flush]);

  // A draft the tab kept from last time is saved as soon as the form is back.
  useEffect(() => {
    if (Object.keys(draftRef.current).length > 0) timer.current = setTimeout(() => again.current(), 0);
  }, []);

  // Leaving the page with something typed in the last moment: send it on the way out. If that
  // save is refused (the session ended), the tab still holds the text for when the form is back.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const unsent = sendable(draftRef.current);
      if (Object.keys(unsent).length === 0 || inFlight.current) return;
      const whole = draftRef.current;
      void api
        .updatePatient(number, toRequest(unsent))
        .then(() => {
          if (Object.keys(unsent).length === Object.keys(whole).length) forgetIntakeDraftIfUnchanged(number, whole);
        })
        .catch(() => {});
    },
    [number],
  );

  const change = <Key extends DraftKey>(key: Key, value: Draft[Key], immediately = false) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    keepIntakeDraft(number, next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), immediately ? 0 : SAVE_AFTER_MS);
  };

  const text = (key: TextKey) => draft[key] ?? patient[key] ?? '';
  // Each box carries its field's name, so one pair of handlers serves them all.
  const onFocus = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    focused.current = event.currentTarget.name as DraftKey;
  };
  const onBlur = () => {
    focused.current = null;
    void flush();
  };

  const sex = draft.sex !== undefined ? draft.sex : patient.sex;
  const pain = draft.painScore !== undefined ? draft.painScore : patient.painScore;
  const notesId = useId();
  const sexId = useId();
  const painId = useId();
  const complete = patient.intakeCompletedAt !== null;
  const named = text('name').trim() !== '';
  const nameHintId = useId();

  const run = async (action: () => Promise<{ patient: Patient } | void>) => {
    setPhoto({ busy: true, error: null });
    try {
      const response = await action();
      if (response) saved.current(response.patient);
      setPhoto({ busy: false, error: null });
    } catch (error) {
      setPhoto({ busy: false, error: errorMessage(error) });
    }
  };

  const setComplete = async (next: boolean) => {
    setCompleting(true);
    try {
      await flush();
      const response = await api.updatePatient(number, { intakeComplete: next });
      saved.current(response.patient);
      setSave({ kind: 'saved', at: Date.now() });
    } catch (error) {
      setSave({ kind: 'error', message: errorMessage(error) });
    }
    setCompleting(false);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <div className="flex items-center gap-4">
        <PatientAvatar patient={{ number, name: text('name') || null, photoUpdatedAt: patient.photoUpdatedAt }} size="xl" />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <p className="type-caption text-ink-muted">
            {patient.photoUpdatedAt
              ? `Photo taken at ${clockTime(patient.photoUpdatedAt)}`
              : removed
                ? 'Photo removed. No new one is taken unless you ask for it.'
                : cameraLive
                  ? 'The photo is taken by itself as soon as the camera sees a face'
                  : 'No photo yet. It is taken from the camera during check-in.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {cameraDeviceId ? (
              <Button
                variant="secondary"
                disabled={photo.busy || !cameraLive}
                onClick={() => void run(() => api.capturePatientPhoto(number, cameraDeviceId))}
              >
                {photo.busy ? 'Taking photo' : patient.photoUpdatedAt ? 'Retake photo' : 'Take photo now'}
              </Button>
            ) : null}
            {patient.photoUpdatedAt ? (
              <Button variant="quiet" disabled={photo.busy} onClick={() => void run(() => api.deletePatientPhoto(number).then(() => setRemoved(true)))}>
                Remove
              </Button>
            ) : null}
          </div>
          {photo.error ? (
            <p role="alert" className="type-caption font-medium text-critical">
              {photo.error}
            </p>
          ) : null}
        </div>
      </div>

      <Field
        block
        label="Full name"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={INTAKE_LIMITS.name}
        placeholder="As the patient gives it"
        value={text('name')}
        onChange={(event) => change('name', event.target.value)}
        name="name"
        onFocus={onFocus}
        onBlur={onBlur}
      />

      <Field
        block
        label="Reason for visit"
        autoComplete="off"
        maxLength={INTAKE_LIMITS.reasonForVisit}
        placeholder="Chest pain since this morning"
        value={text('reasonForVisit')}
        onChange={(event) => change('reasonForVisit', event.target.value)}
        name="reasonForVisit"
        onFocus={onFocus}
        onBlur={onBlur}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field
          block
          type="date"
          label="Date of birth"
          min={EARLIEST_DATE_OF_BIRTH}
          max={today()}
          error={dateOfBirthError(draft.dateOfBirth) ?? undefined}
          value={draft.dateOfBirth ?? patient.dateOfBirth ?? ''}
          onChange={(event) => change('dateOfBirth', event.target.value)}
          name="dateOfBirth"
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="flex flex-col gap-1">
          <span id={sexId} className="type-label">
            Sex
          </span>
          <div role="radiogroup" aria-labelledby={sexId} className="inline-flex h-control-md items-stretch rounded-md border border-line-strong bg-surface-raised p-[2px]">
            {SEXES.map((option) => {
              const on = sex === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  // Picking the chosen one again clears it: the box may be left empty.
                  onClick={() => change('sex', on ? null : option.value, true)}
                  className={cx(
                    'cursor-pointer rounded-sm px-3 text-[15px] whitespace-nowrap transition-colors duration-[120ms] ease-out',
                    on ? 'bg-signal-soft font-semibold text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span id={painId} className="type-label">
          Pain, 0 to 10
        </span>
        <div role="radiogroup" aria-labelledby={painId} className="grid grid-cols-11 gap-[2px] rounded-md border border-line-strong bg-surface-raised p-[2px]">
          {PAIN.map((score) => {
            const on = pain === score;
            return (
              <button
                key={score}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${score} out of 10`}
                onClick={() => change('painScore', on ? null : score, true)}
                className={cx(
                  'h-[30px] cursor-pointer rounded-sm font-mono text-[14px] tabular-nums transition-colors duration-[120ms] ease-out',
                  on ? 'bg-signal-soft font-semibold text-ink' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {score}
              </button>
            );
          })}
        </div>
        <p className="type-caption text-ink-muted">As the patient reports it. 0 is none, 10 the worst imaginable.</p>
      </div>

      <Field
        block
        label="Allergies"
        autoComplete="off"
        maxLength={INTAKE_LIMITS.allergies}
        placeholder="None known"
        value={text('allergies')}
        onChange={(event) => change('allergies', event.target.value)}
        name="allergies"
        onFocus={onFocus}
        onBlur={onBlur}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={notesId} className="type-label">
          Notes
        </label>
        <textarea
          id={notesId}
          rows={3}
          maxLength={INTAKE_LIMITS.notes}
          placeholder="Symptoms, history, medication"
          value={text('notes')}
          onChange={(event) => change('notes', event.target.value)}
          name="notes"
          onFocus={onFocus}
          onBlur={onBlur}
          className="min-h-[84px] w-full resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2 font-sans text-[15px] leading-[22px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
        <p role="status" className={cx('type-caption', save.kind === 'error' ? 'font-medium text-critical' : 'text-ink-muted')}>
          {save.kind === 'error'
            ? `Not saved: ${save.message}`
            : save.kind === 'saving'
              ? 'Saving'
              : save.kind === 'saved'
                ? `Saved at ${clockTime(save.at)}`
                : 'Saved as you type'}
        </p>
        {complete ? (
          <div className="flex items-center gap-2">
            <span className="type-caption text-ink-muted">Intake completed at {clockTime(patient.intakeCompletedAt as string)}</span>
            <Button variant="quiet" disabled={completing} onClick={() => void setComplete(false)}>
              Reopen
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {named ? null : (
              <span id={nameHintId} className="type-caption text-ink-muted">
                Enter the patient&apos;s name to complete intake
              </span>
            )}
            <Button variant="primary" disabled={completing || !named} aria-describedby={named ? undefined : nameHintId} onClick={() => void setComplete(true)}>
              {completing ? 'Saving' : 'Complete intake'}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
