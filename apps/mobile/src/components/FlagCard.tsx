import { byFlagRule, type FlagAlert, type FlagRule, hasReCheckBaseline } from '@triagecam/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/lib/api';
import { sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { flagAcknowledgedText, flagOpenedText, flagRuleLabel } from '@/lib/nurse/nurseFormat';
import { alertSeverity } from '@/lib/nurse/severity';

import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { PatientIdentity } from './PatientIdentity';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Text } from './Text';

type Props = {
  /** The flags of one alert (`flagAlerts`). The card never shows a single rule's flag alone. */
  alert: FlagAlert;
  /** Leaves the patient's face and name out, on the patient's own screen. */
  hidePatient?: boolean;
  /** Opens the patient. Left out on the patient's own screen. */
  onOpen?: () => void;
  /**
   * The alert's handoff sentence is written when it opens and does not change after.
   * `show` prints it. `whenFlagged` prints it under those words, for a flag that has closed.
   * `hide` leaves it out where the patient's current handoff is printed beside the card.
   */
  sentence?: 'show' | 'whenFlagged' | 'hide';
};

/**
 * One alert: who, why (the handoff sentence with the numbers it was raised on, one chip in the
 * alert's severity and the rules it tripped in words), and the acknowledgement, made in place once for the whole alert.
 * Acknowledging says "I have seen this"; it does not close the flag, which closes when an
 * observation is back inside the thresholds.
 *
 * An urgent alert nobody has acknowledged is the tinted card. Once it has been seen it steps
 * back to the plain card and keeps its chip; once it has closed the chip goes grey too.
 */
export function FlagCard({ alert, hidePatient, onOpen, sentence = 'show' }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { acknowledge, now } = useNurse();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const flag = alert.lead;
  const closed = alert.closedAt != null;
  const waiting = alert.waiting.length > 0;
  // On the patient's own screen the handoff note above the card already carries the tint.
  // The alert has one severity, so it has one chip: the rule that sets it. Any other rule it
  // tripped is named beside the chip in plain text.
  const rules = [...new Set(alert.flags.map((each) => each.rule))].sort(byFlagRule);
  const leadRule = rules[0] ?? flag.rule;
  const otherRules = rules.slice(1);
  // A rule whose flag moved from a re-check's baseline does not say "check-in".
  const ruleLabel = (rule: FlagRule) =>
    flagRuleLabel(
      rule,
      alert.flags.some((each) => each.rule === rule && hasReCheckBaseline(each.detail)),
    );
  const tinted = waiting && !hidePatient && alertSeverity(alert) === 'urgent';

  const press = async () => {
    // Any one of its flags: the server acknowledges the rest of the alert with it.
    const next = alert.waiting[0];
    if (!next) return;
    setBusy(true);
    setFailure(null);
    try {
      await acknowledge(next.id);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone={tinted ? 'urgent' : 'plain'} style={{ gap: space.space3 }}>
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
            // The touch target is taller than the avatar; the card's rhythm is kept by pulling it in.
            marginVertical: -space.space1,
            borderRadius: theme.radius.radiusLg,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <PatientIdentity patient={flag.patient} size="md" bright={tinted} />
          {onOpen ? <Icon name="chevron" size={16} color={colors.inkFaint} /> : null}
        </Touchable>
      )}
      {sentence === 'hide' ? null : (
        <View style={{ gap: space.space1 }}>
          {sentence === 'whenFlagged' ? (
            <Text style={[theme.type.caption, { color: colors.inkFaint }]}>When flagged</Text>
          ) : null}
          <Text style={[theme.type.bodyTouch, { color: waiting ? colors.ink : colors.inkMuted }]}>{flag.handoff}</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space2, rowGap: space.space2 }}>
        <StatusBadge severity={closed ? 'stable' : alertSeverity(alert)} label={ruleLabel(leadRule)} />
        {otherRules.map((rule) => (
          <Text key={rule} style={[theme.type.caption, { color: colors.inkMuted }]}>
            {ruleLabel(rule)}
          </Text>
        ))}
        <Text style={[theme.type.caption, { color: tinted ? colors.inkMuted : colors.inkFaint, fontVariant: ['tabular-nums'] }]}>
          {closed ? `${flagOpenedText(flag, now)}, closed` : flagOpenedText(flag, now)}
        </Text>
      </View>
      {alert.acknowledgedAt ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.space2 }}>
          <View style={{ paddingTop: 2 }}>
            <Icon name="check" size={16} color={colors.inkMuted} />
          </View>
          <Text style={[theme.type.dense, { flex: 1, color: colors.inkMuted }]}>{flagAcknowledgedText(alert, now)}</Text>
        </View>
      ) : !waiting ? (
        <Text style={[theme.type.dense, { color: colors.inkMuted }]}>Closed without an acknowledgement</Text>
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
        <Text accessibilityLiveRegion="polite" style={[theme.type.caption, { color: colors.urgent }]}>
          {sentences('Not acknowledged', failure)}
        </Text>
      ) : null}
    </Card>
  );
}
