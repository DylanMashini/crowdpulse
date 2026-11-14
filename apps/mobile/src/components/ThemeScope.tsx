import { type ReactNode, createContext, useContext } from 'react';

import { type Theme, type ThemeName, useTheme } from '@/theme';

const ThemeContext = createContext<Theme | null>(null);

/** Forces a theme for everything inside it. The camera role wraps its screens in `dark`. */
export function ThemeScope({ name, children }: { name: ThemeName; children: ReactNode }) {
  const theme = useTheme(name);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** The theme of the nearest ThemeScope, or the device setting outside one. */
export function useScopedTheme(): Theme {
  const device = useTheme();
  return useContext(ThemeContext) ?? device;
}
