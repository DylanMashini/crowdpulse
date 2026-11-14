import { View } from 'react-native';

import { fonts } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  /** A verb phrase in sentence case. */
  label: string;
  onPress: () => void;
  /** One `primary` per screen. `danger` only deletes data. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  icon?: IconName;
  /** Fills the width of its container. */
  block?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

/** The design system's Button at its `touch` size, the only size allowed on a phone. */
export function Button({ label, onPress, variant = 'secondary', icon, block, disabled, accessibilityHint }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = {
    primary: { background: colors.signal, border: colors.signal, text: colors.onSignal, pressed: colors.signal },
    secondary: {
      background: colors.surfaceRaised,
      border: colors.lineStrong,
      text: colors.ink,
      pressed: colors.surfaceSunken,
    },
    quiet: { background: 'transparent', border: 'transparent', text: colors.signal, pressed: colors.surfaceSunken },
    danger: {
      background: colors.surfaceRaised,
      border: colors.critical,
      text: colors.critical,
      pressed: colors.criticalSoft,
    },
  }[variant];

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        {
          height: theme.size.controlTouch,
          paddingHorizontal: theme.space.space5,
          borderRadius: theme.radius.radiusMd,
          borderWidth: 1,
          borderColor: look.border,
          backgroundColor: pressed ? look.pressed : look.background,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.45 : pressed && variant === 'primary' ? 0.92 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
      ]}
    >
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space.space2,
        }}
      >
        {icon ? <Icon name={icon} size={20} color={look.text} /> : null}
        {/* The control is 48 points tall: the label grows with the text size up to what fits in it. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[theme.type.bodyTouch, { flexShrink: 1, fontFamily: fonts.sans[600], color: look.text }]}
        >
          {label}
        </Text>
      </View>
    </Touchable>
  );
}
