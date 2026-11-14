import { PRIVACY_CAPTURE } from '@triagecam/contracts';
import { Text, View } from 'react-native';
import type { ThermalState } from 'triage-capture';

import { fonts } from '@/theme';

import { Icon } from './Icon';
import { PrivacyNote } from './PrivacyNote';
import { useScopedTheme } from './ThemeScope';

const THERMAL: Record<ThermalState, string> = {
  nominal: 'Normal',
  fair: 'Warm',
  serious: 'Hot, slowing down',
  critical: 'Too hot',
};

/** More dropped frames than this in one sitting is outside the expected range. */
const DROPPED_FRAMES_LIMIT = 30;

type Props = {
  /** Null before the capture module has reported. */
  fps: number | null;
  dropped: number;
  exposureLocked: boolean;
  thermal: ThermalState;
};

/**
 * What the operator needs to trust a sitting, with the privacy line. A value outside its
 * expected range turns `flag` and gains the flag icon.
 */
export function CaptureStatus({ fps, dropped, exposureLocked, thermal }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const items = [
    { label: 'Frame rate', value: fps == null ? 'Starting' : `${Math.round(fps)} fps`, warn: false },
    { label: 'Dropped frames', value: String(dropped), warn: dropped > DROPPED_FRAMES_LIMIT },
    { label: 'Exposure', value: exposureLocked ? 'Locked' : 'Settling', warn: !exposureLocked },
    { label: 'Phone temperature', value: THERMAL[thermal], warn: thermal === 'serious' || thermal === 'critical' },
  ];
  return (
    <View style={{ gap: space.space3 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.space3 }}>
        {items.map((item) => (
          <View
            key={item.label}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}${item.warn ? ', outside the expected range' : ''}`}
            style={{ width: '50%', paddingRight: space.space3 }}
          >
            <Text style={[theme.type.caption, { lineHeight: 16, color: colors.inkMuted }]}>{item.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {item.warn ? <Icon name="flag" size={16} color={colors.flag} /> : null}
              <Text
                style={[
                  theme.type.bodyTouch,
                  {
                    flexShrink: 1,
                    fontFamily: fonts.sans[500],
                    color: item.warn ? colors.flag : colors.ink,
                    fontVariant: ['tabular-nums'],
                  },
                ]}
              >
                {item.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <PrivacyNote>{PRIVACY_CAPTURE}</PrivacyNote>
    </View>
  );
}
