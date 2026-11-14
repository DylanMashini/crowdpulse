import { View } from 'react-native';

import { percent } from '@/lib/format';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** 0 to 1. */
  value: number;
  label?: string;
  /** 0 to 1. Below it the fill turns `watch` and the text says so. */
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
        <Text style={[theme.type.caption, { color: colors.inkFaint }]}>{label}</Text>
        <Text style={[theme.type.caption, { color: low ? colors.watch : colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{text}</Text>
      </View>
      <View style={{ height: 6, borderRadius: theme.radius.radiusSm, backgroundColor: colors.surface4 }}>
        <View
          style={{
            width: `${share * 100}%`,
            height: '100%',
            borderRadius: theme.radius.radiusSm,
            backgroundColor: low ? colors.watch : colors.signal,
          }}
        />
        {threshold != null ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              left: `${Math.round(threshold * 100)}%`,
              width: 2,
              height: 10,
              backgroundColor: colors.ink,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
