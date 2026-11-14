import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import TriageCapture from 'triage-capture';

import { Button } from '@/components/Button';
import { ConsentSheet } from '@/components/ConsentSheet';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useScopedTheme } from '@/components/ThemeScope';
import { PatientPicker } from '@/components/PatientPicker';
import { api, errorMessage } from '@/lib/api';
import { sentences } from '@/lib/format';
import { sourceLabel } from '@/lib/nurse/worklistFormat';
import { Text } from '@/components/Text';

type NewPatient =
  | { step: 'idle' }
  | { step: 'creating' }
  | { step: 'failed'; message: string }
  /** The record exists and the patient is being asked about face match. */
  | { step: 'consent'; patient: number; saving: boolean }
  /** The patient said yes but the choice did not reach the server. */
  | { step: 'opt_in_failed'; patient: number; message: string };

export default function CheckIn() {
  const theme = useScopedTheme();
  const router = useRouter();
  const [newPatient, setNewPatient] = useState<NewPatient>({ step: 'idle' });
  const source = sourceLabel(TriageCapture.getSource());

  const startSitting = (patient: number, kind: 'check_in' | 'recheck', enrolFace: boolean) => {
    setNewPatient({ step: 'idle' });
    router.push({
      pathname: '/camera/sitting',
      params: { patient: String(patient), kind, enrol: enrolFace ? '1' : '0' },
    });
  };

  const createPatient = async () => {
    setNewPatient({ step: 'creating' });
    try {
      const { patient } = await api.createPatient();
      setNewPatient({ step: 'consent', patient: patient.number, saving: false });
    } catch (error) {
      setNewPatient({ step: 'failed', message: errorMessage(error) });
    }
  };

  const acceptFaceMatch = async (patient: number) => {
    setNewPatient({ step: 'consent', patient, saving: true });
    try {
      await api.setFaceOptIn(patient, true);
      startSitting(patient, 'check_in', true);
    } catch (error) {
      setNewPatient({ step: 'opt_in_failed', patient, message: errorMessage(error) });
    }
  };


  return (
    <Screen
      title="Check in"
      subtitle={source ? `${source} signal: this build is not measuring with the camera` : undefined}
      action={{ icon: 'sliders', label: 'Settings', onPress: () => router.push('/settings') }}
    >
      <Section heading="New patient" body="Starts a 60-second sitting. The name and the rest of intake are typed on the dashboard while it runs, and the photo is taken by itself.">
        {newPatient.step === 'failed' ? <Notice title="No patient was created" body={newPatient.message} /> : null}
        {newPatient.step === 'opt_in_failed' ? (
          <Notice
            title="Face match was not turned on"
            body={sentences(newPatient.message, 'The patient was created and can be checked in without it')}
          >
            <Button
              variant="primary"
              block
              label="Start sitting without face match"
              onPress={() => startSitting(newPatient.patient, 'check_in', false)}
            />
          </Notice>
        ) : (
          <Button
            variant="primary"
            block
            icon="user"
            label={newPatient.step === 'creating' ? 'Starting check-in' : 'Check in a new patient'}
            disabled={newPatient.step === 'creating' || newPatient.step === 'consent'}
            onPress={() => void createPatient()}
          />
        )}
      </Section>

      <View style={{ height: 1, backgroundColor: theme.colors.line }} />

      <Section heading="Re-check" body="For someone already in the waiting room. Tap them to start.">
        <PatientPicker onPick={(item) => startSitting(item.patientNumber, 'recheck', false)} />
        <Button
          variant="secondary"
          block
          icon="scan"
          label="Find patient by face"
          accessibilityHint="For patients who turned on face match at check-in"
          onPress={() => router.push('/camera/match')}
        />
        <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>
          Face match works only for patients who turned it on at check-in
        </Text>
      </Section>

      {newPatient.step === 'consent' ? (
        <ConsentSheet
          visible
          patient={newPatient.patient}
          busy={newPatient.saving}
          onDecline={() => startSitting(newPatient.patient, 'check_in', false)}
          onAccept={() => void acceptFaceMatch(newPatient.patient)}
        />
      ) : null}
    </Screen>
  );
}

function Section({ heading, body, children }: { heading: string; body: string; children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View style={{ gap: theme.space.space3 }}>
      <View style={{ gap: theme.space.space1 }}>
        <Text accessibilityRole="header" style={[theme.type.heading, { color: theme.colors.ink }]}>
          {heading}
        </Text>
        <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>{body}</Text>
      </View>
      {children}
    </View>
  );
}
