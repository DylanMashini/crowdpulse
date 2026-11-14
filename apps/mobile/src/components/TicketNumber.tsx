import { Text, View } from 'react-native';

import { fonts } from '@/theme';

import { useScopedTheme } from './ThemeScope';

type Props = {
  number: number;
  /** `sm` in rows, `md` in cards, `lg` in headers, `xl` on the screen the patient reads. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

/** The anonymous ticket number, the only identifier on any screen. Always preceded by the word. */
export function TicketNumber({ number, size = 'md' }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const digits = {
    sm: { fontFamily: fonts.mono[600], fontSize: 17, lineHeight: 22 },
    md: { fontFamily: fonts.mono[600], fontSize: 22, lineHeight: 28 },
    lg: theme.type.readoutLg,
    xl: theme.type.readoutXl,
  }[size];
  const stacked = size === 'xl';
  return (
    <View
      accessible
      accessibilityLabel={`Ticket ${number}`}
      style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'baseline', gap: stacked ? 0 : 6 }}
    >
      <Text
        style={
          stacked
            ? [theme.type.bodyTouch, { fontFamily: fonts.sans[500], color: colors.inkMuted }]
            : [theme.type.label, { color: colors.inkMuted }]
        }
      >
        Ticket
      </Text>
      <Text style={[digits, { color: colors.ink, fontVariant: ['tabular-nums'] }]}>{number}</Text>
    </View>
  );
}
