import { View } from 'react-native';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

/** The product's name with its mark, one pulse in ice. On the screens before sign-in only. */
export function Wordmark() {
  const theme = useScopedTheme();
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Triage Cam" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space2 }}>
      <Icon name="pulse" size={18} color={theme.colors.signal} />
      <Text style={[theme.type.subheading, { color: theme.colors.ink }]}>Triage Cam</Text>
    </View>
  );
}
