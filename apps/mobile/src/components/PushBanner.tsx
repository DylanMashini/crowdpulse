import type { PatientRef } from '@triagecam/contracts';
import { View } from 'react-native';

import { sentences } from '@/lib/format';
import { hairline } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { PatientAvatar } from './PatientIdentity';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  /** Who the flag is about: their photo, or their initials, leads the banner. */
  patient: PatientRef;
  /** "Trend flag: Maya Chen": the same words as the system push. */
  title: string;
  /** The heading takes the flag's severity colour. An overdue re-check stays `ink`. */
  severity: 'watch' | 'urgent' | 'overdue';
  /** Clock time the flag opened. */
  time: string;
  /** The templated handoff sentence. */
  body: string;
  acknowledged: boolean;
  /** Set while the request is in the air or after it failed. */
  acknowledging?: boolean;
  error?: string | null;
  onAcknowledge: () => void;
  onOpen: () => void;
  onDismiss: () => void;
};

/**
 * A flag arriving on the nurse phone: an overlay, the highest surface with the one shadow in the
 * app. A prompt to walk over, not an alarm, so the card itself is never red.
 */
export function PushBanner(props: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { acknowledged } = props;
  const heading = { urgent: colors.urgent, watch: colors.watch, overdue: colors.ink }[props.severity];
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: space.space4,
        gap: space.space3,
        borderRadius: theme.radius.radiusXl,
        borderWidth: hairline,
        borderColor: colors.lineStrong,
        backgroundColor: colors.surface3,
        boxShadow: theme.shadow.shadowOverlay,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space3 }}>
        <PatientAvatar patient={props.patient} size="sm" />
        <View style={{ flex: 1 }}>
          <Text style={[theme.type.subheading, { color: heading }]}>{props.title}</Text>
          <Text style={[theme.type.caption, { color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>{props.time}</Text>
        </View>
        <Touchable
          onPress={props.onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close this notice"
          hitSlop={8}
          style={({ pressed }) => ({
            width: theme.size.controlMd,
            height: theme.size.controlMd,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.radiusLg,
            backgroundColor: pressed ? colors.surface4 : 'transparent',
          })}
        >
          <Icon name="close" size={18} color={colors.inkMuted} />
        </Touchable>
      </View>
      <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>{props.body}</Text>
      {props.error ? (
        <Text style={[theme.type.caption, { color: colors.urgent }]}>{sentences('Not acknowledged', props.error)}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2 }}>
        {acknowledged ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space2, height: theme.size.controlTouch, paddingRight: space.space3 }}>
            <Icon name="check" size={18} color={colors.inkMuted} />
            <Text style={[theme.type.subheading, { color: colors.inkMuted }]}>Acknowledged</Text>
          </View>
        ) : (
          <Button
            variant="primary"
            label={props.acknowledging ? 'Acknowledging' : 'Acknowledge'}
            disabled={props.acknowledging}
            onPress={props.onAcknowledge}
          />
        )}
        <Button variant="quiet" label="Open patient" onPress={props.onOpen} />
      </View>
    </View>
  );
}
