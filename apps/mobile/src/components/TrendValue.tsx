import type { Trend } from '@triagecam/contracts';
import { View } from 'react-native';

import { trendText } from '@/lib/nurse/worklistFormat';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

/**
 * A value against the patient's own check-in baseline: "108 bpm" over "from 82 (+26)", or
 * "No reading". The baseline has a line of its own, so two values side by side wrap the same way.
 */
export function TrendValue({ trend, unit }: { trend: Trend; unit: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const text = trendText(trend);
  if (text.kind === 'none') {
    return <Text style={[theme.type.caption, { lineHeight: 28, color: colors.inkMuted }]}>No reading</Text>;
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
        <Text style={[theme.type.readoutMd, { color: colors.ink }]}>{text.now}</Text>
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
      </View>
      <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
        {text.base ?? 'No check-in value'}
      </Text>
    </View>
  );
}
