import type { Flag, TicketDetailResponse } from '@triagecam/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { HandoffNote } from '@/components/HandoffNote';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { StatusBadge } from '@/components/StatusBadge';
import { useScopedTheme } from '@/components/ThemeScope';
import { TicketNumber } from '@/components/TicketNumber';
import { TicketTimeline } from '@/components/TicketTimeline';
import { Touchable } from '@/components/Touchable';
import { usePolling } from '@/hooks/usePolling';
import { useScreenFocused } from '@/hooks/useScreenFocused';
import { api, errorMessage, isApiError } from '@/lib/api';
import { clockTime, sentences } from '@/lib/format';
import { useFlagFeed } from '@/lib/nurse/FlagFeed';
import { timelineRows } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';

const REFRESH_MS = 5000;

export default function TicketScreen() {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const router = useRouter();
  const focused = useScreenFocused();
  const { revision, markAcknowledged } = useFlagFeed();
  const params = useLocalSearchParams<{ number: string }>();
  const number = Number(params.number);
  const valid = Number.isSafeInteger(number) && number > 0;

  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [failure, setFailure] = useState<{ message: string; missing: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.ticket(number));
      setFailure(null);
    } catch (error) {
      setFailure({ message: errorMessage(error), missing: isApiError(error) && error.code === 'not_found' });
    }
  }, [number]);

  usePolling(load, REFRESH_MS, focused && valid && !failure?.missing, revision);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const acknowledge = async (flag: Flag) => {
    setAcknowledging(flag.id);
    setAcknowledgeError(null);
    try {
      markAcknowledged((await api.acknowledgeFlag(flag.id)).flag);
      await load();
    } catch (error) {
      setAcknowledgeError(errorMessage(error));
    } finally {
      setAcknowledging(null);
    }
  };

  const openFlags = detail?.flags.filter((flag) => flag.closedAt == null) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'left', 'right']}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.inkMuted} />
        }
        contentContainerStyle={{
          padding: space.space4,
          paddingBottom: space.space7,
          gap: space.space5,
          width: '100%',
          maxWidth: 560,
          alignSelf: 'center',
        }}
      >
        <View style={{ gap: space.space2 }}>
          <Touchable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to the worklist"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: space.space1,
              height: theme.size.controlTouch,
              paddingRight: space.space2,
              borderRadius: theme.radius.radiusMd,
              backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
            })}
          >
            <Icon name="chevron" size={20} color={colors.ink} flip />
            <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>Worklist</Text>
          </Touchable>
          {valid ? (
            <View accessibilityRole="header">
              <TicketNumber number={number} size="lg" />
            </View>
          ) : null}
          {detail?.state ? (
            <StatusBadge state={detail.state} minutes={minutesSince(detail)} />
          ) : detail?.ticket.status === 'discharged' ? (
            <Text style={[theme.type.caption, { color: colors.inkMuted }]}>
              Discharged{detail.ticket.dischargedAt ? ` at ${clockTime(detail.ticket.dischargedAt)}` : ''}
            </Text>
          ) : null}
        </View>

        {!valid ? (
          <Notice title="This is not a ticket number" body="Go back to the worklist and open a ticket from there" />
        ) : !detail && failure ? (
          <Notice
            title={failure.missing ? `There is no ticket ${number}` : 'The ticket did not load'}
            body={failure.missing ? 'It may belong to another station. Go back to the worklist.' : failure.message}
          >
            {failure.missing ? null : <Button variant="primary" block label="Try again" onPress={() => void load()} />}
          </Notice>
        ) : !detail ? (
          <Notice title={`Loading ticket ${number}`} />
        ) : (
          <>
            {failure ? <Notice title="Not updated" body={sentences(failure.message, 'The values below may be out of date')} /> : null}

            {openFlags.map((flag) => (
              <View
                key={flag.id}
                style={{
                  padding: space.space4 - 1,
                  gap: space.space3,
                  borderWidth: 2,
                  borderColor: flag.rule === 'overdue' ? colors.ink : colors.flag,
                  borderRadius: theme.radius.radiusXl,
                  backgroundColor: colors.surfaceRaised,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.space2 }}>
                  {flag.rule === 'overdue' ? (
                    <StatusBadge state="overdue" label="Overdue" />
                  ) : (
                    <StatusBadge state="flag" />
                  )}
                  <Text style={[theme.type.caption, { color: colors.inkMuted }]}>Opened {clockTime(flag.openedAt)}</Text>
                </View>
                <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>{flag.handoff}</Text>
                {flag.acknowledgedAt ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space2, minHeight: theme.size.controlTouch }}>
                    <Icon name="check" size={18} color={colors.inkMuted} />
                    <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.inkMuted }]}>
                      Acknowledged {clockTime(flag.acknowledgedAt)}
                    </Text>
                  </View>
                ) : (
                  <Button
                    variant="primary"
                    label={acknowledging === flag.id ? 'Acknowledging' : 'Acknowledge'}
                    disabled={acknowledging !== null}
                    onPress={() => void acknowledge(flag)}
                  />
                )}
              </View>
            ))}
            {acknowledgeError ? <Notice title="Not acknowledged" body={acknowledgeError} /> : null}

            <Section heading="Handoff">
              <HandoffNote sentence={detail.handoff} />
            </Section>

            <Section heading="Timeline">
              {detail.timeline.length > 0 ? (
                <TicketTimeline rows={timelineRows(detail.timeline)} />
              ) : (
                <Notice title="Nothing recorded yet" body="The first entry appears when the ticket's check-in sitting ends" />
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Whole minutes since the last sitting that gave a pulse or a breathing rate, or null. */
function minutesSince(detail: TicketDetailResponse): number | null {
  const observed = detail.sittings.filter(
    (sitting) => sitting.endedAt && (sitting.summary?.heartRate.value != null || sitting.summary?.breathingRate.value != null),
  );
  const last = observed[observed.length - 1]?.endedAt;
  if (!last) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 60_000));
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View style={{ gap: theme.space.space3 }}>
      <Text accessibilityRole="header" style={[theme.type.heading, { color: theme.colors.ink }]}>
        {heading}
      </Text>
      {children}
    </View>
  );
}
