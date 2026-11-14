import { StyleSheet } from 'react-native';

import { type ThemeName, colors, radius, shadow, size, space, type } from './tokens';

export * from './tokens';

/** The width of every divider and outline: one device pixel, in the `line` colours. */
export const hairline = StyleSheet.hairlineWidth;

export type Theme = {
  name: ThemeName;
  colors: (typeof colors)[ThemeName];
  shadow: (typeof shadow)[ThemeName];
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  size: typeof size;
};

export function themeFor(name: ThemeName): Theme {
  return { name, colors: colors[name], shadow: shadow[name], type, space, radius, size };
}

/**
 * The theme for a screen. Night Shift is dark only, so both device appearances get the same
 * theme. The argument is kept so the camera role's `useTheme('dark')` still compiles.
 */
export function useTheme(forced?: ThemeName): Theme {
  return themeFor(forced ?? 'dark');
}
