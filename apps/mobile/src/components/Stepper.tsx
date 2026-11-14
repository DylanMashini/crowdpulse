import { View } from 'react-native';

import { fonts } from '@/theme';

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

/** A number with its unit and a minus and a plus, for the few settings a nurse changes on a phone. */
export function Stepper({ label, hint, value, unit, min, max, step, onChange, disabled }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
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
        style={({ pressed }) => ({
          width: theme.size.controlTouch,
          height: theme.size.controlTouch,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.radiusMd,
          borderWidth: 1,
          borderColor: colors.lineStrong,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surfaceRaised,
          opacity: off ? 0.4 : 1,
        })}
      >
        <Text style={{ fontFamily: fonts.sans[500], fontSize: 24, lineHeight: 28, color: colors.ink }}>
          {sign < 0 ? '−' : '+'}
        </Text>
      </Touchable>
    );
  };
  return (
    // The words get the full width; the control sits under them, where a thumb reaches it.
    <View style={{ gap: space.space2 }}>
      <View>
        <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.ink }]}>{label}</Text>
        {hint ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{hint}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space2 }}>
        {button(-1)}
        <View
          accessible
          accessibilityLabel={`${label}: ${value} ${unit}`}
          style={{ minWidth: 76, alignItems: 'center' }}
        >
          <Text style={[theme.type.readoutMd, { color: colors.ink }]}>{value}</Text>
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{unit}</Text>
        </View>
        {button(1)}
      </View>
    </View>
  );
}
