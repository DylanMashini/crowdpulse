import type { Score } from '@triagecam/contracts';
import { View } from 'react-native';

import { scoreCaption } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  score: Score;
  /** How many of the seven NEWS2 parameters the score rests on. */
  measured?: number;
  /** False only inside a row that already says "Partial score". */
  caption?: boolean;
};

/** The partial NEWS2 band for the parameters the camera measures. Always prints the digit. */
export function ScoreChip({ score, measured = 2, caption = true }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = [
    { background: colors.score0, text: colors.ink, border: colors.lineStrong },
    { background: colors.score1, text: colors.ink, border: colors.score1 },
    { background: colors.score2, text: colors.onScore2, border: colors.score2 },
    { background: colors.score3, text: colors.onCritical, border: colors.score3 },
  ][score]!;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space2 }}>
      <View
        accessible
        accessibilityLabel={`Partial score ${score}`}
        style={{
          width: 28,
          height: 28,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.radiusSm,
          borderWidth: 1,
          borderColor: look.border,
          backgroundColor: look.background,
        }}
      >
        {/* The chip is a fixed 28 points, so its digit does not grow past it. */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontFamily: fonts.mono[600], fontSize: 15, lineHeight: 22, color: look.text }}
        >
          {score}
        </Text>
      </View>
      {caption ? (
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{scoreCaption(measured)}</Text>
      ) : null}
    </View>
  );
}
