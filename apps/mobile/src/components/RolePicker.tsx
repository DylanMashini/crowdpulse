import type { DeviceRole } from '@triagecam/contracts';
import { Text, View } from 'react-native';

import { fonts } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

// Each hint says what the phone will do in that role, in one sentence. The patient role of the
// design system belongs to the video-visit mode, which this pass does not build.
const ROLES: { id: DeviceRole; icon: IconName; label: string; hint: string }[] = [
  { id: 'camera', icon: 'camera', label: 'Camera', hint: 'Mounted phone. Measures a seated patient.' },
  { id: 'nurse', icon: 'list', label: 'Nurse', hint: 'Worklist and flag notifications' },
];

type Props = {
  /** Null until the person chooses. Nothing is selected by default. */
  value: DeviceRole | null;
  onChange: (role: DeviceRole) => void;
  disabled?: boolean;
};

export function RolePicker({ value, onChange, disabled }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Role" style={{ gap: space.space2 }}>
      {ROLES.map((role) => {
        const on = value === role.id;
        const border = on ? 2 : 1;
        return (
          <Touchable
            key={role.id}
            onPress={() => onChange(role.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${role.label}. ${role.hint}`}
            accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.space4,
              minHeight: 72,
              paddingVertical: space.space3 - (border - 1),
              paddingHorizontal: space.space4 - (border - 1),
              borderWidth: border,
              borderColor: on ? colors.signal : colors.lineStrong,
              borderRadius: theme.radius.radiusXl,
              backgroundColor: on ? colors.signalSoft : colors.surfaceRaised,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Icon name={role.icon} size={20} color={on ? colors.signal : colors.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.ink }]}>{role.label}</Text>
              <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{role.hint}</Text>
            </View>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: on ? 6 : 2,
                borderColor: on ? colors.signal : colors.lineStrong,
              }}
            />
          </Touchable>
        );
      })}
    </View>
  );
}
