import { View } from 'react-native';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

export const SITTING_SECONDS = 60;

// Segments are sized by duration: settle to 5 s, heart rate to 20 s, breathing and beats to 60 s.
const PHASES = [
  { until: 5, label: 'Settle' },
  { until: 20, label: 'Heart rate' },
  { until: SITTING_SECONDS, label: 'Breathing and beats' },
];

type Props = {
  /** Whole seconds since the first frame of the sitting. */
  elapsed: number;
  /** Shown beside "Done" once the time is up. */
  doneLabel?: string;
};

/** Progress through the 60-second sitting. Counts down in whole seconds and names the phase. */
export function SittingTimer({ elapsed, doneLabel = 'Baseline saved' }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const seconds = Math.max(0, Math.min(SITTING_SECONDS, Math.floor(elapsed)));
  const done = seconds >= SITTING_SECONDS;
  const phase = PHASES.find((candidate) => seconds < candidate.until) ?? PHASES[PHASES.length - 1]!;
  const left = done ? 'Done' : `${SITTING_SECONDS - seconds} s left`;
  const phaseLabel = done ? doneLabel : phase.label;

  return (
    <View style={{ gap: theme.space.space2 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: theme.space.space3,
        }}
      >
        {done ? (
          <Text style={[theme.type.heading, { color: colors.ink }]}>Done</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={[theme.type.readoutMd, { color: colors.ink }]}>{SITTING_SECONDS - seconds}</Text>
            <Text style={[theme.type.dense, { color: colors.inkMuted }]}>s left</Text>
          </View>
        )}
        <Text style={[theme.type.dense, { color: colors.inkMuted }]}>{phaseLabel}</Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${left}, ${phaseLabel}`}
        accessibilityValue={{ min: 0, max: SITTING_SECONDS, now: seconds }}
        style={{ flexDirection: 'row', gap: 2, height: 4 }}
      >
        {PHASES.map((candidate, index) => {
          const from = index === 0 ? 0 : PHASES[index - 1]!.until;
          const span = candidate.until - from;
          const fill = Math.max(0, Math.min(1, (seconds - from) / span));
          return (
            <View
              key={candidate.label}
              style={{ flexGrow: span, flexBasis: 0, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.lineStrong }}
            >
              <View style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: colors.signal }} />
            </View>
          );
        })}
      </View>
    </View>
  );
}
