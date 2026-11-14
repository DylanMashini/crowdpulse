import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Reading } from '@triagecam/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TriageCapture from 'triage-capture';

import { Button } from '@/components/Button';
import { CaptureStatus } from '@/components/CaptureStatus';
import { LiveTrace } from '@/components/LiveTrace';
import { LiveViewfinder } from '@/components/LiveViewfinder';
import { Notice } from '@/components/Notice';
import { ProvenanceTag } from '@/components/ProvenanceTag';
import { Readout } from '@/components/Readout';
import { SittingTimer } from '@/components/SittingTimer';
import { Switch } from '@/components/Switch';
import { useScopedTheme } from '@/components/ThemeScope';
import { PatientIdentity } from '@/components/PatientIdentity';
import { usePatientRef } from '@/hooks/usePatientRef';
import { readoutFor } from '@/lib/capture/readingFormat';
import { stationLink } from '@/lib/capture/station';
import { type Trace, pushTrace } from '@/lib/capture/trace';
import { type LiveViewState, useSittingController } from '@/lib/capture/useSittingController';
import { tidy } from '@/lib/format';
import { hairline } from '@/theme';
import { sourceLabel } from '@/lib/nurse/worklistFormat';
import { useDevice } from '@/lib/session/SessionProvider';
import { Text } from '@/components/Text';

export default function Sitting() {
  const params = useLocalSearchParams<{ patient: string; kind: string; enrol?: string }>();
  const device = useDevice();
  const patientNumber = Number(params.patient);
  if (!device || !Number.isSafeInteger(patientNumber) || patientNumber < 1) return null;
  return (
    <SittingScreen
      patientNumber={patientNumber}
      kind={params.kind === 'recheck' ? 'recheck' : 'check_in'}
      enrolFace={params.enrol === '1'}
      deviceId={device.id}
    />
  );
}

type Props = { patientNumber: number; kind: 'check_in' | 'recheck'; enrolFace: boolean; deviceId: string };

/** The seconds of one sitting, and with them the width of the live traces. */
const TRACE_SECONDS = 60;
/** The smallest range a trace's height stands for, so a steady reading draws a level line. */
const PULSE_SPAN_BPM = 12;
const BREATHING_SPAN_PER_MIN = 6;

type Traces = { last: Reading | null; pulse: Trace; breathing: Trace };
const NO_TRACES: Traces = { last: null, pulse: [], breathing: [] };

function SittingScreen({ patientNumber, kind, enrolFace, deviceId }: Props) {
  useKeepAwake();
  // The phone sits on its mount in landscape while it captures.
  useEffect(() => {
    TriageCapture.setLandscapeLock(true);
    return () => TriageCapture.setLandscapeLock(false);
  }, []);
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const onFinished = useCallback(
    (sittingId: string) => router.replace({ pathname: '/camera/summary', params: { sitting: sittingId } }),
    [router],
  );
  const sitting = useSittingController({ patientNumber, kind, enrolFace, deviceId, onFinished });
  // Called off from the check-in page: the same as Back here, without the question.
  useEffect(() => stationLink.onCommand((command) => (command.type === 'cancel' ? router.dismissTo('/camera') : undefined)), [router]);
  // The name is typed on the dashboard while this sitting runs, and the photo is taken from it.
  const patient = usePatientRef(patientNumber);
  const { phase, status, reading, source } = sitting;
  const running = phase === 'running' || phase === 'stopping';
  const sourceTag = sourceLabel(source);
  // Moves forward with each status event, so the age of a stale value keeps counting.
  const now = sitting.nowMs;
  const heart = readoutFor(running ? (reading?.heartRate ?? null) : null, source, sitting.lastValid.heartRate, now);
  const breathing = readoutFor(running ? (reading?.breathingRate ?? null) : null, source, sitting.lastValid.breathingRate, now);

  // The readings of this sitting, one a second, for the trace under each value. Kept during
  // render from the reading the controller already holds, so the two can never disagree.
  const [traces, setTraces] = useState<Traces>(NO_TRACES);
  if (!running && traces.last) {
    setTraces(NO_TRACES);
  } else if (running && reading && reading !== traces.last) {
    const valid = (estimate: Reading['heartRate']) => (estimate.state === 'valid' ? estimate.value : null);
    setTraces({
      last: reading,
      pulse: pushTrace(traces.pulse, valid(reading.heartRate), TRACE_SECONDS),
      breathing: pushTrace(traces.breathing, valid(reading.breathingRate), TRACE_SECONDS),
    });
  }

  const leave = () => {
    if (!running) return router.back();
    Alert.alert('Leave this sitting?', 'The sitting stops and no summary is saved for this patient', [
      { text: 'Keep measuring', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  };
  const endEarly = () =>
    Alert.alert(
      'End the sitting now?',
      'Breathing and beat-to-beat values need the full 60 seconds and may show No reading',
      [
        { text: 'Keep measuring', style: 'cancel' },
        { text: 'End sitting', onPress: () => void sitting.stop() },
      ],
    );

  if (phase === 'permission_denied' || phase === 'unavailable') {
    const denied = phase === 'permission_denied';
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: space.space4, backgroundColor: colors.surface0 }}>
        <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center' }}>
          <Notice
            title={denied ? 'Crowdpulse cannot use the camera' : 'The camera did not start'}
            body={
              denied
                ? 'Allow camera access for Crowdpulse in the Settings app, then come back and try again'
                : (sitting.error ?? 'Try again')
            }
          >
            {denied ? (
              <Button variant="primary" block label="Open the Settings app" onPress={() => void Linking.openSettings()} />
            ) : null}
            <Button variant={denied ? 'secondary' : 'primary'} block label="Try again" onPress={sitting.retry} />
            <Button variant="quiet" block label="Back to check-in" onPress={() => router.back()} />
          </Notice>
        </View>
      </SafeAreaView>
    );
  }

  // In landscape the column is 350 points tall: the lines close up so the patient, the countdown,
  // both readings and both traces are on screen for the whole sitting without a touch.
  const cell = landscape ? space.space3 : space.space4;
  const patientPanel = (
    <View style={{ gap: landscape ? space.space3 : space.space4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.space3 }}>
        <PatientIdentity patient={patient} size="md" />
        {sourceTag ? <ProvenanceTag kind="recording" label={sourceTag} /> : null}
      </View>
      <SittingTimer elapsed={sitting.elapsedSeconds} doneLabel="Sitting complete" />
      {/* The two readings share one instrument panel: two cells with a hairline between them. */}
      <View
        style={{
          flexDirection: 'row',
          borderWidth: hairline,
          borderColor: colors.line,
          borderRadius: theme.radius.radiusXl,
          backgroundColor: colors.surface1,
        }}
      >
        <View style={{ flex: 1, padding: cell, gap: space.space2 }}>
          <Readout
            label="Heart rate"
            icon="pulse"
            unit="bpm"
            dense={landscape}
            size="lg"
            live={running}
            state={heart.state}
            value={'value' in heart ? heart.value : undefined}
            foot={heart.foot}
          />
          <LiveTrace trace={traces.pulse} capacity={TRACE_SECONDS} minSpan={PULSE_SPAN_BPM} />
        </View>
        <View style={{ flex: 1, padding: cell, gap: space.space2, borderLeftWidth: hairline, borderLeftColor: colors.line }}>
          <Readout
            label="Breathing"
            icon="breath"
            unit="per min"
            unitSpoken="breaths per minute"
            dense={landscape}
            size="lg"
            live={running}
            state={breathing.state}
            value={'value' in breathing ? breathing.value : undefined}
            foot={breathing.foot}
          />
          <LiveTrace trace={traces.breathing} capacity={TRACE_SECONDS} minSpan={BREATHING_SPAN_PER_MIN} />
        </View>
      </View>
      {sitting.error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: colors.watch }]}>
          {tidy(sitting.error)}
        </Text>
      ) : null}
    </View>
  );

  // What the operator checks now and then, under the readings.
  const operatorPanel = (
    <View style={{ gap: space.space4 }}>
      <CaptureStatus
        fps={status?.fps ?? null}
        dropped={status?.droppedFrames ?? 0}
        exposureLocked={status?.exposureLocked ?? false}
        thermal={status?.thermalState ?? 'nominal'}
      />
      <Switch
        label="Live view on dashboard"
        hint={liveViewHint(sitting.live)}
        checked={sitting.live.enabled}
        onChange={(next) => void sitting.setLiveView(next)}
        disabled={phase === 'preparing'}
      />
    </View>
  );

  const mainAction = running ? (
    <Button
      variant="secondary"
      block
      label={phase === 'stopping' ? 'Saving the sitting' : 'End sitting now'}
      disabled={phase === 'stopping'}
      onPress={endEarly}
    />
  ) : (
    <Button
      variant="primary"
      block
      label={phase === 'starting' ? 'Starting' : phase === 'preparing' ? 'Starting the camera' : 'Start sitting'}
      disabled={phase !== 'framing'}
      onPress={() => void sitting.start()}
    />
  );
  const backAction = <Button variant="quiet" block label="Back to check-in" disabled={phase === 'stopping'} onPress={leave} />;

  const viewfinder = (
    <LiveViewfinder
      state={status?.viewfinder ?? 'searching'}
      message={phase === 'preparing' ? 'Starting the camera' : undefined}
      // The camera is chosen while framing. Changing it mid-sitting would restart the measurement.
      flipDisabled={phase !== 'framing'}
    />
  );

  return (
    // A phone on its side has no status bar, so the top inset is left out there: the column keeps
    // the full height for the readings.
    <SafeAreaView edges={landscape ? ['left', 'right', 'bottom'] : undefined} style={{ flex: 1, backgroundColor: colors.surface0 }}>
      {landscape ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: space.space4, paddingHorizontal: space.space4, paddingVertical: space.space3 }}>
          {/* The picture gets the room; the readouts and controls share one column beside it. */}
          <View style={{ flex: 1 }}>{viewfinder}</View>
          <View style={{ width: Math.min(360, Math.round(width * 0.42)), gap: space.space3 }}>
            {/* The readings open at the top and stay there; the checks scroll under them. */}
            <ScrollView indicatorStyle="white" style={{ flex: 1 }} contentContainerStyle={{ gap: space.space5 }}>
              {patientPanel}
              {operatorPanel}
            </ScrollView>
            {/* The two actions are always in reach, so starting a sitting never moves the column. */}
            <View style={{ flexDirection: 'row', gap: space.space2 }}>
              <View style={{ flex: 1 }}>{backAction}</View>
              <View style={{ flex: 1 }}>{mainAction}</View>
            </View>
          </View>
        </View>
      ) : (
        <ScrollView indicatorStyle="white" contentContainerStyle={{ padding: space.space4, gap: space.space6 }}>
          <View style={{ height: Math.round(width * 0.9) }}>{viewfinder}</View>
          {patientPanel}
          {operatorPanel}
          <View style={{ gap: space.space2 }}>
            {mainAction}
            {backAction}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function liveViewHint(live: LiveViewState): string {
  if (!live.enabled) return 'Off. Staff cannot see the camera and no profile photo is taken from it.';
  if (live.failing) return 'On, but the picture is not reaching the server';
  if (live.viewers == null) return 'On. Connecting to the dashboard.';
  if (live.viewers === 0) return 'On. No dashboard is watching.';
  return live.viewers === 1 ? 'On. 1 dashboard is watching.' : `On. ${live.viewers} dashboards are watching.`;
}
