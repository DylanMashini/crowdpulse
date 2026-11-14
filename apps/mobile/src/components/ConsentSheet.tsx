import { PRIVACY_FACE } from '@triagecam/contracts';
import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/useReducedMotion';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { PrivacyNote } from './PrivacyNote';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  visible: boolean;
  patient: number;
  /** Disables both buttons while the choice is being saved. */
  busy?: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * The opt-in for face match at check-in. Both buttons are `secondary` and the same size, with
 * the patient-number option first; neither is the default, and the sheet closes only by a choice.
 */
export function ConsentSheet(props: Props) {
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      visible={props.visible}
      transparent
      statusBarTranslucent
      animationType={reducedMotion ? 'none' : 'slide'}
      supportedOrientations={['portrait', 'landscape']}
      // The hardware back gesture is the same answer as declining: face match stays off.
      onRequestClose={props.onDecline}
    >
      <Sheet {...props} />
    </Modal>
  );
}

function Sheet({ patient, busy, onAccept, onDecline }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const insets = useSafeAreaInsets();
  const facts: { icon: IconName; text: string }[] = [
    { icon: 'scan', text: 'Used only to find your record when you sit down again' },
    { icon: 'trash', text: 'Deleted when you are discharged' },
    { icon: 'user', text: 'Your name always works instead' },
  ];
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: colors.scrim }}>
      <View
        accessibilityViewIsModal
        style={{
          width: '100%',
          maxWidth: 560,
          padding: space.space5,
          paddingBottom: space.space5 + insets.bottom,
          gap: space.space4,
          borderTopLeftRadius: theme.radius.radiusXl,
          borderTopRightRadius: theme.radius.radiusXl,
          backgroundColor: colors.surfaceRaised,
          boxShadow: theme.shadow.shadowOverlay,
        }}
      >
        <Text accessibilityRole="header" style={[theme.type.heading, { color: colors.ink }]}>
          Use face match for re-checks?
        </Text>
        <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>
          Face match lets you sit down again without giving your name. It is optional.
        </Text>
        <View style={{ gap: space.space3 }}>
          {facts.map((fact) => (
            <View key={fact.icon} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.space3 }}>
              <View style={{ paddingTop: 2 }}>
                <Icon name={fact.icon} size={20} color={colors.inkMuted} />
              </View>
              <Text style={[theme.type.bodyTouch, { flex: 1, color: colors.ink }]}>{fact.text}</Text>
            </View>
          ))}
        </View>
        <PrivacyNote>{PRIVACY_FACE}</PrivacyNote>
        <View style={{ gap: space.space2 }}>
          <Button variant="secondary" block label="No, use my name" onPress={onDecline} disabled={busy} />
          <Button variant="secondary" block label="Turn on face match" onPress={onAccept} disabled={busy} />
        </View>
      </View>
    </View>
  );
}
