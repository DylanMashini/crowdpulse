import { type Flag, type FlagAlert, flagAlerts } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { FlagCard } from '@/components/FlagCard';
import { Notice } from '@/components/Notice';
import { PrivacyNote } from '@/components/PrivacyNote';
import { Section, TabScreen } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { useLoadOn } from '@/hooks/useLoadOn';
import { api } from '@/lib/api';
import { sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { flagGroups } from '@/lib/nurse/nurseFormat';

/** How many closed flags the tab keeps in view under the open ones. */
const RECENTLY_CLOSED = 10;

/** Every open alert, the ones nobody has acknowledged first, then the last few flags that closed. */
export default function Flags() {
  const { space } = useScopedTheme();
  const router = useRouter();
  const { flags, failure, push, revision, refresh } = useNurse();
  const [closed, setClosed] = useState<Flag[]>([]);

  const loadClosed = useCallback(async () => {
    try {
      setClosed((await api.closedFlags(RECENTLY_CLOSED)).items);
    } catch {
      // The frame reports an unreachable server; the closed flags already shown stay.
    }
  }, []);

  // A flag closes when a sitting ends or a patient is discharged, which the server announces.
  useLoadOn(loadClosed, revision);

  const pull = async () => {
    await Promise.all([refresh(), loadClosed()]);
  };

  const open = (alert: FlagAlert) =>
    router.push({ pathname: '/nurse/patient/[number]', params: { number: String(alert.lead.patientNumber) } });

  const groups = flags ? flagGroups(flags) : null;
  const waiting = groups?.unacknowledged.length ?? 0;
  const subtitle = !groups
    ? 'Trend changes and overdue re-checks'
    : waiting > 0
      ? `${waiting} to acknowledge`
      : groups.acknowledged.length > 0
        ? 'All acknowledged'
        : 'None open';

  const list = (items: FlagAlert[]) => (
    <View style={{ gap: space.space3 }}>
      {items.map((alert) => (
        <FlagCard key={alert.id} alert={alert} onOpen={() => open(alert)} />
      ))}
    </View>
  );

  return (
    <TabScreen title="Flags" subtitle={subtitle} onRefresh={pull}>
      {push && !push.available ? (
        <PrivacyNote icon="bell">
          {sentences(push.reason, 'New flags still appear here and as a banner while the app is open')}
        </PrivacyNote>
      ) : null}

      {!groups ? (
        failure ? null : <Notice title="Loading the flags" />
      ) : (
        <>
          {waiting === 0 && groups.acknowledged.length === 0 ? (
            <Notice
              title="No open flags"
              body="A flag opens when a patient's pulse or breathing moves away from their check-in values on two sittings in a row, or when a re-check is overdue"
            />
          ) : null}
          {waiting > 0 ? (
            <Section heading="To acknowledge" count={waiting}>
              {list(groups.unacknowledged)}
            </Section>
          ) : null}
          {groups.acknowledged.length > 0 ? (
            <Section heading="Acknowledged, still open" count={groups.acknowledged.length}>
              {list(groups.acknowledged)}
            </Section>
          ) : null}
        </>
      )}

      {closed.length > 0 ? <Section heading="Recently closed">{list(flagAlerts(closed))}</Section> : null}
    </TabScreen>
  );
}
