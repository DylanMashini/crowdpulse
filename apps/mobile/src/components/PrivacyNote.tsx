import { Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';

type Props = {
  /** One plain sentence the build can defend. */
  children: string;
  icon?: IconName;
  /** `plain` is a footnote without the fill. */
  tone?: 'filled' | 'plain';
};

/** What happens to a person's data, placed beside the control that captures it. */
export function PrivacyNote({ children, icon = 'lock', tone = 'filled' }: Props) {
  const theme = useScopedTheme();
  const plain = tone === 'plain';
  const color = plain ? theme.colors.inkMuted : theme.colors.ink;
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.space2 },
        !plain && {
          paddingVertical: 6,
          paddingLeft: 10,
          paddingRight: theme.space.space3,
          borderRadius: theme.radius.radiusMd,
          backgroundColor: theme.colors.surfaceSunken,
        },
      ]}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <Text style={[theme.type.caption, { flex: 1, color }]}>{children}</Text>
    </View>
  );
}
