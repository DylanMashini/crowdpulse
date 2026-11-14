import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { hairline } from '@/theme';

import { Icon } from './Icon';
import { MAX_TEXT_SCALE } from './Text';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

type Props = {
  /** Says what can be typed; read out by VoiceOver and shown while the field is empty. */
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** One line to narrow a list as it is typed. The glass says what it is; the cross clears it. */
export function SearchField({ label, value, onChange }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.space2,
        minHeight: theme.size.controlTouch,
        paddingLeft: space.space3,
        borderWidth: focused ? 1 : hairline,
        borderColor: focused ? colors.signal : colors.lineStrong,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: colors.surface0,
        boxShadow: focused ? `0 0 0 3px ${colors.signalSoft}` : undefined,
      }}
    >
      <Icon name="search" size={20} color={colors.inkFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.inkFaint}
        maxFontSizeMultiplier={MAX_TEXT_SCALE}
        selectionColor={colors.signal}
        keyboardAppearance="dark"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        style={[
          theme.type.bodyTouch,
          // A line height on a single-line input pushes the text off centre on iOS.
          { flex: 1, paddingVertical: space.space2, lineHeight: undefined, color: colors.ink },
        ]}
      />
      {value ? (
        <Touchable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Clear the search"
          style={({ pressed }) => ({
            width: theme.size.controlTouch,
            height: theme.size.controlTouch,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.radiusLg,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="close" size={18} color={colors.inkMuted} />
        </Touchable>
      ) : null}
    </View>
  );
}
