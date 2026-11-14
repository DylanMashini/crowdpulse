import { useColorScheme } from 'react-native';

import { type ThemeName, colors, radius, shadow, size, space, type } from './tokens';

export * from './tokens';

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
 * The theme for a screen. The nurse role follows the device setting; the camera role passes
 * 'dark', because it is always dark.
 */
export function useTheme(forced?: ThemeName): Theme {
  const scheme = useColorScheme();
  return themeFor(forced ?? (scheme === 'dark' ? 'dark' : 'light'));
}
