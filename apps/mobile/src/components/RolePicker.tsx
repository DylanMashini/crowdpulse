import type { DeviceRole } from '@triagecam/contracts';
import { View } from 'react-native';

import { hairline } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

// Each hint says what the phone will do in that role, in one sentence. The patient role of the
// design system belongs to the video-visit mode, which this pass does not build.
const ROLES: { id: DeviceRole; icon: IconName; label: string; hint: string }[] = [
  { id: 'camera', icon: 'camera', label: 'Camera', hint: 'Mounted phone. Measures a seated patient.' },
  { id: 'nurse', icon: 'list', label: 'Nurse', hint: 'Worklist, flags and patient records' },
];

type Props = {
  /** Null until the person chooses. Nothing is selected by default. */
  value: DeviceRole | null;
  onChange: (role: DeviceRole) => void;
  disabled?: boolean;
};

/** The choice between the app's roles. The chosen one steps up a surface and its icon turns ice. */
export function RolePicker({ value, onChange, disabled }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Role" style={{ gap: space.space2 }}>
      {ROLES.map((role) => {
        const on = value === role.id;
        return (
          <Touchable
            key={role.id}
            onPress={() => onChange(role.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${role.label}. ${role.hint}`}
            accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.space3,
              minHeight: 72,
              paddingVertical: space.space3,
              paddingHorizontal: space.space4,
              borderWidth: hairline,
              borderColor: on ? colors.lineStrong : colors.line,
              borderRadius: theme.radius.radiusXl,
              backgroundColor: on || pressed ? colors.surface3 : colors.surface2,
              opacity: disabled ? 0.4 : 1,
            })}
          >
            <Icon name={role.icon} size={20} color={on ? colors.signal : colors.inkMuted} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.type.subheading, { color: colors.ink }]}>{role.label}</Text>
              <Text style={[theme.type.dense, { color: colors.inkMuted }]}>{role.hint}</Text>
            </View>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: on ? 0 : 1.5,
                borderColor: colors.lineHover,
                backgroundColor: on ? colors.signalStrong : 'transparent',
              }}
            >
              {on ? <Icon name="check" size={12} color={colors.onSignal} /> : null}
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}
