import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { tidy } from '@/lib/format';

import { useScopedTheme } from './ThemeScope';

type Props = {
  /** What happened. */
  title: string;
  /** What to do next. */
  body?: string;
  /** Usually one Button. */
  children?: ReactNode;
};

/** An outlined panel for loading, empty and error states. It says what happened and what to do next. */
export function Notice({ title, body, children }: Props) {
  const theme = useScopedTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: theme.space.space4,
        gap: theme.space.space2,
        borderWidth: 1,
        borderColor: theme.colors.line,
        borderRadius: theme.radius.radiusLg,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text style={[theme.type.subheading, { color: theme.colors.ink }]}>{title}</Text>
      {body ? <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>{tidy(body)}</Text> : null}
      {children ? <View style={{ marginTop: theme.space.space2, gap: theme.space.space2 }}>{children}</View> : null}
    </View>
  );
}
