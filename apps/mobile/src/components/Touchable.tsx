import { type ReactNode, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useScopedTheme } from './ThemeScope';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
};

/**
 * Pressable with the design system's one focus ring: 2px solid `focus`, offset 2px, shown
 * while a hardware keyboard or switch control has focus on it.
 */
export function Touchable({ style, children, onFocus, onBlur, ...rest }: Props) {
  const theme = useScopedTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...rest}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        focused && { outlineColor: theme.colors.focus, outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid' },
      ]}
    >
      {children}
    </Pressable>
  );
}
