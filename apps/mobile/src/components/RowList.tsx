import type { ReactNode } from 'react';
import { View } from 'react-native';

import { hairline } from '@/theme';

import { Card } from './Card';
import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

/** Rows that belong together, in one card with a hairline between them. */
export function RowList({ children }: { children: ReactNode }) {
  return <Card flush>{children}</Card>;
}

type RowProps = {
  /** False for the first row, which has no line above it. */
  divided: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Draws the chevron of a row that opens another screen. */
  opens?: boolean;
  children: ReactNode;
};

/** One row of a RowList: a full-width touch target that steps up a surface while it is pressed. */
export function Row({ divided, onPress, accessibilityLabel, accessibilityHint, opens, children }: RowProps) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.space3,
        minHeight: 64,
        paddingVertical: space.space3,
        paddingLeft: space.space4,
        paddingRight: opens ? space.space3 : space.space4,
        borderTopWidth: divided ? hairline : 0,
        borderTopColor: colors.line,
        backgroundColor: pressed ? colors.surface3 : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>{children}</View>
      {opens ? <Icon name="chevron" size={16} color={colors.inkFaint} /> : null}
    </Touchable>
  );
}
