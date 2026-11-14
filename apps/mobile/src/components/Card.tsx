import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { type Theme, hairline } from '@/theme';

import { useScopedTheme } from './ThemeScope';

type Props = {
  children: ReactNode;
  /** `urgent` is the tinted card of a patient or flag that is urgent. Nothing else is tinted. */
  tone?: 'plain' | 'urgent';
  /** Rows that bring their own padding and dividers, such as a list of patients. */
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The fill, outline and corner of a card, for a card that is itself a touch target. */
export function cardStyle(theme: Theme, tone: 'plain' | 'urgent', pressed = false): ViewStyle {
  const { colors } = theme;
  const urgent = tone === 'urgent';
  return {
    borderWidth: hairline,
    borderColor: urgent ? colors.urgentLine : colors.line,
    borderRadius: theme.radius.radiusXl,
    backgroundColor: urgent ? (pressed ? colors.urgentSoftHover : colors.urgentSoft) : pressed ? colors.surface3 : colors.surface2,
  };
}

/** One step up from the screen: `surface-2`, a hairline, the mobile card radius. Never nested. */
export function Card({ children, tone = 'plain', flush, style }: Props) {
  const theme = useScopedTheme();
  return (
    <View
      style={[
        cardStyle(theme, tone),
        { padding: flush ? 0 : theme.space.space4, gap: flush ? 0 : theme.space.space4, overflow: flush ? 'hidden' : 'visible' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A hairline between two groups inside one card. */
export function Divider() {
  const theme = useScopedTheme();
  return <View style={{ height: hairline, backgroundColor: theme.colors.line }} />;
}
