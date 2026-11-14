import { View } from 'react-native';

import { hairline, weight } from '@/theme';

import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Option<Value extends string> = { value: Value; label: string; count?: number };

type Props<Value extends string> = {
  /** What is being chosen, for VoiceOver. */
  label: string;
  options: Option<Value>[];
  value: Value;
  onChange: (value: Value) => void;
};

/**
 * Two to four views of one list, one of them always chosen. A `surface-0` well; the chosen
 * segment is one step of surface with a highlight along its top edge.
 */
export function Segmented<Value extends string>({ label, options, value, onChange }: Props<Value>) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: 2,
        gap: 2,
        borderWidth: hairline,
        borderColor: colors.line,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: colors.surface0,
      }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Touchable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.count != null ? `${option.label}, ${option.count}` : option.label}
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: theme.size.controlLg,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.space.space2,
              paddingVertical: theme.space.space1,
              borderRadius: theme.radius.radiusMd + 2,
              backgroundColor: on ? colors.surface3 : pressed ? colors.surface2 : 'transparent',
              boxShadow: on ? `inset 0 1px 0 ${colors.lineStrong}` : undefined,
            })}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[
                theme.type.body,
                { textAlign: 'center', fontWeight: on ? weight.medium : weight.normal, color: on ? colors.ink : colors.inkMuted },
              ]}
            >
              {option.label}
              {option.count != null ? (
                <Text style={{ fontWeight: weight.normal, color: colors.inkFaint, fontVariant: ['tabular-nums'] }}>
                  {`  ${option.count}`}
                </Text>
              ) : null}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}
