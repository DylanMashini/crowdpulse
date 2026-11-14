import type { WorklistItem } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Notice } from '@/components/Notice';
import { TabScreen } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { WorklistCard } from '@/components/WorklistCard';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { worklistSummary } from '@/lib/nurse/worklistFormat';

/** Who to walk to next: every waiting patient in the server's rank order. */
export default function Worklist() {
  const { space } = useScopedTheme();
  const router = useRouter();
  const { worklist, failure } = useNurse();

  const open = (item: WorklistItem) =>
    router.push({ pathname: '/nurse/patient/[number]', params: { number: String(item.patientNumber) } });

  return (
    <TabScreen title="Worklist" subtitle={worklist ? worklistSummary(worklist.items) : 'In the order to walk to'}>
      {!worklist ? (
        // The frame already says so when the server cannot be reached.
        failure ? null : <Notice title="Loading the worklist" />
      ) : worklist.items.length === 0 ? (
        <Notice
          title="No one is waiting"
          body="A patient appears here as soon as check-in starts on the camera phone or the dashboard"
        />
      ) : (
        <View style={{ gap: space.space3 }}>
          {worklist.items.map((item) => (
            <WorklistCard key={item.patientNumber} item={item} onPress={() => open(item)} />
          ))}
        </View>
      )}
    </TabScreen>
  );
}
