import type { Ticket } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import TriageCapture, { type ViewfinderState } from 'triage-capture';

import { Button } from '@/components/Button';
import { LiveViewfinder } from '@/components/LiveViewfinder';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useScopedTheme } from '@/components/ThemeScope';
import { TicketEntry } from '@/components/TicketEntry';
import { TicketNumber } from '@/components/TicketNumber';
import { api, errorMessage, isApiError } from '@/lib/api';
import { sentences } from '@/lib/format';
import { captureErrorCode, captureErrorMessage } from '@/lib/capture/captureErrors';

/** How long to wait for a face before asking for the ticket number. */
const FACE_WAIT_MS = 15_000;

type Match =
  | { step: 'looking' }
  | { step: 'matching' }
  | { step: 'matched'; ticket: number }
  /** No sure match: `reason` says why, and the screen asks for the ticket number. */
  | { step: 'fallback'; reason: string; cameraDenied?: boolean };

/** Finds a waiting ticket from the patient's face, for patients who opted in at check-in. */
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
        if (result.outcome === 'matched' && result.ticketNumber != null) {
          settle({ step: 'matched', ticket: result.ticketNumber });
        } else if (result.outcome === 'low_confidence') {
          settle({ step: 'fallback', reason: 'Face match was not sure enough to pick a ticket' });
        } else {
          settle({ step: 'fallback', reason: 'No waiting ticket with face match turned on matches this face' });
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
        await TriageCapture.startCapture({ camera: 'back', frameRate: 30 });
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

  const recheck = (ticket: number, enrolFace: boolean) =>
    router.replace({ pathname: '/camera/sitting', params: { ticket: String(ticket), kind: 'recheck', enrol: enrolFace ? '1' : '0' } });
  const recheckFound = (ticket: Ticket) => recheck(ticket.number, ticket.faceOptIn && !ticket.faceEnrolled);

  return (
    <Screen title="Find ticket by face" onBack={() => router.back()}>
      {match.step === 'looking' || match.step === 'matching' ? (
        <>
          <View style={{ height: 360 }}>
            <LiveViewfinder
              state={viewfinder}
              message={match.step === 'matching' ? 'Checking for a matching ticket. Keep still.' : undefined}
            />
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>
            One picture of the face is sent to the station and is not stored
          </Text>
          <Button
            variant="secondary"
            block
            label="Enter the ticket number instead"
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
          <View style={{ gap: theme.space.space2 }}>
            <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>Is this your ticket?</Text>
            <TicketNumber number={match.ticket} size="xl" />
          </View>
          <Button variant="primary" block label="Start re-check" onPress={() => recheck(match.ticket, false)} />
          <Button
            variant="secondary"
            block
            label="Use a different ticket number"
            onPress={() => setMatch({ step: 'fallback', reason: 'The matched ticket was not used' })}
          />
        </>
      ) : null}

      {match.step === 'fallback' ? (
        <>
          <Notice title="No ticket was matched" body={sentences(match.reason, 'Enter the ticket number to carry on')}>
            {match.cameraDenied ? (
              <Button variant="secondary" block label="Open the Settings app" onPress={() => void Linking.openSettings()} />
            ) : null}
          </Notice>
          <TicketEntry variant="primary" onFound={recheckFound} />
        </>
      ) : null}
    </Screen>
  );
}
