import { View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** One plain sentence the build can defend. */
  children: string;
  icon?: IconName;
};

/** What happens to a person's data, placed beside the control that captures it. Plain text, no fill. */
export function PrivacyNote({ children, icon = 'lock' }: Props) {
  const theme = useScopedTheme();
  const color = theme.colors.inkMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.space2 }}>
      <Icon name={icon} size={16} color={color} />
      <Text style={[theme.type.caption, { flex: 1, color }]}>{children}</Text>
    </View>
  );
}
