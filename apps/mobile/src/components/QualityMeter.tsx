import { Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { percent } from '@/lib/format';

import { useScopedTheme } from './ThemeScope';

type Props = {
  /** 0 to 1. */
  value: number;
  label?: string;
  /** 0 to 1. Below it the fill is striped and the text says so. */
  threshold?: number;
};

/** Coverage as a share of the sitting. Always prints the percentage. */
export function QualityMeter({ value, label = 'Coverage', threshold }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const share = Math.max(0, Math.min(1, value));
  const low = threshold != null && share < threshold;
  const text = `${percent(share)}${low ? ', below threshold' : ''}`;
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }} accessible accessibilityLabel={`${label} ${text}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.space3 }}>
        <Text style={[theme.type.caption, { lineHeight: 16, color: colors.inkMuted }]}>{label}</Text>
        <Text style={[theme.type.label, { color: low ? colors.flag : colors.ink, fontVariant: ['tabular-nums'] }]}>
          {text}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: theme.radius.radiusSm,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <View
          style={{
            width: `${share * 100}%`,
            height: '100%',
            borderRadius: theme.radius.radiusSm,
            overflow: 'hidden',
            backgroundColor: low ? colors.flagSoft : colors.signal,
          }}
        >
          {low ? (
            <Svg width="100%" height="100%">
              <Defs>
                <Pattern id="low" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <Line x1={2} y1={0} x2={2} y2={7} stroke={colors.flag} strokeWidth={4} />
                </Pattern>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#low)" />
            </Svg>
          ) : null}
        </View>
        {threshold != null ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              left: `${Math.round(threshold * 100)}%`,
              width: 2,
              height: 12,
              backgroundColor: colors.ink,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
