import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fonts } from '@/theme';

import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

type Props = {
  label: string;
  /** Says what changes. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const TRACK_WIDTH = 76;
const TRACK_HEIGHT = 32;
const THUMB = 24;
const TRAVEL = 44;

/** On or off, taking effect at once. The track prints the state, so it never rests on colour alone. */
export function Switch({ label, hint, checked, onChange, disabled }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const reducedMotion = useReducedMotion();
  const [position] = useState(() => new Animated.Value(checked ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) {
      position.setValue(checked ? 1 : 0);
      return;
    }
    Animated.timing(position, {
      toValue: checked ? 1 : 0,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [checked, position, reducedMotion]);

  return (
    <Touchable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space.space5,
        minHeight: theme.size.controlTouch,
        borderRadius: theme.radius.radiusMd,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.ink }]}>{label}</Text>
        {hint ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{hint}</Text> : null}
      </View>
      <View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: theme.radius.radiusPill,
          borderWidth: 1,
          borderColor: checked ? colors.signal : colors.lineStrong,
          backgroundColor: checked ? colors.signal : colors.surfaceSunken,
          justifyContent: 'center',
        }}
      >
        <Text
          style={[
            theme.type.label,
            { position: 'absolute', color: checked ? colors.onSignal : colors.ink },
            checked ? { left: 12 } : { right: 10 },
          ]}
        >
          {checked ? 'On' : 'Off'}
        </Text>
        <Animated.View
          style={{
            position: 'absolute',
            left: 3,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: checked ? colors.onSignal : colors.lineStrong,
            transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }],
          }}
        />
      </View>
    </Touchable>
  );
}
