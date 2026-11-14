import { View, useWindowDimensions } from 'react-native';

import { hairline } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  label: string;
  /** Says what the number changes. */
  hint?: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  disabled?: boolean;
};

/**
 * A number with its unit between a minus and a plus, for the few settings a nurse changes on a
 * phone. The three parts share one well, so it reads as a single control.
 */
export function Stepper({ label, hint, value, unit, min, max, step, onChange, disabled }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  // At the larger text sizes the words take the full width and the control goes under them.
  const stacked = useWindowDimensions().fontScale > 1.3;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const button = (sign: -1 | 1) => {
    const next = clamp(value + sign * step);
    const off = disabled || next === value;
    return (
      <Touchable
        onPress={() => onChange(next)}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={`${sign < 0 ? 'Decrease' : 'Increase'} ${label.toLowerCase()} to ${next} ${unit}`}
        accessibilityState={{ disabled: off }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => ({
          width: theme.size.controlTouch,
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.surface4 : colors.surface3,
        })}
      >
        <View style={{ opacity: off ? 0.3 : 1 }}>
          <Icon name={sign < 0 ? 'minus' : 'plus'} size={20} color={colors.ink} />
        </View>
      </Touchable>
    );
  };
  return (
    <View style={stacked ? { gap: space.space2 } : { flexDirection: 'row', alignItems: 'center', gap: space.space4 }}>
      <View style={stacked ? { gap: 2 } : { flex: 1, gap: 2 }}>
        <Text style={[theme.type.subheading, { color: colors.ink }]}>{label}</Text>
        {hint ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{hint}</Text> : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignSelf: stacked ? 'flex-start' : 'center',
          minHeight: theme.size.controlLg,
          borderWidth: hairline,
          borderColor: colors.lineStrong,
          borderRadius: theme.radius.radiusLg,
          backgroundColor: colors.surface0,
          overflow: 'hidden',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {button(-1)}
        <View
          accessible
          accessibilityLabel={`${label}: ${value} ${unit}`}
          style={{
            minWidth: 72,
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'center',
            alignSelf: 'center',
            gap: 4,
            paddingHorizontal: space.space2,
            borderLeftWidth: hairline,
            borderRightWidth: hairline,
            borderColor: colors.lineStrong,
          }}
        >
          <Text style={[theme.type.subheading, { fontFamily: theme.type.readoutSm.fontFamily, fontVariant: ['tabular-nums'], color: colors.ink }]}>
            {value}
          </Text>
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
        {button(1)}
      </View>
    </View>
  );
}
