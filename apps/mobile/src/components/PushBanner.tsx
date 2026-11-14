import { Text, View } from 'react-native';

import { sentences } from '@/lib/format';
import { fonts } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

type Props = {
  /** "Trend flag, patient 14": the same words as the system push. */
  title: string;
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

/** A flag arriving on the nurse phone. A prompt to walk over, not an alarm. */
export function PushBanner(props: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { acknowledged } = props;
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: space.space4,
        gap: space.space2,
        borderRadius: theme.radius.radiusXl,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surfaceRaised,
        boxShadow: theme.shadow.shadowOverlay,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space2 }}>
        <Icon name={acknowledged ? 'check' : 'flag'} size={18} color={acknowledged ? colors.inkMuted : colors.flag} />
        <Text style={[theme.type.bodyTouch, { flex: 1, fontFamily: fonts.sans[600], color: colors.ink }]}>
          {props.title}
        </Text>
        <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{props.time}</Text>
        <Touchable
          onPress={props.onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close this notice"
          hitSlop={{ top: 16, bottom: 16, left: 4, right: 4 }}
          style={{ minWidth: theme.size.controlTouch, alignItems: 'flex-end', borderRadius: theme.radius.radiusMd }}
        >
          <Text style={[theme.type.label, { color: colors.signal }]}>Close</Text>
        </Touchable>
      </View>
      <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>{props.body}</Text>
      {props.error ? (
        <Text style={[theme.type.caption, { color: colors.ink }]}>{sentences('Not acknowledged', props.error)}</Text>
      ) : null}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2, marginTop: space.space2 }}
      >
        {acknowledged ? (
          <View style={{ height: theme.size.controlTouch, justifyContent: 'center', paddingHorizontal: space.space3 }}>
            <Text style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.inkMuted }]}>
              Acknowledged
            </Text>
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
