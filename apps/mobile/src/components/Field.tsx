import { type Ref, useState } from 'react';
import { TextInput, type TextInputInstance, type TextInputProps, View } from 'react-native';

import { tidy } from '@/lib/format';

import { useScopedTheme } from './ThemeScope';
import { MAX_TEXT_SCALE, Text } from './Text';

type Props = Omit<TextInputProps, 'style' | 'placeholder'> & {
  /** Always visible. The unit goes in `unit`, never here. */
  label: string;
  unit?: string;
  hint?: string;
  /** What is wrong and what is allowed: "Enter 5 to 60 minutes". */
  error?: string | null;
  ref?: Ref<TextInputInstance>;
};

/** The design system's Field at its `touch` size. */
export function Field({ label, unit, hint, error, onFocus, onBlur, ref, ...input }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: theme.space.space1, alignSelf: 'stretch' }}>
      <Text style={[theme.type.label, { color: colors.ink }]}>{label}</Text>
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            height: theme.size.controlTouch,
            borderWidth: error ? 2 : 1,
            borderColor: error ? colors.critical : colors.lineStrong,
            borderRadius: theme.radius.radiusMd,
            backgroundColor: colors.surfaceRaised,
          },
          focused && { outlineColor: colors.focus, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' },
        ]}
      >
        <TextInput
          {...input}
          ref={ref}
          accessibilityLabel={unit ? `${label}, ${unit}` : label}
          accessibilityHint={error ?? hint}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          selectionColor={colors.signal}
          style={[
            theme.type.bodyTouch,
            {
              flex: 1,
              height: '100%',
              paddingHorizontal: theme.space.space3,
              paddingVertical: 0,
              // A line height on a single-line input pushes the text off centre on iOS.
              lineHeight: undefined,
              color: colors.ink,
              fontVariant: ['tabular-nums'],
            },
          ]}
        />
        {unit ? (
          <Text style={[theme.type.caption, { paddingRight: theme.space.space3, color: colors.inkMuted }]}>{unit}</Text>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.type.label, { lineHeight: 18, color: colors.critical }]}>
          {tidy(error)}
        </Text>
      ) : hint ? (
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}
