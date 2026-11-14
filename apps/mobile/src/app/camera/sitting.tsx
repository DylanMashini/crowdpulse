import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Alert, Linking, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TriageCapture from 'triage-capture';

import { Button } from '@/components/Button';
import { CaptureStatus } from '@/components/CaptureStatus';
import { LiveViewfinder } from '@/components/LiveViewfinder';
import { Notice } from '@/components/Notice';
import { ProvenanceTag } from '@/components/ProvenanceTag';
import { Readout } from '@/components/Readout';
import { SittingTimer } from '@/components/SittingTimer';
import { Switch } from '@/components/Switch';
import { useScopedTheme } from '@/components/ThemeScope';
import { TicketNumber } from '@/components/TicketNumber';
import { readoutFor } from '@/lib/capture/readingFormat';
import { type LiveViewState, useSittingController } from '@/lib/capture/useSittingController';
import { tidy } from '@/lib/format';
import { sourceLabel } from '@/lib/nurse/worklistFormat';
import { useDevice } from '@/lib/session/SessionProvider';

export default function Sitting() {
  const params = useLocalSearchParams<{ ticket: string; kind: string; enrol?: string }>();
  const device = useDevice();
  const ticketNumber = Number(params.ticket);
  if (!device || !Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return null;
  return (
    <SittingScreen
      ticketNumber={ticketNumber}
      kind={params.kind === 'recheck' ? 'recheck' : 'check_in'}
      enrolFace={params.enrol === '1'}
      deviceId={device.id}
    />
  );
}

type Props = { ticketNumber: number; kind: 'check_in' | 'recheck'; enrolFace: boolean; deviceId: string };

function SittingScreen({ ticketNumber, kind, enrolFace, deviceId }: Props) {
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
  const sitting = useSittingController({ ticketNumber, kind, enrolFace, deviceId, onFinished });
  const { phase, status, reading, source } = sitting;
  const running = phase === 'running' || phase === 'stopping';
  const sourceTag = sourceLabel(source);
  // Moves forward with each status event, so the age of a stale value keeps counting.
  const now = sitting.nowMs;
  const heart = readoutFor(running ? (reading?.heartRate ?? null) : null, source, sitting.lastValid.heartRate, now);
  const breathing = readoutFor(running ? (reading?.breathingRate ?? null) : null, source, sitting.lastValid.breathingRate, now);

  const leave = () => {
    if (!running) return router.back();
    Alert.alert('Leave this sitting?', 'The sitting stops and no summary is saved for this ticket', [
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
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: space.space4, backgroundColor: colors.surface }}>
        <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center' }}>
          <Notice
            title={denied ? 'Triage Cam cannot use the camera' : 'The camera did not start'}
            body={
              denied
                ? 'Allow camera access for Triage Cam in the Settings app, then come back and try again'
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

  const patientPanel = (
    <View style={{ gap: space.space4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.space3 }}>
        <TicketNumber number={ticketNumber} size="md" />
        {sourceTag ? <ProvenanceTag kind="recording" label={sourceTag} /> : null}
      </View>
      <SittingTimer elapsed={sitting.elapsedSeconds} doneLabel="Sitting complete" />
      <View style={{ flexDirection: 'row', gap: space.space4 }}>
        <View style={{ flex: 1 }}>
          <Readout
            label="Heart rate"
            icon="pulse"
            unit="bpm"
            size="lg"
            state={heart.state}
            value={'value' in heart ? heart.value : undefined}
            foot={heart.foot}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Readout
            label="Breathing"
            icon="breath"
            unit="breaths per min"
            size="lg"
            state={breathing.state}
            value={'value' in breathing ? breathing.value : undefined}
            foot={breathing.foot}
          />
        </View>
      </View>
      {sitting.error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: colors.flag }]}>
          {tidy(sitting.error)}
        </Text>
      ) : null}
    </View>
  );

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
      <View style={{ gap: space.space2 }}>
        {running ? (
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
        )}
        <Button variant="quiet" block label="Back to check-in" disabled={phase === 'stopping'} onPress={leave} />
      </View>
    </View>
  );

  const viewfinder = (
    <LiveViewfinder
      state={status?.viewfinder ?? 'searching'}
      message={phase === 'preparing' ? 'Starting the camera' : undefined}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      {landscape ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: space.space4, padding: space.space4 }}>
          <View style={{ flex: 4 }}>{viewfinder}</View>
          <View style={{ flex: 5, justifyContent: 'center' }}>{patientPanel}</View>
          {/* The column's share is set on a plain View: a ScrollView given flex: 4 is laid out as flex: 1. */}
          <View style={{ flex: 4 }}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>{operatorPanel}</ScrollView>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.space4, gap: space.space5 }}>
          <View style={{ height: Math.round(width * 0.9) }}>{viewfinder}</View>
          {patientPanel}
          {operatorPanel}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function liveViewHint(live: LiveViewState): string {
  if (!live.enabled) return 'Shows a low-rate picture to staff on the dashboard. Not stored.';
  if (live.failing) return 'On, but the picture is not reaching the server';
  if (live.viewers == null) return 'On. Connecting to the dashboard.';
  if (live.viewers === 0) return 'On. No dashboard is watching.';
  return live.viewers === 1 ? 'On. 1 dashboard is watching.' : `On. ${live.viewers} dashboards are watching.`;
}
