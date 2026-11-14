import type { Trend } from '@triagecam/contracts';
import { View } from 'react-native';

import { trendText } from '@/lib/nurse/worklistFormat';

import { ProvenanceTag } from './ProvenanceTag';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

/**
 * A value against the patient's own baseline: "108 bpm" over "from 82 (+26)", or "No reading".
 * The baseline has a line of its own, so two values side by side wrap the same way, and one
 * that is a re-check's says which ("10:42 re-check"). A lower-confidence pulse is muted, tagged
 * and compared with nothing.
 */
export function TrendValue({ trend, unit, bright }: { trend: Trend; unit: string; bright?: boolean }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const text = trendText(trend);
  if (text.kind === 'none') {
    return (
      <View style={{ minHeight: theme.type.readoutMd.lineHeight, justifyContent: 'center' }}>
        <Text style={[theme.type.dense, { color: colors.inkMuted }]}>No reading</Text>
      </View>
    );
  }
  if (text.kind === 'lowConfidence') {
    return (
      <View accessible accessibilityLabel={`${text.now} ${unit}, ${text.tag.toLowerCase()}`} style={{ gap: theme.space.space1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
          <Text style={[theme.type.readoutMd, { color: colors.inkMuted }]}>{text.now}</Text>
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
        <ProvenanceTag kind="experimental" label={text.tag} />
      </View>
    );
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 4 }}>
        <Text style={[theme.type.readoutMd, { color: bright ? colors.inkBright : colors.ink }]}>{text.now}</Text>
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
      </View>
      <Text style={[theme.type.caption, { color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>
        {text.base ?? 'No check-in value'}
      </Text>
      {text.baseFrom ? (
        <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{text.baseFrom}</Text>
      ) : null}
    </View>
  );
}
