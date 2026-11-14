import type { Score } from '@triagecam/contracts';
import { View } from 'react-native';

import { scoreCaption } from '@/lib/nurse/worklistFormat';
import { weight } from '@/theme';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  score: Score;
  /** How many of the seven NEWS2 parameters the score rests on. */
  measured?: number;
  /** False only inside a row that already says "Partial score". */
  caption?: boolean;
};

/** The partial NEWS2 band for the parameters the camera measures. Always prints the digit; only 3 is solid. */
export function ScoreChip({ score, measured = 2, caption = true }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = [
    { fill: colors.score0, text: colors.onScore0 },
    { fill: colors.score1, text: colors.onScore1 },
    { fill: colors.score2, text: colors.onScore2 },
    { fill: colors.score3, text: colors.onScore3 },
  ][score]!;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space2 }}>
      <View
        accessible
        accessibilityLabel={`Partial score ${score}`}
        style={{
          width: 22,
          height: 22,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.radiusSm,
          backgroundColor: look.fill,
        }}
      >
        {/* The chip is a fixed 22 points, so its digit does not grow past it. */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={[theme.type.caption, { fontWeight: weight.medium, letterSpacing: 0, fontVariant: ['tabular-nums'], color: look.text }]}
        >
          {score}
        </Text>
      </View>
      {caption ? <Text style={[theme.type.caption, { color: colors.inkFaint }]}>{scoreCaption(measured)}</Text> : null}
    </View>
  );
}
