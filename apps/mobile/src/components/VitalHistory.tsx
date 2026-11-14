import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { wholeNumber } from '@/lib/format';
import type { VitalPoint } from '@/lib/nurse/nurseFormat';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  label: string;
  icon: IconName;
  unit: string;
  /** Every sitting that read this value, oldest first. */
  points: VitalPoint[];
};

const HEIGHT = 48;
const PAD = 4;
/** The line never exaggerates a change smaller than this many units of the vital. */
const MIN_SPAN = 12;

/**
 * One vital across the patient's sittings: the latest value in words, and a line from the
 * check-in value (the dashed rule) to now. The words carry the numbers; the line carries the shape.
 */
export function VitalHistory({ label, icon, unit, points }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [width, setWidth] = useState(0);
  const first = points[0];
  const last = points[points.length - 1];

  if (!first || !last) {
    return (
      <View style={{ gap: space.space2 }}>
        <Heading label={label} icon={icon} />
        <View style={{ minHeight: theme.type.readoutLg.lineHeight, justifyContent: 'center' }}>
          <Text style={[theme.type.heading, { color: colors.inkMuted }]}>No reading yet</Text>
        </View>
      </View>
    );
  }

  const delta = Math.round(last.value) - Math.round(first.value);
  const change = points.length < 2 ? 'One reading so far' : delta === 0 ? `Unchanged from ${wholeNumber(first.value)} at check-in` : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} from ${wholeNumber(first.value)} at check-in`;

  const values = points.map((point) => point.value);
  const middle = (Math.max(...values) + Math.min(...values)) / 2;
  const span = Math.max(Math.max(...values) - Math.min(...values), MIN_SPAN);
  const low = middle - span / 2;
  const start = first.at;
  const duration = Math.max(last.at - start, 1);
  const x = (point: VitalPoint) => PAD + ((point.at - start) / duration) * Math.max(width - 2 * PAD, 0);
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - 2 * PAD);

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${wholeNumber(last.value)} ${unit}. ${change}. ${points.length} readings.`}
      style={{ gap: space.space2 }}
    >
      <Heading label={label} icon={icon} />
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
          <Text style={[theme.type.readoutLg, { color: colors.ink }]}>{wholeNumber(last.value)}</Text>
          <Text style={[theme.type.dense, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
        <Text style={[theme.type.caption, { color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>{change}</Text>
      </View>
      {points.length > 1 ? (
        <View style={{ height: HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={HEIGHT}>
              <Line
                x1={PAD}
                x2={width - PAD}
                y1={y(first.value)}
                y2={y(first.value)}
                stroke={colors.lineHover}
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <Polyline
                points={points.map((point) => `${x(point)},${y(point.value)}`).join(' ')}
                fill="none"
                stroke={colors.seriesEstimate}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point, index) => {
                const newest = index === points.length - 1;
                return (
                  <Circle
                    key={index}
                    cx={x(point)}
                    cy={y(point.value)}
                    r={newest ? 3 : 2}
                    fill={newest ? colors.seriesEstimate : colors.surface2}
                    stroke={colors.seriesEstimate}
                    strokeWidth={1.5}
                  />
                );
              })}
            </Svg>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Heading({ label, icon }: { label: string; icon: IconName }) {
  const theme = useScopedTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={16} color={theme.colors.inkMuted} />
      <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>{label}</Text>
    </View>
  );
}
