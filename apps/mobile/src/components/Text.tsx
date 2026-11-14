import { Text as NativeText, type TextProps } from 'react-native';

/**
 * How far text follows the system's text size. Up to here every screen keeps its layout and
 * its hierarchy; past it a title breaks mid-word and a 48-point control clips its own label.
 */
export const MAX_TEXT_SCALE = 1.6;

/**
 * React Native's Text, growing with the system text size up to MAX_TEXT_SCALE. Every screen
 * uses this one, so the limit is in one place. A caller can still pass its own limit.
 */
export function Text(props: TextProps) {
  return <NativeText maxFontSizeMultiplier={MAX_TEXT_SCALE} {...props} />;
}
