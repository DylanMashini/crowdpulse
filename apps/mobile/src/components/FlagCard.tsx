import type { Flag } from '@triagecam/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/lib/api';
import { sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { flagAcknowledgedText, flagOpenedText, flagRuleLabel } from '@/lib/nurse/nurseFormat';
import { fonts } from '@/theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { PatientIdentity } from './PatientIdentity';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  flag: Flag;
  /** Leaves the patient's face and name out, on the patient's own screen. */
  hidePatient?: boolean;
  /** Opens the patient. Left out on the patient's own screen. */
  onOpen?: () => void;
};

/**
 * One flag episode: who, why (the handoff sentence, with the numbers it was raised on), and
 * the acknowledgement, made in place. Acknowledging says "I have seen this"; it does not close
 * the flag, which closes when an observation is back inside the thresholds.
 */
export function FlagCard({ flag, hidePatient, onOpen }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { acknowledge, now } = useNurse();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const closed = flag.closedAt != null;
  const waiting = !closed && flag.acknowledgedAt == null;
  const overdue = flag.rule === 'overdue';

  const press = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await acknowledge(flag.id);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  // A flag that still needs someone carries the heavy outline; one that has been seen steps back.
  const border = waiting ? 2 : 1;
  return (
    <View
      style={{
        padding: space.space4 - (border - 1),
        gap: space.space3,
        borderWidth: border,
        borderColor: waiting ? (overdue ? colors.ink : colors.flag) : colors.line,
        borderRadius: theme.radius.radiusXl,
        backgroundColor: colors.surfaceRaised,
      }}
    >
      {hidePatient ? null : (
        <Touchable
          onPress={onOpen}
          disabled={!onOpen}
          accessibilityRole="button"
          accessibilityHint="Opens the patient"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.space2,
            minHeight: theme.size.controlTouch,
            borderRadius: theme.radius.radiusMd,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <PatientIdentity patient={flag.patient} size="md" />
          {onOpen ? <Icon name="chevron" size={20} color={colors.inkMuted} /> : null}
        </Touchable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
        <StatusBadge state={overdue ? 'overdue' : 'flag'} label={flagRuleLabel(flag.rule)} />
        <Text style={[theme.type.caption, { color: colors.inkMuted, fontVariant: ['tabular-nums'] }]}>
          {closed && flag.closedAt ? `${flagOpenedText(flag, now)}, closed` : flagOpenedText(flag, now)}
        </Text>
      </View>
      <Text style={[theme.type.bodyTouch, { color: colors.ink }]}>{flag.handoff}</Text>
      {flag.acknowledgedAt ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.space2 }}>
          <View style={{ paddingTop: 2 }}>
            <Icon name="check" size={18} color={colors.inkMuted} />
          </View>
          <Text style={[theme.type.body, { flex: 1, fontFamily: fonts.sans[500], color: colors.inkMuted }]}>
            {flagAcknowledgedText(flag, now)}
          </Text>
        </View>
      ) : closed ? (
        <Text style={[theme.type.body, { color: colors.inkMuted }]}>Closed without an acknowledgement</Text>
      ) : (
        <Button
          variant="primary"
          block
          label={busy ? 'Acknowledging' : 'Acknowledge'}
          disabled={busy}
          accessibilityHint="Records that you have seen this flag"
          onPress={() => void press()}
        />
      )}
      {failure ? (
        <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: colors.critical }]}>
          {sentences('Not acknowledged', failure)}
        </Text>
      ) : null}
    </View>
  );
}
