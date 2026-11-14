import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { hairline, motion } from '@/theme';

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

const TRACK_WIDTH = 48;
const TRACK_HEIGHT = 28;
const THUMB = 20;
const INSET = (TRACK_HEIGHT - THUMB) / 2;
const TRAVEL = TRACK_WIDTH - THUMB - INSET * 2;

/**
 * On or off, taking effect at once. On is an ice thumb at the right of a faintly ice track; off
 * is a grey thumb at the left of an empty one. The state is the thumb's place as well as its
 * colour, and nothing in a list of settings is brighter than the values beside it.
 */
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
          borderColor: checked ? colors.signalLine : colors.lineStrong,
          backgroundColor: checked ? colors.signalSoft : colors.surface0,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            left: INSET - hairline,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: checked ? colors.signalStrong : colors.inkMuted,
            transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }],
          }}
        />
      </View>
    </Touchable>
  );
}
