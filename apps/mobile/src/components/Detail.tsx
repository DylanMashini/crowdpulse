import { View } from 'react-native';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

/** A fact with its name above it: who is signed in, which server, what was entered at intake. */
export function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[theme.type.caption, { color: colors.inkFaint }]}>{label}</Text>
      <Text selectable style={[theme.type.subheading, { fontWeight: theme.type.body.fontWeight, color: colors.ink }]}>
        {value}
      </Text>
      {note ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{note}</Text> : null}
    </View>
  );
}
