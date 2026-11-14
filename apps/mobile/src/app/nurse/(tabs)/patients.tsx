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
import { type PatientFilter, dayTime, filterPatients } from '@/lib/nurse/nurseFormat';
import { statusText } from '@/lib/nurse/worklistFormat';
import { Text } from '@/components/Text';

type Loaded = { items: Patient[]; nextCursor: string | null };

/** Everyone who has checked in, waiting or discharged, found by name, reason or visit number. */
export default function Patients() {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const { worklist, revision, now, refresh, failure: unreachable } = useNurse();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [filter, setFilter] = useState<PatientFilter>('waiting');
  const [query, setQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  // Pages beyond the first are kept when the first is refreshed, so the list does not shrink.
  const pages = useRef(1);

  const load = useCallback(async () => {
    try {
      let items: Patient[] = [];
      let cursor: string | undefined;
      let next: string | null = null;
      for (let page = 0; page < pages.current; page += 1) {
        const answer = await api.patients('all', cursor);
        items = items.concat(answer.items);
        next = answer.nextCursor;
        if (!next) break;
        cursor = next;
      }
      setLoaded({ items, nextCursor: next });
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, []);

  // A patient created, renamed, photographed or discharged anywhere is announced by the server.
  useLoadOn(load, revision);

  const pull = async () => {
    await Promise.all([load(), refresh()]);
  };

  const more = async () => {
    setLoadingMore(true);
    pages.current += 1;
    await load();
    setLoadingMore(false);
  };

  const all = loaded?.items ?? [];
  const shown = filterPatients(all, filter, query);
  const count = (status: PatientFilter) => filterPatients(all, status, '').length;
  const stateOf = new Map(worklist?.items.map((item) => [item.patientNumber, item]));

  const status = (patient: Patient): string => {
    if (patient.status === 'discharged') {
      return patient.dischargedAt ? `Discharged ${dayTime(patient.dischargedAt, now)}` : 'Discharged';
    }
    const item = stateOf.get(patient.number);
    return item ? statusText(item.state, item.minutesSinceObserved) : `Arrived ${dayTime(patient.createdAt, now)}`;
  };

  return (
    <TabScreen
      title="Patients"
      subtitle={loaded ? `${count('waiting')} waiting, ${count('discharged')} discharged` : 'Waiting and discharged'}
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
              ? filter === 'all'
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
