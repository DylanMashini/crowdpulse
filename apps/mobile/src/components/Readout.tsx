import { View } from 'react-native';

import { fonts } from '@/theme';

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
  icon?: IconName;
  /** The line under the value: its age and source, the reason for no reading, or how stale it is. */
  foot: string;
  experimental?: boolean;
};

/** One measured value with its unit, source and age. `none` prints the words "No reading". */
export function Readout({ label, value, unit, size = 'lg', state = 'valid', icon, foot, experimental }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const valueStyle = { xl: theme.type.readoutXl, lg: theme.type.readoutLg, md: theme.type.readoutMd }[size];
  const words = {
    xl: { fontSize: 28, lineHeight: 70, paddingHorizontal: theme.space.space4 },
    lg: { fontSize: 20, lineHeight: 42, paddingHorizontal: theme.space.space3 },
    md: { fontSize: 15, lineHeight: 26, paddingHorizontal: theme.space.space2 },
  }[size];
  const showsNumber = state === 'valid' || state === 'stale';
  const spoken = showsNumber
    ? `${label}, ${state === 'stale' ? 'stale, last value ' : ''}${value} ${unit}. ${foot}`
    : `${label}, ${state === 'settling' ? 'settling' : 'no reading'}. ${foot}`;

  return (
    <View accessible accessibilityLabel={spoken} style={{ gap: theme.space.space1, alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space2, minHeight: 22 }}>
        {icon ? <Icon name={icon} size={18} color={colors.inkMuted} /> : null}
        <Text style={[theme.type.label, { color: colors.inkMuted }]}>{label}</Text>
        {experimental ? <ProvenanceTag kind="experimental" /> : null}
      </View>
      {showsNumber ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.space2 }}>
          <Text
            style={[
              valueStyle,
              { color: colors.ink },
              state === 'stale' && { color: colors.inkMuted, textDecorationLine: 'line-through' },
            ]}
          >
            {value}
          </Text>
          <Text style={[theme.type.body, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
      ) : (
        <View
          style={{
            alignSelf: 'flex-start',
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.lineStrong,
            borderRadius: theme.radius.radiusMd,
          }}
        >
          <Text style={[{ fontFamily: fonts.sans[600], color: colors.ink }, words]}>
            {state === 'settling' ? 'Settling' : 'No reading'}
          </Text>
        </View>
      )}
      <Text
        style={[
          theme.type.caption,
          { color: colors.inkMuted },
          state === 'stale' && { color: colors.flag, fontFamily: fonts.sans[500] },
        ]}
      >
        {foot}
      </Text>
    </View>
  );
}
