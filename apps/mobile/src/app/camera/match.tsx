import type { PatientRef } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import TriageCapture, { type ViewfinderState } from 'triage-capture';

import { Button } from '@/components/Button';
import { LiveViewfinder } from '@/components/LiveViewfinder';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useScopedTheme } from '@/components/ThemeScope';
import { PatientIdentity } from '@/components/PatientIdentity';
import { PatientPicker } from '@/components/PatientPicker';
import { PrivacyNote } from '@/components/PrivacyNote';
import { api, errorMessage, isApiError } from '@/lib/api';
import { sentences } from '@/lib/format';
import { captureErrorCode, captureErrorMessage } from '@/lib/capture/captureErrors';
import { Text } from '@/components/Text';

/** How long to wait for a face before offering the list of waiting patients. */
const FACE_WAIT_MS = 15_000;

type Match =
  | { step: 'looking' }
  | { step: 'matching' }
  | { step: 'matched'; patient: PatientRef }
  /** No sure match: `reason` says why, and the screen lists who is waiting. */
  | { step: 'fallback'; reason: string; cameraDenied?: boolean };

/** Finds a waiting patient from the patient's face, for patients who opted in at check-in. */
export default function FaceMatch() {
  const theme = useScopedTheme();
  const router = useRouter();
  const [match, setMatch] = useState<Match>({ step: 'looking' });
  const [viewfinder, setViewfinder] = useState<ViewfinderState>('searching');
  const settled = useRef(false);

  useEffect(() => {
    let active = true;
    const settle = (next: Match) => {
      if (!active || settled.current) return;
      settled.current = true;
      setMatch(next);
      void TriageCapture.stopCapture().catch(() => {});
    };

    const tryMatch = async () => {
      setMatch({ step: 'matching' });
      try {
        const crop = await TriageCapture.captureFaceCrop();
        const result = await api.matchFace(crop.jpegBase64);
        if (result.outcome === 'matched' && result.patient != null) {
          settle({ step: 'matched', patient: result.patient });
        } else if (result.outcome === 'low_confidence') {
          settle({ step: 'fallback', reason: 'Face match was not sure enough to pick a patient' });
        } else {
          settle({ step: 'fallback', reason: 'No waiting patient with face match turned on matches this face' });
        }
      } catch (error) {
        const noFace = captureErrorCode(error) === 'ERR_NO_FACE' || (isApiError(error) && error.code === 'no_face_detected');
        settle({
          step: 'fallback',
          reason: noFace
            ? 'No face was found in the picture'
            : isApiError(error)
              ? errorMessage(error)
              : captureErrorMessage(error),
        });
      }
    };

    let matching = false;
    const subscription = TriageCapture.addListener('onStatus', (event) => {
      if (!active || settled.current) return;
      setViewfinder(event.viewfinder);
      if (event.viewfinder === 'measuring' && !matching) {
        matching = true;
        void tryMatch();
      }
    });
    const timeout = setTimeout(
      () => settle({ step: 'fallback', reason: 'No face came into view within 15 seconds' }),
      FACE_WAIT_MS,
    );

    void (async () => {
      try {
        let permission = await TriageCapture.getCameraPermission();
        if (permission === 'undetermined') permission = await TriageCapture.requestCameraPermission();
        if (permission !== 'granted') {
          return settle({ step: 'fallback', reason: 'Triage Cam is not allowed to use the camera', cameraDenied: true });
        }
        await TriageCapture.startCapture({ frameRate: 30 });
      } catch (error) {
        settle({ step: 'fallback', reason: captureErrorMessage(error) });
      }
    })();

    return () => {
      active = false;
      clearTimeout(timeout);
      subscription.remove();
      if (!settled.current) void TriageCapture.stopCapture().catch(() => {});
    };
  }, []);

  const recheck = (patient: number, enrolFace: boolean) =>
    router.replace({ pathname: '/camera/sitting', params: { patient: String(patient), kind: 'recheck', enrol: enrolFace ? '1' : '0' } });

  return (
    <Screen title="Find patient by face" onBack={() => router.back()}>
      {match.step === 'looking' || match.step === 'matching' ? (
        <>
          <View style={{ height: 360 }}>
            <LiveViewfinder
              state={viewfinder}
              message={match.step === 'matching' ? 'Checking for a matching patient. Keep still.' : undefined}
              flipDisabled={match.step === 'matching'}
            />
          </View>
          <PrivacyNote icon="scan">One picture of the face is sent to the station and is not stored</PrivacyNote>
          <Button
            variant="secondary"
            block
            label="Choose from the waiting room instead"
            onPress={() => {
              settled.current = true;
              setMatch({ step: 'fallback', reason: 'Face match was stopped' });
              void TriageCapture.stopCapture().catch(() => {});
            }}
          />
        </>
      ) : null}

      {match.step === 'matched' ? (
        <>
          <View style={{ gap: theme.space.space3 }}>
            <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>Is this you?</Text>
            <PatientIdentity patient={match.patient} size="xl" />
          </View>
          <View style={{ gap: theme.space.space2 }}>
            <Button variant="primary" block label="Start re-check" onPress={() => recheck(match.patient.number, false)} />
            <Button
              variant="secondary"
              block
              label="This is someone else"
              onPress={() => setMatch({ step: 'fallback', reason: 'The matched patient was not used' })}
            />
          </View>
        </>
      ) : null}

      {match.step === 'fallback' ? (
        <>
          <Notice
            title="No patient was matched"
            // Some of the server's reasons already end by saying what to do.
            body={
              /choose the patient/i.test(match.reason)
                ? match.reason
                : sentences(match.reason, 'Choose the patient from the waiting room to carry on')
            }
          >
            {match.cameraDenied ? (
              <Button variant="secondary" block label="Open the Settings app" onPress={() => void Linking.openSettings()} />
            ) : null}
          </Notice>
          <PatientPicker onPick={(item) => recheck(item.patientNumber, false)} />
        </>
      ) : null}
    </Screen>
  );
}
