// Sentences both apps must show word for word, so the privacy claims stay true to the build.

/** Beside the capture controls on the camera phone and beside the live view on the dashboard. */
export const PRIVACY_CAPTURE = 'Video is shown live to staff and is not stored. One profile photo is kept with the patient record.';

/** In the face-match opt-in at check-in. */
export const PRIVACY_FACE =
  'One picture of your face is sent to this station to make a set of numbers for matching. The picture is not stored. The numbers are deleted at discharge, and your name always works instead.';

/** Once per app, quietly: under the sign-in form. Not repeated on working screens. */
export const PROTOTYPE_NOTICE = 'Research prototype, not validated for clinical use';

/** Beside a heart rate the sitting only weakly supports, on the dashboard and in the nurse app. */
export const LOWER_CONFIDENCE = 'Lower confidence';

/** The state of a waiting patient whose latest sitting gave only such a rate: in the place of "No reading". */
export const LOWER_CONFIDENCE_REPEAT = 'Lower confidence, repeat';

/**
 * The camera sets its exposure on the face before it measures, and refuses a face that is too
 * dark, too bright, or whose red channel is at the ceiling. When that has lasted this many
 * seconds it will not pass by itself: the light on the face has to change.
 */
export const EXPOSURE_STUCK_AFTER_SECONDS = 8;

/** What both screens then say in place of "exposure is still adjusting", so the operator has something to do. */
export const EXPOSURE_STUCK = 'Exposure will not settle. Too bright or too dark: move the light';

/**
 * During a sitting, a heart rate or breathing rate that has been shown stays in its box when
 * the readings after it carry no value: the box holds the latest one. A held value with no
 * fresh reading for this long carries its age in the corner of the box. Under it, no label.
 */
export const HELD_READING_LABEL_AFTER_MS = 3000;

/** A value is held for the length of a sitting and no longer: after this the box says why there is none. */
export const HELD_READING_FOR_MS = 60_000;

/**
 * A held value does not outlast the person it was read from. Once the readings after it have
 * said "no face" or "no chest" for this long without a break, the box lets it go, and stays
 * empty until the next value. A shorter gap, or any other reason, keeps the value held.
 */
export const HELD_READING_CLEARS_AFTER_ABSENT_MS = 5000;

/** The reasons that say nobody is in the picture, for the rule above. */
export function isAbsentReason(reason: string | null | undefined): boolean {
  return reason === 'no_face' || reason === 'no_chest';
}

/**
 * Why a finished sitting has no heart or breathing rate although one was on screen while it
 * ran: the live display shows a value sooner than the record accepts one.
 */
export const SHOWN_NOT_RECORDED = 'Shown live, not steady long enough to record. Repeat the sitting';

/** The label in the corner of a box that holds a value: "8 s ago". Null while the value is fresh. */
export function heldReadingAge(ageMs: number): string | null {
  if (!(ageMs >= HELD_READING_LABEL_AFTER_MS)) return null;
  return `${Math.round(ageMs / 1000)} s ago`;
}

/** What that label means, where there is room for a sentence. */
export const LOWER_CONFIDENCE_DETAIL = 'Too little of the sitting gave a clear pulse. Not used for trends or flags. Repeat the sitting.';
