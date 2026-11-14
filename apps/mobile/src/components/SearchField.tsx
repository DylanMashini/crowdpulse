import { useState } from 'react';
import { TextInput, View } from 'react-native';

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
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.space2,
          minHeight: theme.size.controlTouch,
          paddingLeft: space.space3,
          borderWidth: 1,
          borderColor: colors.lineStrong,
          borderRadius: theme.radius.radiusMd,
          backgroundColor: colors.surfaceRaised,
        },
        focused && { outlineColor: colors.focus, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' },
      ]}
    >
      <Icon name="search" size={20} color={colors.inkMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.inkMuted}
        maxFontSizeMultiplier={MAX_TEXT_SCALE}
        selectionColor={colors.signal}
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
          style={{
            width: theme.size.controlTouch,
            height: theme.size.controlTouch,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.radiusMd,
          }}
        >
          <Icon name="close" size={18} color={colors.inkMuted} />
        </Touchable>
      ) : null}
    </View>
  );
}
