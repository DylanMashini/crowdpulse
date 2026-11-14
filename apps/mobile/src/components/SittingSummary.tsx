import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { SummaryItem } from '@/lib/capture/readingFormat';

import { Card, Divider } from './Card';
import { Icon, type IconName } from './Icon';
import { QualityMeter } from './QualityMeter';
import { Readout } from './Readout';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  items: SummaryItem[];
  /** Where the summary stands with the station: "Baseline saved", "Not sent yet". */
  status: { icon: IconName; text: string; settled: boolean };
  /** Says where the numbers came from when it was not the camera. */
  sourceNote: string | null;
  /** Goes under the grid: the next action and the privacy note. */
  children?: ReactNode;
};

/**
 * The result of one sitting: each measurement with its coverage, failed ones included. The two
 * vitals lead at the large readout size; the experimental values sit under a rule, smaller.
 */
export function SittingSummary({ items, status, sourceNote, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const vitals = items.filter((item) => !item.experimental);
  const experimental = items.filter((item) => item.experimental);
  const grid = (group: SummaryItem[], size: 'lg' | 'md') => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space5, rowGap: space.space5 }}>
      {group.map((item) => (
        <View key={item.key} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 132, gap: space.space3 }}>
          <Readout
            label={item.label}
            icon={item.icon}
            value={item.value ?? undefined}
            unit={item.unit}
            state={item.value == null ? 'none' : 'valid'}
            foot={item.reason ?? 'Median of this sitting'}
            experimental={item.experimental}
            size={size}
          />
          <QualityMeter value={item.coverage} />
        </View>
      ))}
    </View>
  );
  return (
    <Card style={{ gap: space.space5 }}>
      <View style={{ gap: space.space1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space2 }} accessibilityLiveRegion="polite">
          <Icon name={status.icon} size={18} color={status.settled ? colors.signal : colors.inkMuted} />
          <Text style={[theme.type.subheading, { flex: 1, color: colors.ink }]}>{status.text}</Text>
        </View>
        {sourceNote ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{sourceNote}</Text> : null}
      </View>
      {grid(vitals, 'lg')}
      {experimental.length > 0 ? (
        <>
          <Divider />
          {grid(experimental, 'md')}
        </>
      ) : null}
      {children}
    </Card>
  );
}
