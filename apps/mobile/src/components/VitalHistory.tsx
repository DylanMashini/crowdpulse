import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { LOWER_CONFIDENCE } from '@triagecam/contracts';

import { wholeNumber } from '@/lib/format';
import type { VitalPoint } from '@/lib/nurse/nurseFormat';

import { Icon, type IconName } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  label: string;
  icon: IconName;
  unit: string;
  /** Every sitting that read this value and counts, oldest first. The first is the baseline. */
  points: VitalPoint[];
  /** Where the baseline is from: "at check-in", or "at the 10:42 re-check". */
  baseFrom?: string;
  /** A pulse the newest sitting gave with lower confidence. Printed tagged; never a point on the line. */
  lowConfidence?: number | null;
};

const HEIGHT = 56;
const PAD = 6;
/** The line never exaggerates a change smaller than this many units of the vital. */
const MIN_SPAN = 12;

/**
 * One vital across the patient's sittings: the latest value in words, and a line from the
 * baseline (the dashed rule) to now. The words carry the numbers; the line carries the shape.
 * A lower-confidence pulse is said beside them, tagged, and changes neither.
 */
export function VitalHistory({ label, icon, unit, points, baseFrom = 'at check-in', lowConfidence = null }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [width, setWidth] = useState(0);
  const first = points[0];
  const last = points[points.length - 1];

  const weak =
    lowConfidence != null ? (
      <View
        accessible
        accessibilityLabel={`Latest sitting: ${wholeNumber(lowConfidence)} ${unit}, ${LOWER_CONFIDENCE.toLowerCase()}. Not used for trends. Repeat the sitting.`}
        style={{ gap: space.space1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space2, rowGap: space.space1 }}>
          <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
            {`Latest sitting: ${wholeNumber(lowConfidence)} ${unit}`}
          </Text>
          <ProvenanceTag kind="experimental" label={LOWER_CONFIDENCE} />
        </View>
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>Not used for trends. Repeat the sitting.</Text>
      </View>
    ) : null;

  if (!first || !last) {
    return (
      <View style={{ gap: space.space1 }}>
        <Heading label={label} icon={icon} />
        <Text style={[theme.type.body, { color: colors.inkMuted }]}>{weak ? 'No reading that counts yet' : 'No reading yet'}</Text>
        {weak}
      </View>
    );
  }

  const delta = Math.round(last.value) - Math.round(first.value);
  const change = points.length < 2 ? 'One reading so far' : delta === 0 ? `Unchanged from ${wholeNumber(first.value)} ${baseFrom}` : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} from ${wholeNumber(first.value)} ${baseFrom}`;

  const values = points.map((point) => point.value);
  const middle = (Math.max(...values) + Math.min(...values)) / 2;
  const span = Math.max(Math.max(...values) - Math.min(...values), MIN_SPAN);
  const low = middle - span / 2;
  const start = first.at;
  const duration = Math.max(last.at - start, 1);
  const x = (point: VitalPoint) => PAD + ((point.at - start) / duration) * Math.max(width - 2 * PAD, 0);
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - 2 * PAD);

  return (
    <View style={{ gap: space.space1 }}>
      <View
        accessible
        accessibilityLabel={`${label}: ${wholeNumber(last.value)} ${unit}. ${change}. ${points.length} readings.`}
        style={{ gap: space.space1 }}
      >
        <Heading label={label} icon={icon} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.space2 }}>
          <Text style={[theme.type.readoutLg, { color: colors.ink }]}>{wholeNumber(last.value)}</Text>
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
        <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{change}</Text>
        {points.length > 1 ? (
          <View style={{ height: HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {width > 0 ? (
              <Svg width={width} height={HEIGHT}>
                <Line
                  x1={PAD}
                  x2={width - PAD}
                  y1={y(first.value)}
                  y2={y(first.value)}
                  stroke={colors.lineStrong}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <Polyline
                  points={points.map((point) => `${x(point)},${y(point.value)}`).join(' ')}
                  fill="none"
                  stroke={colors.seriesEstimate}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((point, index) => (
                  <Circle
                    key={index}
                    cx={x(point)}
                    cy={y(point.value)}
                    r={index === points.length - 1 ? 4 : 3}
                    fill={index === points.length - 1 ? colors.seriesEstimate : colors.surfaceRaised}
                    stroke={colors.seriesEstimate}
                    strokeWidth={2}
                  />
                ))}
              </Svg>
            ) : null}
          </View>
        ) : null}
      </View>
      {weak}
    </View>
  );
}

function Heading({ label, icon }: { label: string; icon: IconName }) {
  const theme = useScopedTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space2 }}>
      <Icon name={icon} size={18} color={theme.colors.inkMuted} />
      <Text style={[theme.type.label, { color: theme.colors.inkMuted }]}>{label}</Text>
    </View>
  );
}
