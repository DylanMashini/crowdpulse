import { View } from 'react-native';

import type { Severity } from '@/lib/nurse/severity';
import { hairline, weight } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** `live` is not a severity: it marks a sitting that is running now. */
  severity: Severity | 'live';
  /** The state in words. A chip never rests on its colour. */
  label: string;
};

/**
 * The state of one patient or one flag: a square-cornered chip with a dot and a word. Stable is
 * a cool grey, watch amber, urgent the one solid red in the product, overdue the inverse of the
 * page, and no reading a dashed outline, so each differs by fill and lightness as well as hue.
 */
export function StatusBadge({ severity, label }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const look = {
    stable: { text: colors.stable, fill: colors.stableSoft },
    watch: { text: colors.watch, fill: colors.watchSoft },
    urgent: { text: colors.onUrgent, fill: colors.urgent },
    overdue: { text: colors.onOverdue, fill: colors.overdue },
    none: { text: colors.inkMuted, fill: 'transparent' },
    live: { text: colors.signal, fill: colors.signalSoft },
  }[severity];
  const outlined = severity === 'none';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        flexShrink: 1,
        gap: 6,
        minHeight: 22,
        paddingVertical: 2,
        paddingHorizontal: theme.space.space2,
        borderRadius: theme.radius.radiusSm,
        borderWidth: outlined ? 1 : hairline,
        borderStyle: outlined ? 'dashed' : 'solid',
        borderColor: outlined ? colors.lineStrong : 'transparent',
        backgroundColor: look.fill,
      }}
    >
      {severity === 'overdue' ? (
        <Icon name="clock" size={12} color={look.text} />
      ) : outlined ? null : (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: look.text,
            boxShadow: severity === 'live' ? theme.shadow.glowLive : undefined,
          }}
        />
      )}
      <Text style={[theme.type.caption, { flexShrink: 1, fontWeight: weight.medium, color: look.text }]}>{label}</Text>
    </View>
  );
}
