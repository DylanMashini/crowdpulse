import { type Patient, patientLabel } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { PatientIdentity } from '@/components/PatientIdentity';
import { SearchField } from '@/components/SearchField';
import { Segmented } from '@/components/Segmented';
import { TabScreen } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { Touchable } from '@/components/Touchable';
import { useLoadOn } from '@/hooks/useLoadOn';
import { api, errorMessage } from '@/lib/api';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { type PatientFilter, dayTime, filterPatients, patientCountsText } from '@/lib/nurse/nurseFormat';
import { statusText } from '@/lib/nurse/worklistFormat';
import { Text } from '@/components/Text';

/** What has been loaded of one status. `nextCursor` is null once it is all of them. */
type Loaded = { items: Patient[]; nextCursor: string | null };
type Lists = Partial<Record<PatientFilter, Loaded>>;

/** Everyone who has checked in, waiting or discharged, found by name, reason or visit number. */
export default function Patients() {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const { worklist, revision, now, refresh, failure: unreachable } = useNurse();

  // One list per status, each asked of the server by that status, so Waiting holds every
  // waiting patient however many have been discharged since.
  const [lists, setLists] = useState<Lists>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [filter, setFilter] = useState<PatientFilter>('waiting');
  const [query, setQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  // Pages beyond the first are kept when the first is refreshed, so the list does not shrink.
  const pages = useRef<Record<PatientFilter, number>>({ waiting: 1, discharged: 1, all: 1 });

  const load = useCallback(async () => {
    try {
      let items: Patient[] = [];
      let cursor: string | undefined;
      let next: string | null = null;
      for (let page = 0; page < pages.current[filter]; page += 1) {
        const answer = await api.patients(filter, cursor);
        items = items.concat(answer.items);
        next = answer.nextCursor;
        if (!next) break;
        cursor = next;
      }
      setLists((current) => ({ ...current, [filter]: { items, nextCursor: next } }));
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, [filter]);

  // A patient created, renamed, photographed or discharged anywhere is announced by the server.
  useLoadOn(load, `${filter}:${revision}`);

  const pull = async () => {
    await Promise.all([load(), refresh()]);
  };

  const more = async () => {
    setLoadingMore(true);
    pages.current[filter] += 1;
    await load();
    setLoadingMore(false);
  };

  const loaded = lists[filter] ?? null;
  const shown = filterPatients(loaded?.items ?? [], filter, query);
  // A count is printed only when it is known in full: from the worklist, which is everyone
  // waiting, or from a list with no further page.
  const whole = (status: 'waiting' | 'discharged'): number | null => {
    const own = lists[status];
    if (own && !own.nextCursor) return own.items.length;
    const all = lists.all;
    return all && !all.nextCursor ? all.items.filter((patient) => patient.status === status).length : null;
  };
  const counts = patientCountsText(worklist ? worklist.items.length : whole('waiting'), whole('discharged'));
  const stateOf = new Map(worklist?.items.map((item) => [item.patientNumber, item]));

  const status = (patient: Patient): string => {
    if (patient.status === 'discharged') {
      return patient.dischargedAt ? `Discharged ${dayTime(patient.dischargedAt, now)}` : 'Discharged';
    }
    const item = stateOf.get(patient.number);
    return item ? statusText(item.state, item.minutesSinceObserved, item.pulse.lowConfidence != null) : `Arrived ${dayTime(patient.createdAt, now)}`;
  };

  return (
    <TabScreen
      title="Patients"
      subtitle={counts ?? 'Waiting and discharged'}
      onRefresh={pull}
    >
      <SearchField label="Name, reason or visit number" value={query} onChange={setQuery} />
      <Segmented
        label="Which patients to list"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'waiting', label: 'Waiting' },
          { value: 'discharged', label: 'Discharged' },
          { value: 'all', label: 'All' },
        ]}
      />

      {!loaded ? (
        // The frame already says so, with the one Try again, when the server cannot be reached.
        unreachable ? null : failure ? (
          <Notice title="The patients did not load" body={failure}>
            <Button variant="primary" block label="Try again" onPress={() => void load()} />
          </Notice>
        ) : (
          <Notice title="Loading the patients" />
        )
      ) : shown.length === 0 ? (
        <Notice
          title={query.trim() ? `No patient matches "${query.trim()}"` : filter === 'discharged' ? 'No one has been discharged' : 'No patients yet'}
          body={
            query.trim()
              ? loaded.nextCursor
                ? `The newest ${loaded.items.length} were searched. Load earlier patients to look further back.`
                : filter === 'all'
                ? 'Check the spelling, or search by visit number'
                : 'Check the spelling, or look under All'
              : filter === 'discharged'
                ? 'A patient moves here when they are discharged from their own screen'
                : 'A patient appears here as soon as check-in starts on the camera phone or the dashboard'
          }
        />
      ) : (
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: theme.radius.radiusXl, overflow: 'hidden' }}>
          {shown.map((patient, index) => (
            <Touchable
              key={patient.number}
              accessibilityRole="button"
              accessibilityLabel={`${patientLabel(patient)}, ${status(patient)}`}
              accessibilityHint="Opens the patient"
              onPress={() => router.push({ pathname: '/nurse/patient/[number]', params: { number: String(patient.number) } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.space3,
                minHeight: 72,
                paddingVertical: space.space3,
                paddingLeft: space.space4,
                paddingRight: space.space3,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.line,
                backgroundColor: pressed ? colors.surfaceSunken : colors.surfaceRaised,
              })}
            >
              <View style={{ flex: 1, gap: space.space1 }}>
                <PatientIdentity patient={patient} size="md" detail={patient.reasonForVisit} />
                <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
                  {status(patient)}
                </Text>
              </View>
              <Icon name="chevron" size={20} color={colors.inkMuted} />
            </Touchable>
          ))}
        </View>
      )}

      {loaded && failure && !unreachable ? <Notice title="The list was not updated" body={failure} /> : null}
      {loaded?.nextCursor ? (
        <Button
          variant="secondary"
          block
          label={loadingMore ? 'Loading earlier patients' : 'Load earlier patients'}
          disabled={loadingMore}
          onPress={() => void more()}
        />
      ) : null}
    </TabScreen>
  );
}
