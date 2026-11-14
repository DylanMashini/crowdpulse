import { type Flag, type PatientDetailResponse, patientLabel } from '@triagecam/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FlagCard } from '@/components/FlagCard';
import { HandoffNote } from '@/components/HandoffNote';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { PatientAvatar } from '@/components/PatientIdentity';
import { PatientTimeline } from '@/components/PatientTimeline';
import { ProvenanceTag } from '@/components/ProvenanceTag';
import { ScoreChip } from '@/components/ScoreChip';
import { StatusBadge } from '@/components/StatusBadge';
import { Section } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { Touchable } from '@/components/Touchable';
import { VitalHistory } from '@/components/VitalHistory';
import { useLoadOn } from '@/hooks/useLoadOn';
import { useScreenFocused } from '@/hooks/useScreenFocused';
import { api, errorMessage, isApiError } from '@/lib/api';
import { sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { dayTime, demographics, intakeRows, minutesSince, sittingRows, vitalSeries } from '@/lib/nurse/nurseFormat';
import { timelineRows } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';
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
  const openFlags = detail?.flags.filter((flag) => flag.closedAt == null) ?? [];
  const closedFlags = detail?.flags.filter((flag) => flag.closedAt != null) ?? [];
  const intake = patient ? intakeRows(patient, now) : [];
  const sittings = detail ? sittingRows(detail.sittings, now) : [];
  const second = patient
    ? [`No. ${patient.number}`, demographics(patient, now)].filter(Boolean).join(' · ')
    : valid
      ? `No. ${number}`
      : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'left', 'right']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.inkMuted} />}
        contentContainerStyle={{
          padding: space.space4,
          paddingBottom: space.space7,
          gap: space.space5,
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
        }}
      >
        <View style={{ gap: space.space3 }}>
          <Touchable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: space.space1,
              minHeight: theme.size.controlTouch,
              paddingRight: space.space2,
              borderRadius: theme.radius.radiusMd,
              backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
            })}
          >
            <Icon name="chevron" size={20} color={colors.ink} flip />
            <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>Back</Text>
          </Touchable>

          {valid ? (
            <View style={stacked ? { gap: space.space3 } : { flexDirection: 'row', alignItems: 'center', gap: space.space4 }}>
              <PatientAvatar patient={patient ?? { number, name: null, photoUpdatedAt: null }} size="xl" />
              <View style={stacked ? { gap: space.space1 } : { flex: 1, gap: space.space1 }}>
                <Text
                  accessibilityRole="header"
                  style={[theme.type.title, { color: patient?.name?.trim() ? colors.ink : colors.inkMuted }]}
                >
                  {patientLabel(patient ?? { number, name: null })}
                </Text>
                <Text style={[theme.type.bodyTouch, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
                  {patient && !patient.name?.trim() ? `${second} · Name not entered yet` : second}
                </Text>
              </View>
            </View>
          ) : null}

          {detail?.state ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
              <StatusBadge state={detail.state} minutes={item?.minutesSinceObserved ?? lastObservedMinutes(detail, now)} />
              {item?.sittingInProgress ? <ProvenanceTag kind="live" label="Sitting in progress" /> : null}
              {item?.score != null ? <ScoreChip score={item.score} measured={item.parametersMeasured} /> : null}
            </View>
          ) : patient?.status === 'discharged' ? (
            <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.inkMuted }]}>
              Discharged{patient.dischargedAt ? ` ${dayTime(patient.dischargedAt, now)}` : ''}
            </Text>
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

            {openFlags.length > 0 ? (
              <View style={{ gap: space.space3 }}>
                {openFlags.map((flag: Flag) => (
                  <FlagCard key={flag.id} flag={flag} hidePatient />
                ))}
              </View>
            ) : null}

            <Section heading="Handoff">
              <HandoffNote sentence={detail.handoff} />
            </Section>

            <Section heading="Vitals">
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space5, rowGap: space.space4 }}>
                  <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140 }}>
                    <VitalHistory label="Pulse" icon="pulse" unit="bpm" points={vitalSeries(detail.sittings, 'heartRate')} />
                  </View>
                  <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 140 }}>
                    <VitalHistory
                      label="Breathing"
                      icon="breath"
                      unit="breaths per min"
                      points={vitalSeries(detail.sittings, 'breathingRate')}
                    />
                  </View>
                </View>
                <Text style={[theme.type.caption, { color: colors.inkMuted }]}>
                  {detail.sittings.filter((sitting) => sitting.summary?.heartRate.value != null).length > 1
                    ? 'Camera estimates, one per sitting. The dashed line is the check-in value.'
                    : 'Camera estimates, one per sitting'}
                </Text>
              </Card>
            </Section>

            <Section heading="Intake">
              {intake.length > 0 ? (
                <Card>
                  {intake.map((row) => (
                    <View key={row.label} style={{ gap: 2 }}>
                      <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{row.label}</Text>
                      <Text selectable style={[theme.type.bodyTouch, { color: colors.ink }]}>
                        {row.value}
                      </Text>
                    </View>
                  ))}
                  <Text style={[theme.type.caption, { color: colors.inkMuted }]}>
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
                <Card>
                  {sittings.map((row, index) => (
                    <View
                      key={row.key}
                      style={{
                        gap: space.space1,
                        paddingTop: index === 0 ? 0 : space.space4,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: colors.line,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2 }}>
                        <Text style={[theme.type.subheading, { color: colors.ink }]}>{row.title}</Text>
                        <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{row.time}</Text>
                        {row.running ? <ProvenanceTag kind="live" label="Running" /> : null}
                        {row.sourceLabel ? <ProvenanceTag kind="recording" label={row.sourceLabel} /> : null}
                      </View>
                      {row.running ? null : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space5, rowGap: space.space1 }}>
                          <Reading name="Pulse" value={row.pulse} unit="bpm" />
                          <Reading name="Breathing" value={row.breathing} unit="per min" />
                        </View>
                      )}
                      {row.detail ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{row.detail}</Text> : null}
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
                  {closedFlags.map((flag) => (
                    <FlagCard key={flag.id} flag={flag} hidePatient />
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

function Card({ children }: { children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View
      style={{
        padding: theme.space.space4,
        gap: theme.space.space4,
        borderWidth: 1,
        borderColor: theme.colors.line,
        borderRadius: theme.radius.radiusXl,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      {children}
    </View>
  );
}

function Reading({ name, value, unit }: { name: string; value: string | null; unit: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <Text style={[theme.type.caption, { lineHeight: 28, color: colors.inkMuted }]}>
      {`${name} `}
      <Text style={[value ? theme.type.readoutMd : theme.type.caption, { color: colors.ink }]}>{value ?? 'No reading'}</Text>
      {value ? ` ${unit}` : ''}
    </Text>
  );
}
