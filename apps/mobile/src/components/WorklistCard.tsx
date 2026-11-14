import type { WorklistItem } from '@triagecam/contracts';
import { Text, View } from 'react-native';

import { lastObservedText, sourceLabel, statusText } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';

import { Icon } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { TicketNumber } from './TicketNumber';
import { Touchable } from './Touchable';
import { TrendValue } from './TrendValue';

/** One ticket in the nurse worklist. The whole card is one touch target and opens the ticket. */
export function WorklistCard({ item, onPress }: { item: WorklistItem; onPress: () => void }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const outline = {
    observed: { borderWidth: 1, borderColor: colors.line, borderStyle: 'solid' as const },
    flag: { borderWidth: 2, borderColor: colors.flag, borderStyle: 'solid' as const },
    overdue: { borderWidth: 2, borderColor: colors.ink, borderStyle: 'solid' as const },
    'no-reading': { borderWidth: 1, borderColor: colors.lineStrong, borderStyle: 'dashed' as const },
  }[item.state];
  const source = sourceLabel(item.source);
  // The badge already carries the age for observed and overdue tickets.
  const showsLastObserved = item.state === 'flag' || item.state === 'no-reading' || item.sittingInProgress;

  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${item.rank}, ticket ${item.ticketNumber}, ${statusText(item.state, item.minutesSinceObserved)}`}
      accessibilityHint="Opens the ticket"
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.space3,
          minHeight: 88,
          // A 2px outline takes 1px from the padding, so cards keep one size.
          paddingVertical: space.space3 - (outline.borderWidth - 1),
          paddingRight: space.space3 - (outline.borderWidth - 1),
          paddingLeft: space.space4 - (outline.borderWidth - 1),
          borderRadius: theme.radius.radiusXl,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surfaceRaised,
        },
        outline,
      ]}
    >
      <Text style={{ width: 20, fontFamily: fonts.mono[400], fontSize: 15, lineHeight: 22, color: colors.inkMuted }}>
        {item.rank}
      </Text>
      <View style={{ flex: 1, gap: space.space2 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: space.space2,
          }}
        >
          <TicketNumber number={item.ticketNumber} size="md" />
          <StatusBadge state={item.state} minutes={item.minutesSinceObserved} />
        </View>
        <View>
          {(
            [
              ['Pulse', item.pulse, 'bpm'],
              ['Breathing', item.breathing, 'per min'],
            ] as const
          ).map(([label, trend, unit]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[theme.type.caption, { width: 72, color: colors.inkMuted }]}>{label}</Text>
              <View style={{ flex: 1 }}>
                <TrendValue trend={trend} unit={unit} />
              </View>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2 }}>
          {item.score != null ? (
            <ScoreChip score={item.score} measured={item.parametersMeasured} />
          ) : (
            <Text style={[theme.type.caption, { color: colors.inkMuted }]}>Not scored</Text>
          )}
          {source ? <ProvenanceTag kind="recording" label={source} /> : null}
        </View>
        {showsLastObserved ? (
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{lastObservedText(item)}</Text>
        ) : null}
      </View>
      <Icon name="chevron" size={20} color={colors.inkMuted} />
    </Touchable>
  );
}
