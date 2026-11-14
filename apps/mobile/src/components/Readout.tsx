import { View } from 'react-native';

import { weight } from '@/theme';

import { Icon, type IconName } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  label: string;
  /** Printed for `valid`, struck through for `stale`. */
  value?: string;
  /** Written out: "bpm", "breaths per min", "ms". */
  unit: string;
  size?: 'xl' | 'lg' | 'md';
  state?: 'valid' | 'settling' | 'none' | 'stale';
  /** A value being measured now is ice-white. A settled one is `ink`. */
  live?: boolean;
  icon?: IconName;
  /** The line under the value: its age and source, the reason for no reading, or how stale it is. */
  foot: string;
  experimental?: boolean;
};

/**
 * One measured value with its unit, source and age, set as an instrument: a fixed-width face
 * with tabular figures, so the number keeps still when it changes. `none` prints the words
 * "No reading", never a dash or a faded number.
 */
export function Readout({ label, value, unit, size = 'lg', state = 'valid', live, icon, foot, experimental }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const valueStyle = { xl: theme.type.readoutXl, lg: theme.type.readoutLg, md: theme.type.readoutMd }[size];
  // The words stand where the number would, on the number's own line height, so nothing moves
  // when a reading arrives.
  const wordStyle = size === 'md' ? theme.type.subheading : theme.type.heading;
  const showsNumber = state === 'valid' || state === 'stale';
  const spoken = showsNumber
    ? `${label}, ${state === 'stale' ? 'stale, last value ' : ''}${value} ${unit}. ${foot}`
    : `${label}, ${state === 'settling' ? 'settling' : 'no reading'}. ${foot}`;

  return (
    <View accessible accessibilityLabel={spoken} style={{ gap: theme.space.space2, alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, minHeight: 22 }}>
        {icon ? <Icon name={icon} size={16} color={colors.inkMuted} /> : null}
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{label}</Text>
        {experimental ? <ProvenanceTag kind="experimental" /> : null}
      </View>
      {showsNumber ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
          <Text
            style={[
              valueStyle,
              { color: live ? colors.signalStrong : colors.ink },
              state === 'stale' && { color: colors.inkFaint, textDecorationLine: 'line-through' },
            ]}
          >
            {value}
          </Text>
          <Text style={[theme.type.dense, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
      ) : (
        <View style={{ minHeight: valueStyle.lineHeight, justifyContent: 'center' }}>
          <Text style={[wordStyle, { color: colors.inkMuted }]}>{state === 'settling' ? 'Settling' : 'No reading'}</Text>
        </View>
      )}
      <Text
        style={[
          theme.type.caption,
          { color: colors.inkFaint },
          state === 'stale' && { color: colors.watch, fontWeight: weight.medium },
        ]}
      >
        {foot}
      </Text>
    </View>
  );
}
