import { View } from 'react-native';

import { fonts } from '@/theme';

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

/** Two to four views of one list, one of them always chosen. Each segment is a full touch target. */
export function Segmented<Value extends string>({ label, options, value, onChange }: Props<Value>) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 3,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: colors.surfaceSunken,
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
            style={{
              flex: 1,
              minHeight: theme.size.controlTouch - 6,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.space.space2,
              paddingVertical: theme.space.space1,
              borderRadius: theme.radius.radiusMd,
              borderWidth: 1,
              borderColor: on ? colors.lineStrong : 'transparent',
              backgroundColor: on ? colors.surfaceRaised : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={[
                theme.type.body,
                { textAlign: 'center', fontFamily: fonts.sans[on ? 600 : 400], color: on ? colors.ink : colors.inkMuted },
              ]}
            >
              {option.label}
              {option.count != null ? (
                <Text style={{ fontFamily: fonts.sans[400], color: colors.inkMuted, fontVariant: ['tabular-nums'] }}>
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
