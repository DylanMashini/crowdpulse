import { patientLabel, routes, type PatientRef } from '@triagecam/contracts';
import { useState } from 'react';
import { Image, View, useWindowDimensions } from 'react-native';

import { api, authHeaders } from '@/lib/api';
import { hairline, weight } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const AVATAR: Record<Size, number> = { sm: 32, md: 40, lg: 48, xl: 72 };

/** "Maya Chen" gives MC, "Okafor" gives O. Null when there is no name to take letters from. */
export function initialsOf(name: string | null): string | null {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const first = words[0];
  if (!first) return null;
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return ((first[0] ?? '') + (last?.[0] ?? '')).toUpperCase();
}

/** The profile photo taken at intake, or the patient's initials until there is one. */
export function PatientAvatar({ patient, size = 'md' }: { patient: PatientRef; size?: Size }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const side = AVATAR[size];
  const uri = patient.photoUpdatedAt
    ? `${api.baseUrl}${routes.patientPhoto(patient.number)}?v=${encodeURIComponent(patient.photoUpdatedAt)}`
    : null;
  // A photo that will not load falls back to the initials rather than an empty circle.
  const [failed, setFailed] = useState<string | null>(null);
  const initials = initialsOf(patient.name);
  const letters = { sm: theme.type.caption, md: theme.type.label, lg: theme.type.subheading, xl: theme.type.heading }[size];
  return (
    <View
      accessible={false}
      style={{
        width: side,
        height: side,
        borderRadius: side / 2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface4,
        borderWidth: hairline,
        borderColor: colors.lineStrong,
      }}
    >
      {uri && failed !== uri ? (
        <Image
          source={{ uri, headers: authHeaders() }}
          onError={() => setFailed(uri)}
          style={{ width: side, height: side }}
          resizeMode="cover"
        />
      ) : initials ? (
        // The circle is a fixed size, so its letters do not grow past it.
        <Text maxFontSizeMultiplier={1.2} style={[letters, { fontWeight: weight.medium, letterSpacing: 0, color: colors.inkMuted }]}>
          {initials}
        </Text>
      ) : (
        <Icon name="user" size={side >= 48 ? 20 : side >= 40 ? 18 : 16} color={colors.inkFaint} />
      )}
    </View>
  );
}

type Props = {
  patient: PatientRef;
  /** `sm` in rows, `md` in cards, `lg` in headers, `xl` on the screen the patient reads. */
  size?: Size;
  /** A line under the name, after the visit number: the reason for the visit, the age. */
  detail?: string | null;
  /** A third line, for a row in a list: where the patient stands, in words. */
  status?: string;
  /** The name in white, on an urgent card only. */
  bright?: boolean;
};

/** Who a card or a screen is about: the face, the name, then the short visit number. */
export function PatientIdentity({ patient, size = 'md', detail, status, bright }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  // At the larger accessibility sizes one line holds a few letters: the name gets two.
  const lines = useWindowDimensions().fontScale > 1.3 ? 2 : 1;
  const named = Boolean(patient.name?.trim());
  const name = { sm: theme.type.subheading, md: theme.type.subheading, lg: theme.type.heading, xl: theme.type.title }[size];
  const second = [named ? `No. ${patient.number}` : 'Name not entered yet', detail?.trim() || null].filter(Boolean).join(', ');
  return (
    <View
      accessible
      accessibilityLabel={`${patientLabel(patient)}, visit number ${patient.number}${detail ? `, ${detail}` : ''}${status ? `, ${status}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space3, flexShrink: 1 }}
    >
      <PatientAvatar patient={patient} size={size} />
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={lines} style={[name, { color: !named ? colors.inkMuted : bright ? colors.inkBright : colors.ink }]}>
          {patientLabel(patient)}
        </Text>
        <Text
          numberOfLines={lines}
          style={[size === 'sm' || size === 'md' ? theme.type.caption : theme.type.dense, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}
        >
          {second}
        </Text>
        {status ? (
          <Text style={[theme.type.caption, { marginTop: 2, color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>{status}</Text>
        ) : null}
      </View>
    </View>
  );
}
