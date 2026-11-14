import type { Trend } from '@triagecam/contracts';
import { Text, View } from 'react-native';

import { trendText } from '@/lib/nurse/worklistFormat';

import { useScopedTheme } from './ThemeScope';

/** A value against the patient's own check-in baseline: "108 from 82 (+26)", or "No reading". */
export function TrendValue({ trend, unit }: { trend: Trend; unit: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const text = trendText(trend);
  if (text.kind === 'none') {
    return <Text style={[theme.type.caption, { lineHeight: 28, color: colors.inkMuted }]}>No reading</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: theme.space.space2 }}>
      <Text style={[theme.type.readoutMd, { color: colors.ink }]}>{text.now}</Text>
      <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
        {text.base ? `${unit} ${text.base}` : unit}
      </Text>
    </View>
  );
}
