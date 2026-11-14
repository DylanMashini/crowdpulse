import type { WorklistItem, WorklistResponse } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { PrivacyNote } from '@/components/PrivacyNote';
import { Screen } from '@/components/Screen';
import { useScopedTheme } from '@/components/ThemeScope';
import { WorklistCard } from '@/components/WorklistCard';
import { usePolling } from '@/hooks/usePolling';
import { useScreenFocused } from '@/hooks/useScreenFocused';
import { api, errorMessage } from '@/lib/api';
import { clockTime, sentences } from '@/lib/format';
import { useFlagFeed } from '@/lib/nurse/FlagFeed';
import { worklistSummary } from '@/lib/nurse/worklistFormat';

/** The contract's refresh rate for the nurse worklist while it is on screen. */
const REFRESH_MS = 5000;

export default function Worklist() {
  const theme = useScopedTheme();
  const { space } = theme;
  const router = useRouter();
  const focused = useScreenFocused();
  const { push, revision } = useFlagFeed();

  const [worklist, setWorklist] = useState<WorklistResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setWorklist(await api.worklist());
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, []);

  // A flag that arrived or was acknowledged changes ranks and badges, so it refetches at once.
  usePolling(load, REFRESH_MS, focused, revision);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const open = (item: WorklistItem) =>
    router.push({ pathname: '/nurse/ticket/[number]', params: { number: String(item.ticketNumber) } });

  const subtitle = worklist
    ? `${worklistSummary(worklist.items)}, updated ${clockTime(worklist.generatedAt)}`
    : 'In the order to walk to';

  return (
    <Screen
      title="Worklist"
      subtitle={subtitle}
      scroll={false}
      action={{ icon: 'sliders', label: 'Settings', onPress: () => router.push('/settings') }}
    >
      <FlatList
        data={worklist?.items ?? []}
        keyExtractor={(item) => String(item.ticketNumber)}
        renderItem={({ item }) => <WorklistCard item={item} onPress={() => open(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: space.space2 }} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.inkMuted} />
        }
        contentContainerStyle={{
          paddingHorizontal: space.space4,
          paddingBottom: space.space7,
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
        }}
        ListHeaderComponent={
          <View style={{ gap: space.space3, paddingBottom: space.space3 }}>
            {failure && worklist ? (
              <Notice
                title={`Not updated since ${clockTime(worklist.generatedAt)}`}
                body={sentences(failure, 'The list below may be out of date')}
              />
            ) : null}
            {push && !push.available ? (
              <PrivacyNote icon="bell">
                {sentences(push.reason, 'New flags appear here within 5 seconds while the app is open')}
              </PrivacyNote>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          worklist ? (
            <Notice
              title="No one is waiting"
              body="A ticket appears here as soon as it is created on the camera phone or the dashboard"
            />
          ) : failure ? (
            <Notice title="The worklist did not load" body={failure}>
              <Button variant="primary" block label="Try again" onPress={() => void load()} />
            </Notice>
          ) : (
            <Notice title="Loading the worklist" />
          )
        }
      />
    </Screen>
  );
}
