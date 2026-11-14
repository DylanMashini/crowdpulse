import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { SummaryItem } from '@/lib/capture/readingFormat';
import { fonts } from '@/theme';

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

/** The result of one sitting: each measurement with its coverage, failed ones included. */
export function SittingSummary({ items, status, sourceNote, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <View
      style={{
        padding: space.space5,
        gap: space.space5,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: colors.surfaceRaised,
      }}
    >
      <View style={{ gap: space.space1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLiveRegion="polite">
          <Icon name={status.icon} size={18} color={status.settled ? colors.signal : colors.inkMuted} />
          <Text
            style={[
              theme.type.bodyTouch,
              { flex: 1, fontFamily: fonts.sans[600], color: status.settled ? colors.signal : colors.ink },
            ]}
          >
            {status.text}
          </Text>
        </View>
        {sourceNote ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{sourceNote}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space5, rowGap: space.space5 }}>
        {items.map((item) => (
          <View key={item.key} style={{ flexGrow: 1, flexBasis: 180, gap: space.space3 }}>
            <Readout
              label={item.label}
              icon={item.icon}
              value={item.value ?? undefined}
              unit={item.unit}
              state={item.value == null ? 'none' : 'valid'}
              foot={item.reason ?? 'Median of this sitting'}
              experimental={item.experimental}
              size="lg"
            />
            <QualityMeter value={item.coverage} />
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}
