import { type PatientDetailResponse, flagAlerts, patientLabel } from '@triagecam/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Detail } from '@/components/Detail';
import { FlagCard } from '@/components/FlagCard';
import { HandoffNote } from '@/components/HandoffNote';
import { Notice } from '@/components/Notice';
import { PatientAvatar } from '@/components/PatientIdentity';
import { PatientTimeline } from '@/components/PatientTimeline';
import { ProvenanceTag } from '@/components/ProvenanceTag';
import { ScoreChip } from '@/components/ScoreChip';
import { HeaderButton } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { Section } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { VitalHistory } from '@/components/VitalHistory';
import { useLoadOn } from '@/hooks/useLoadOn';
import { useScreenFocused } from '@/hooks/useScreenFocused';
import { api, errorMessage, isApiError } from '@/lib/api';
import { sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { dayTime, demographics, intakeRows, minutesSince, sittingRows, vitalSeries } from '@/lib/nurse/nurseFormat';
import { patientSeverity } from '@/lib/nurse/severity';
import { statusText, timelineRows } from '@/lib/nurse/worklistFormat';
import { hairline, weight } from '@/theme';
import { Text } from '@/components/Text';

/** A net under the server's change events, for a stream that is down. */
const REFRESH_MS = 15_000;

/** One patient in full: who they are, what the camera has read, the flags, and discharge. */
export default function PatientScreen() {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const focused = useScreenFocused();
  // At the larger accessibility sizes the name goes under the photo instead of beside it.
  const stacked = useWindowDimensions().fontScale > 1.4;
  const { revision, worklist, now, refresh } = useNurse();
  const params = useLocalSearchParams<{ number: string }>();
  const number = Number(params.number);
  const valid = Number.isSafeInteger(number) && number > 0;

  const [detail, setDetail] = useState<PatientDetailResponse | null>(null);
  const [failure, setFailure] = useState<{ message: string; missing: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [dischargeError, setDischargeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!valid) return;
    try {
      setDetail(await api.patient(number));
      setFailure(null);
    } catch (error) {
      setFailure({ message: errorMessage(error), missing: isApiError(error) && error.code === 'not_found' });
    }
  }, [number, valid]);

  // The server announces every change to a patient; the timer covers a stream that is down.
  useLoadOn(load, revision, { enabled: focused && valid && !failure?.missing, everyMs: REFRESH_MS });

  const pull = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const discharge = async () => {
    setDischarging(true);
    setDischargeError(null);
    try {
      await api.dischargePatient(number);
      await Promise.all([load(), refresh()]);
    } catch (error) {
      setDischargeError(errorMessage(error));
    } finally {
      setDischarging(false);
    }
  };

  const confirmDischarge = () => {
    if (!detail) return;
    Alert.alert(
      `Discharge ${patientLabel(detail.patient)}?`,
      'They leave the worklist and their open flags close. The record, the photo and every sitting are kept. Face match data is deleted.',
      [
        { text: 'Keep waiting', style: 'cancel' },
        { text: 'Discharge', style: 'destructive', onPress: () => void discharge() },
      ],
    );
  };

  const patient = detail?.patient ?? null;
  const item = worklist?.items.find((entry) => entry.patientNumber === number) ?? null;
  // Alerts, not single flags: the two trend flags of one deterioration are one card, acknowledged once.
  const openFlags = flagAlerts(detail?.flags.filter((flag) => flag.closedAt == null) ?? []);
  const closedFlags = flagAlerts(detail?.flags.filter((flag) => flag.closedAt != null) ?? []);
  const intake = patient ? intakeRows(patient, now) : [];
  const sittings = detail ? sittingRows(detail.sittings, now) : [];
  // Drawn from the state and the open flags the server sent for this patient.
  const severity = detail?.state
    ? patientSeverity({ state: detail.state, score: item?.score ?? null, flags: detail.flags })
    : 'stable';
  const vitalSeverity = severity === 'urgent' || severity === 'watch' ? severity : undefined;
  const second = patient
    ? [`No. ${patient.number}`, demographics(patient, now)].filter(Boolean).join(', ')
    : valid
      ? `No. ${number}`
      : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface0 }} edges={['top', 'left', 'right']}>
      <ScrollView
        indicatorStyle="white"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.inkMuted} />}
        contentContainerStyle={{
          paddingHorizontal: space.space4,
          paddingBottom: space.space12,
          gap: space.space6,
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
        }}
      >
        <View style={{ gap: space.space3 }}>
          <View style={{ flexDirection: 'row' }}>
            <HeaderButton icon="chevron" flip label="Back" onPress={() => router.back()} />
          </View>

          {valid ? (
            <View style={stacked ? { gap: space.space3 } : { flexDirection: 'row', alignItems: 'center', gap: space.space3 }}>
              <PatientAvatar patient={patient ?? { number, name: null, photoUpdatedAt: null }} size="lg" />
              <View style={stacked ? undefined : { flex: 1 }}>
                <Text
                  accessibilityRole="header"
                  style={[theme.type.heading, { fontWeight: weight.semibold, color: patient?.name?.trim() ? colors.ink : colors.inkMuted }]}
                >
                  {patientLabel(patient ?? { number, name: null })}
                </Text>
                <Text style={[theme.type.dense, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
                  {patient && !patient.name?.trim() ? `${second}, name not entered yet` : second}
                </Text>
              </View>
            </View>
          ) : null}

          {detail?.state ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
              <StatusBadge
                severity={severity}
                label={statusText(detail.state, item?.minutesSinceObserved ?? lastObservedMinutes(detail, now))}
              />
              {item?.sittingInProgress ? <ProvenanceTag kind="live" label="Sitting in progress" /> : null}
              {item?.score != null ? <ScoreChip score={item.score} measured={item.parametersMeasured} /> : null}
            </View>
          ) : patient?.status === 'discharged' ? (
            <StatusBadge severity="stable" label={`Discharged${patient.dischargedAt ? ` ${dayTime(patient.dischargedAt, now)}` : ''}`} />
          ) : null}
        </View>

        {!valid ? (
          <Notice title="This is not a patient number" body="Go back and open a patient from a list" />
        ) : !detail && failure ? (
          <Notice
            title={failure.missing ? `There is no patient ${number}` : 'The patient did not load'}
            body={failure.missing ? 'It may belong to another station. Go back and open a patient from a list.' : failure.message}
          >
            {failure.missing ? null : <Button variant="primary" block label="Try again" onPress={() => void load()} />}
          </Notice>
        ) : !detail || !patient ? (
          <Notice title="Loading the patient" />
        ) : (
          <>
            {failure ? <Notice title="Not updated" body={sentences(failure.message, 'What is shown may be out of date')} /> : null}

            {/* The handoff as it stands now, once. The open flags under it say why and take the acknowledgement. */}
            <Section heading="Handoff">
              <HandoffNote sentence={detail.handoff} severity={severity} />
            </Section>

            {openFlags.length > 0 ? (
              <Section heading="Open flags" count={openFlags.length}>
                <View style={{ gap: space.space3 }}>
                  {openFlags.map((alert) => (
                    <FlagCard key={alert.id} alert={alert} hidePatient sentence="hide" />
                  ))}
                </View>
              </Section>
            ) : null}

            <Section heading="Vitals">
              {/* One instrument panel: two cells with a hairline between them, side by side until the text is too large. */}
              <Card flush style={{ flexDirection: stacked ? 'column' : 'row' }}>
                <View style={{ flex: stacked ? undefined : 1, padding: space.space4 }}>
                  <VitalHistory label="Pulse" icon="pulse" unit="bpm" points={vitalSeries(detail.sittings, 'heartRate')} severity={vitalSeverity} />
                </View>
                <View
                  style={[
                    { flex: stacked ? undefined : 1, padding: space.space4, borderColor: colors.line },
                    stacked ? { borderTopWidth: hairline } : { borderLeftWidth: hairline },
                  ]}
                >
                  <VitalHistory
                    label="Breathing"
                    icon="breath"
                    unit="per min"
                    points={vitalSeries(detail.sittings, 'breathingRate')}
                    severity={vitalSeverity}
                  />
                </View>
              </Card>
              <Text style={[theme.type.caption, { color: colors.inkFaint }]}>
                {detail.sittings.filter((sitting) => sitting.summary?.heartRate.value != null).length > 1
                  ? 'Camera estimates, one per sitting. The dashed line is the check-in value.'
                  : 'Camera estimates, one per sitting'}
              </Text>
            </Section>

            <Section heading="Intake">
              {intake.length > 0 ? (
                <Card>
                  {intake.map((row) => (
                    <Detail key={row.label} label={row.label} value={row.value} />
                  ))}
                  <Text style={[theme.type.caption, { color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>
                    Arrived {dayTime(patient.createdAt, now)}
                    {patient.intakeCompletedAt ? `, intake completed ${dayTime(patient.intakeCompletedAt, now)}` : ', intake not marked complete'}
                  </Text>
                </Card>
              ) : (
                <Notice
                  title="Nothing entered yet"
                  body={`Arrived ${dayTime(patient.createdAt, now)}. Intake is typed on the dashboard's check-in page.`}
                />
              )}
            </Section>

            <Section heading="Sittings" count={sittings.length}>
              {sittings.length > 0 ? (
                <Card flush>
                  {sittings.map((row, index) => (
                    <View
                      key={row.key}
                      style={{
                        gap: space.space1,
                        padding: space.space4,
                        borderTopWidth: index === 0 ? 0 : hairline,
                        borderTopColor: colors.line,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space2, rowGap: space.space1 }}>
                        <Text style={[theme.type.bodyStrong, { color: colors.ink }]}>{row.title}</Text>
                        <Text style={[theme.type.caption, { color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>{row.time}</Text>
                        {row.running ? <ProvenanceTag kind="live" label="Running" /> : null}
                        {row.sourceLabel ? <ProvenanceTag kind="recording" label={row.sourceLabel} /> : null}
                      </View>
                      {row.running ? null : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space4, rowGap: space.space1 }}>
                          <Reading name="Pulse" value={row.pulse} unit="bpm" />
                          <Reading name="Breathing" value={row.breathing} unit="breaths per min" />
                        </View>
                      )}
                      {row.detail ? <Text style={[theme.type.caption, { color: colors.inkFaint }]}>{row.detail}</Text> : null}
                    </View>
                  ))}
                </Card>
              ) : (
                <Notice title="No sitting yet" body="The first one appears when the patient sits down at the camera phone" />
              )}
            </Section>

            <Section heading="Timeline">
              {detail.timeline.length > 0 ? (
                <PatientTimeline rows={timelineRows(detail.timeline)} />
              ) : (
                <Notice title="Nothing recorded yet" body="The first entry appears when the patient's check-in sitting ends" />
              )}
            </Section>

            {closedFlags.length > 0 ? (
              <Section heading="Earlier flags" count={closedFlags.length}>
                <View style={{ gap: space.space3 }}>
                  {closedFlags.map((alert) => (
                    <FlagCard key={alert.id} alert={alert} hidePatient sentence="whenFlagged" />
                  ))}
                </View>
              </Section>
            ) : null}

            {patient.status === 'waiting' ? (
              <View style={{ gap: space.space2 }}>
                {dischargeError ? <Notice title="Not discharged" body={dischargeError} /> : null}
                <Button
                  variant="secondary"
                  block
                  label={discharging ? 'Discharging' : 'Discharge patient'}
                  disabled={discharging}
                  accessibilityHint="Asks you to confirm"
                  onPress={confirmDischarge}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Whole minutes since the last sitting that gave a pulse or a breathing rate, or null. */
function lastObservedMinutes(detail: PatientDetailResponse, now: number): number | null {
  const observed = detail.sittings.filter(
    (sitting) => sitting.endedAt && (sitting.summary?.heartRate.value != null || sitting.summary?.breathingRate.value != null),
  );
  return minutesSince(observed[observed.length - 1]?.endedAt, now);
}

function Reading({ name, value, unit }: { name: string; value: string | null; unit: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <Text style={[theme.type.caption, { lineHeight: theme.type.readoutSm.lineHeight, color: colors.inkMuted }]}>
      {`${name} `}
      <Text style={value ? [theme.type.readoutSm, { color: colors.ink }] : undefined}>{value ?? 'No reading'}</Text>
      {value ? ` ${unit}` : ''}
    </Text>
  );
}
