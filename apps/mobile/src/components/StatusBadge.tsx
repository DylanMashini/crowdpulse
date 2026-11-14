import type { TileState } from '@triagecam/contracts';
import { View } from 'react-native';

import { statusText } from '@/lib/nurse/worklistFormat';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

const ICONS: Record<TileState, IconName> = {
  observed: 'clock',
  flag: 'flag',
  overdue: 'clock',
  'no-reading': 'no-reading',
};

type Props = {
  state: TileState;
  /** Whole minutes since the last valid observation. */
  minutes?: number | null;
  /** Replaces the default words, for a timeline entry that names its own event. */
  label?: string;
};

/** The state of one patient. Four states, each told apart by shape and lightness as well as hue. */
export function StatusBadge({ state, minutes = null, label }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = {
    observed: { text: colors.inkMuted, background: 'transparent', border: 'transparent', dashed: false },
    flag: { text: colors.flag, background: colors.flagSoft, border: colors.flag, dashed: false },
    overdue: { text: colors.onOverdue, background: colors.overdue, border: colors.overdue, dashed: false },
    'no-reading': { text: colors.ink, background: 'transparent', border: colors.lineStrong, dashed: true },
  }[state];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        flexShrink: 1,
        gap: theme.space.space1,
        minHeight: 26,
        paddingLeft: state === 'observed' ? 0 : theme.space.space2,
        paddingRight: 10,
        borderRadius: theme.radius.radiusPill,
        borderWidth: 1,
        borderStyle: look.dashed ? 'dashed' : 'solid',
        borderColor: look.border,
        backgroundColor: look.background,
      }}
    >
      <Icon name={ICONS[state]} size={16} color={look.text} />
      <Text
        style={[
          state === 'observed' ? theme.type.caption : theme.type.label,
          { color: look.text, flexShrink: 1 },
        ]}
      >
        {label ?? statusText(state, minutes)}
      </Text>
    </View>
  );
}
