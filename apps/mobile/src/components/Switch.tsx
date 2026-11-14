import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { hairline, motion, weight } from '@/theme';

import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  label: string;
  /** Says what changes. */
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const TRACK_WIDTH = 64;
const TRACK_HEIGHT = 32;
const THUMB = 24;
const INSET = (TRACK_HEIGHT - THUMB) / 2;
const TRAVEL = TRACK_WIDTH - THUMB - INSET * 2;

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
      duration: motion.durationFast,
      easing: Easing.bezier(...motion.easeOut),
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
        gap: theme.space.space4,
        minHeight: theme.size.controlTouch,
        borderRadius: theme.radius.radiusMd,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[theme.type.subheading, { color: colors.ink }]}>{label}</Text>
        {hint ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{hint}</Text> : null}
      </View>
      <View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: theme.radius.radiusPill,
          borderWidth: hairline,
          borderColor: checked ? colors.signalStrong : colors.lineStrong,
          backgroundColor: checked ? colors.signalStrong : colors.surface0,
          justifyContent: 'center',
        }}
      >
        <Text
          maxFontSizeMultiplier={1.1}
          style={[
            theme.type.caption,
            { position: 'absolute', fontWeight: weight.medium, color: checked ? colors.onSignal : colors.inkMuted },
            checked ? { left: 10 } : { right: 9 },
          ]}
        >
          {checked ? 'On' : 'Off'}
        </Text>
        <Animated.View
          style={{
            position: 'absolute',
            left: INSET - hairline,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: checked ? colors.onSignal : colors.inkMuted,
            transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }],
          }}
        />
      </View>
    </Touchable>
  );
}
