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

/** What that label means, where there is room for a sentence. */
export const LOWER_CONFIDENCE_DETAIL = 'Too little of the sitting gave a clear pulse. Not used for trends or flags. Repeat the sitting.';
