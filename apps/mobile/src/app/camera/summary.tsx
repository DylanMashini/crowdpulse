import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import type { IconName } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { PrivacyNote } from '@/components/PrivacyNote';
import { Screen } from '@/components/Screen';
import { SittingSummary } from '@/components/SittingSummary';
import { useScopedTheme } from '@/components/ThemeScope';
import { PatientIdentity } from '@/components/PatientIdentity';
import { usePatientRef } from '@/hooks/usePatientRef';
import { summaryItems } from '@/lib/capture/readingFormat';
import { type FinishedSitting, finishedSitting } from '@/lib/capture/sittingSession';
import type { UploadState } from '@/lib/capture/uploadQueue';
import { sentences } from '@/lib/format';
import { sourceLabel } from '@/lib/nurse/worklistFormat';
import { Text } from '@/components/Text';

export default function Summary() {
  const router = useRouter();
  const { sitting: sittingId } = useLocalSearchParams<{ sitting: string }>();
  const sitting = finishedSitting(sittingId);
  if (!sitting) {
    return (
      <Screen title="Sitting summary">
        <Notice
          title="This sitting is no longer on the phone"
          body="Summaries are kept only while the app stays open. The patient page on the dashboard has the saved values."
        >
          <Button variant="primary" block label="Back to check-in" onPress={() => router.dismissTo('/camera')} />
        </Notice>
      </Screen>
    );
  }
  return <SummaryContent sitting={sitting} />;
}

function SummaryContent({ sitting }: { sitting: FinishedSitting }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const uploads = useSyncExternalStore(sitting.uploads.subscribe, sitting.uploads.getState);
  const status = uploadStatus(uploads, sitting.kind);
  const source = sourceLabel(sitting.source);
  const patient = usePatientRef(sitting.patientNumber, null);

  return (
    <Screen title="Sitting summary">
      <View style={{ gap: space.space1 }}>
        <PatientIdentity patient={patient} size="lg" />
        <Text style={[theme.type.bodyTouch, { color: colors.inkMuted }]}>
          Give your name when you sit down again
        </Text>
      </View>

      <SittingSummary
        items={summaryItems(sitting.summary, sitting.mainReasons)}
        status={status}
        sourceNote={source ? `${source} signal, not a camera measurement` : null}
      >
        {status.detail ? (
          <View style={{ gap: space.space3 }}>
            <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>{status.detail}</Text>
            {uploads.finish === 'pending' && uploads.error ? (
              <Button variant="secondary" label="Send again now" onPress={() => sitting.uploads.flush()} />
            ) : null}
          </View>
        ) : null}
        {sitting.face.status === 'enrolled' ? (
          <PrivacyNote icon="scan">
            Face match is on for this patient. The picture was not stored, and the numbers made from it are deleted at
            discharge.
          </PrivacyNote>
        ) : null}
        {sitting.face.status === 'failed' ? (
          <PrivacyNote icon="user">
            {sentences(`Face match was not set up: ${sitting.face.reason}`, 'Re-checks start from the waiting-room list instead')}
          </PrivacyNote>
        ) : null}
      </SittingSummary>

      <Button variant="primary" block label="Next patient" onPress={() => router.dismissTo('/camera')} />
    </Screen>
  );
}

function uploadStatus(
  uploads: UploadState,
  kind: FinishedSitting['kind'],
): { icon: IconName; text: string; settled: boolean; detail: string | null } {
  const refused =
    uploads.droppedReadings > 0
      ? `The station did not accept ${uploads.droppedReadings} of the one-second readings`
      : null;
  if (uploads.finish === 'sent') {
    return { icon: 'check', text: kind === 'check_in' ? 'Baseline saved' : 'Re-check saved', settled: true, detail: refused };
  }
  if (uploads.finish === 'failed') {
    return {
      icon: 'no-reading',
      text: 'Not saved',
      settled: false,
      detail: sentences(
        'The station refused this sitting',
        uploads.error,
        'The values below were measured but are not on the patient',
        'Run the sitting again',
      ),
    };
  }
  if (uploads.error) {
    const waiting =
      uploads.pendingReadings > 0
        ? `${uploads.pendingReadings} readings and the summary are kept on this phone`
        : 'The summary is kept on this phone';
    return {
      icon: 'clock',
      text: 'Not sent yet',
      settled: false,
      detail: sentences(uploads.error, `${waiting} and sent when the server answers`, 'Keep the app open'),
    };
  }
  return { icon: 'clock', text: 'Saving to the station', settled: false, detail: null };
}
