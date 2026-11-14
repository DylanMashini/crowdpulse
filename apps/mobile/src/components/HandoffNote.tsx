import { Text, View } from 'react-native';

import { fonts } from '@/theme';

import { useScopedTheme } from './ThemeScope';

/**
 * The sentence a nurse reads before walking over. It comes from the server's fixed template
 * and is shown as it is. This pass has no draft underneath it.
 */
export function HandoffNote({ sentence }: { sentence: string }) {
  const theme = useScopedTheme();
  return (
    <View
      style={{
        padding: theme.space.space4,
        borderWidth: 1,
        borderColor: theme.colors.line,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[500], color: theme.colors.ink }]}>{sentence}</Text>
    </View>
  );
}
