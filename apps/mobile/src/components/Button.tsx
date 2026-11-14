import { View } from 'react-native';

import { hairline } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  /** A verb phrase in sentence case. */
  label: string;
  onPress: () => void;
  /** One `primary` per screen or card. `danger` only deletes data. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  icon?: IconName;
  /** Fills the width of its container. */
  block?: boolean;
  /** On a sheet or a banner, which already sit on the secondary button's own surface. */
  raised?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

/**
 * The design system's Button at its touch size, the only size on a phone. The primary is
 * ice-white with dark text, so no button ever competes with a severity colour.
 */
export function Button({ label, onPress, variant = 'secondary', icon, block, raised, disabled, accessibilityHint }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = {
    primary: { fill: colors.signalStrong, pressed: colors.inkBright, border: 'transparent', text: colors.onSignal },
    secondary: {
      fill: raised ? colors.surface4 : colors.surface3,
      pressed: raised ? colors.lineHover : colors.surface4,
      border: colors.lineStrong,
      text: colors.ink,
    },
    quiet: { fill: 'transparent', pressed: colors.surface3, border: 'transparent', text: colors.signal },
    danger: { fill: 'transparent', pressed: colors.urgentSoft, border: colors.urgentLineStrong, text: colors.urgent },
  }[variant];

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        height: theme.size.controlTouch,
        paddingHorizontal: theme.space.space4,
        borderRadius: theme.radius.radiusLg,
        borderWidth: hairline,
        borderColor: look.border,
        backgroundColor: pressed ? look.pressed : look.fill,
        alignSelf: block ? 'stretch' : 'flex-start',
        opacity: disabled ? 0.4 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.space2 }}>
        {icon ? <Icon name={icon} size={20} color={look.text} /> : null}
        {/* The control is 48 points tall: the label grows with the text size up to what fits in it. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[theme.type.subheading, { flexShrink: 1, color: look.text }]}
        >
          {label}
        </Text>
      </View>
    </Touchable>
  );
}
