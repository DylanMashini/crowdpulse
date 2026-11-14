import type { ReactNode } from 'react';
import { View } from 'react-native';

import { tidy } from '@/lib/format';

import { Card } from './Card';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** What happened. */
  title: string;
  /** What to do next. */
  body?: string;
  /** Usually one Button. */
  children?: ReactNode;
};

/**
 * Loading, empty and error states. It says what happened and what to do next. A title on its
 * own (something is loading) is one quiet line, not a card.
 */
export function Notice({ title, body, children }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  if (!body && !children) {
    return (
      <Text accessibilityLiveRegion="polite" style={[theme.type.body, { color: colors.inkMuted }]}>
        {title}
      </Text>
    );
  }
  return (
    <View accessibilityLiveRegion="polite">
      <Card>
        <View style={{ gap: theme.space.space1 }}>
          <Text style={[theme.type.subheading, { color: colors.ink }]}>{title}</Text>
          {body ? <Text style={[theme.type.body, { color: colors.inkMuted }]}>{tidy(body)}</Text> : null}
        </View>
        {children ? <View style={{ gap: theme.space.space2 }}>{children}</View> : null}
      </Card>
    </View>
  );
}
