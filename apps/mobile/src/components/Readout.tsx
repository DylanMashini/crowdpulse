import { View } from 'react-native';

import { weight } from '@/theme';

import { Icon, type IconName } from './Icon';
import { ProvenanceTag } from './ProvenanceTag';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  label: string;
  /** Printed for `valid` and `held`, struck through for `stale`. */
  value?: string;
  /** Printed beside the value: "bpm", "per min", "ms". */
  unit: string;
  /** The unit as it is read aloud, when the printed one leans on the label: "breaths per minute". */
  unitSpoken?: string;
  /** Closes the gaps between the lines, for a cell that also carries a trace. */
  dense?: boolean;
  size?: 'xl' | 'lg' | 'md';
  state?: 'valid' | 'settling' | 'none' | 'stale' | 'held';
  /** How old a `held` value is, in the corner of the readout: "8 s ago". Left out while it is fresh. */
  age?: string | null;
  /** A value being measured now is ice-white. A settled one is `ink`. */
  live?: boolean;
  icon?: IconName;
  /** The line under the value: its age and source, the reason for no reading, or how stale it is. */
  foot: string;
  experimental?: boolean;
};

/** How far a readout's number and unit grow with the system text size. */
const READOUT_TEXT_SCALE = 1.3;

/**
 * One measured value with its unit, source and age, set as an instrument: a fixed-width face
 * with tabular figures, so the number keeps still when it changes. `none` prints the words
 * "No reading", never a dash or a faded number. `held`, during a sitting, keeps the latest
 * value in place when the readings after it carry none: in `ink`, not the live accent, with
 * its age in the corner once it is no longer fresh.
 */
export function Readout({ label, value, unit, unitSpoken, dense, size = 'lg', state = 'valid', age, live, icon, foot, experimental }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const valueStyle = { xl: theme.type.readoutXl, lg: theme.type.readoutLg, md: theme.type.readoutMd }[size];
  // The words stand where the number would, on the number's own line height, so nothing moves
  // when a reading arrives.
  const wordStyle = size === 'md' ? theme.type.subheading : theme.type.heading;
  const showsNumber = state === 'valid' || state === 'stale' || state === 'held';
  const heldAge = state === 'held' && age ? age : null;
  const spoken = showsNumber
    ? `${label}, ${state === 'stale' ? 'stale, last value ' : ''}${value} ${unitSpoken ?? unit}${heldAge ? `, read ${heldAge}` : ''}. ${foot}`
    : `${label}, ${state === 'settling' ? 'settling' : 'no reading'}. ${foot}`;

  return (
    <View accessible accessibilityLabel={spoken} style={{ gap: dense ? theme.space.space1 : theme.space.space2, alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, minHeight: 22 }}>
        {icon ? <Icon name={icon} size={16} color={colors.inkMuted} /> : null}
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{label}</Text>
        {experimental ? <ProvenanceTag kind="experimental" /> : null}
        {heldAge ? (
          <Text style={[theme.type.caption, { color: colors.inkFaint, marginLeft: 'auto', fontVariant: ['tabular-nums'] }]}>{heldAge}</Text>
        ) : null}
      </View>
      {showsNumber ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
          {/* The number is already display size, so it and its unit follow the text size a shorter
              way than body text and stay on one line in a half-width cell. */}
          <Text
            maxFontSizeMultiplier={READOUT_TEXT_SCALE}
            style={
              state === 'stale'
                ? { ...valueStyle, color: colors.inkFaint, textDecorationLine: 'line-through' }
                : { ...valueStyle, color: live && state === 'valid' ? colors.signalStrong : colors.ink }
            }
          >
            {value}
          </Text>
          <Text maxFontSizeMultiplier={READOUT_TEXT_SCALE} style={[theme.type.dense, { color: colors.inkMuted }]}>
            {unit}
          </Text>
        </View>
      ) : (
        <View style={{ minHeight: valueStyle.lineHeight, justifyContent: 'center' }}>
          <Text style={[wordStyle, { color: colors.inkMuted }]}>{state === 'settling' ? 'Settling' : 'No reading'}</Text>
        </View>
      )}
      <Text
        style={[
          theme.type.caption,
          state === 'stale' ? { color: colors.watch, fontWeight: weight.medium } : { color: colors.inkFaint },
        ]}
      >
        {foot}
      </Text>
    </View>
  );
}
