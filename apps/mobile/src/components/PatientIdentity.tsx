import { patientLabel, routes, type PatientRef } from '@triagecam/contracts';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { api, authHeaders } from '@/lib/api';
import { fonts } from '@/theme';

import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const AVATAR: Record<Size, number> = { sm: 32, md: 40, lg: 56, xl: 88 };

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
  const { colors } = useScopedTheme();
  const side = AVATAR[size];
  const uri = patient.photoUpdatedAt
    ? `${api.baseUrl}${routes.patientPhoto(patient.number)}?v=${encodeURIComponent(patient.photoUpdatedAt)}`
    : null;
  // A photo that will not load falls back to the initials rather than an empty circle.
  const [failed, setFailed] = useState<string | null>(null);
  const initials = initialsOf(patient.name);
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
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.line,
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
        <Text style={{ fontFamily: fonts.sans[600], fontSize: Math.round(side * 0.36), color: colors.inkMuted }}>{initials}</Text>
      ) : (
        <Icon name="user" size={side >= 56 ? 20 : side >= 40 ? 18 : 16} color={colors.inkMuted} />
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
};

/** Who a card or a screen is about: the face, the name, then the short visit number. */
export function PatientIdentity({ patient, size = 'md', detail }: Props) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const named = Boolean(patient.name?.trim());
  const name = {
    sm: { fontFamily: fonts.sans[600], fontSize: 16, lineHeight: 20 },
    md: { fontFamily: fonts.sans[600], fontSize: 18, lineHeight: 24 },
    lg: { fontFamily: fonts.sans[600], fontSize: 24, lineHeight: 30 },
    xl: { fontFamily: fonts.sans[600], fontSize: 30, lineHeight: 36 },
  }[size];
  const second = [named ? `No. ${patient.number}` : 'Name not entered yet', detail?.trim() || null].filter(Boolean).join(' · ');
  return (
    <View
      accessible
      accessibilityLabel={`${patientLabel(patient)}, visit number ${patient.number}${detail ? `, ${detail}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.space3, flexShrink: 1 }}
    >
      <PatientAvatar patient={patient} size={size} />
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={[name, { color: named ? colors.ink : colors.inkMuted }]}>
          {patientLabel(patient)}
        </Text>
        <Text numberOfLines={1} style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
          {second}
        </Text>
      </View>
    </View>
  );
}
