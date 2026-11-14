import { patientLabel, type WorklistItem } from '@triagecam/contracts';
import { View } from 'react-native';

import { toAcknowledgeText } from '@/lib/nurse/nurseFormat';
import { patientSeverity } from '@/lib/nurse/severity';
import { lastObservedText, sourceLabel, statusText } from '@/lib/nurse/worklistFormat';
import { weight } from '@/theme';

import { cardStyle } from './Card';
import { Icon } from './Icon';
import { PatientIdentity } from './PatientIdentity';
import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { TrendValue } from './TrendValue';
import { Text } from './Text';

/**
 * One patient in the nurse worklist. The whole card is one touch target and opens the patient.
 * An urgent patient gets the tinted card with the name and readings in white; every other
 * patient keeps the plain card, so one card on the screen carries the colour.
 */
export function WorklistCard({ item, onPress }: { item: WorklistItem; onPress: () => void }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const severity = patientSeverity(item);
  const urgent = severity === 'urgent';
  const source = sourceLabel(item.source);
  // The badge already carries the age for observed and overdue patients.
  const showsLastObserved = item.state === 'flag' || item.state === 'no-reading' || item.sittingInProgress;
  // Counted in alerts: one deterioration is one thing to acknowledge, whichever rules it tripped.
  const toAcknowledge = toAcknowledgeText(item.flags);

  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${item.rank}, ${patientLabel(item.patient)}, ${statusText(item.state, item.minutesSinceObserved)}`}
      accessibilityHint="Opens the patient"
      style={({ pressed }) => [cardStyle(theme, urgent ? 'urgent' : 'plain', pressed), { padding: space.space4, gap: space.space3 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space3 }}>
        <Text accessibilityElementsHidden style={[theme.type.readoutSm, { minWidth: 16, color: colors.inkFaint }]}>
          {item.rank}
        </Text>
        <View style={{ flex: 1 }}>
          <PatientIdentity
            patient={item.patient}
            size="md"
            bright={urgent}
            detail={item.ageYears != null ? `${item.ageYears} y` : null}
          />
        </View>
        <Icon name="chevron" size={16} color={colors.inkFaint} />
      </View>

      {item.reasonForVisit ? (
        <Text numberOfLines={2} style={[theme.type.body, { color: urgent ? colors.ink : colors.inkMuted }]}>
          {item.reasonForVisit}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space4, rowGap: space.space2 }}>
        {(
          [
            ['Pulse', 'pulse', item.pulse, 'bpm'],
            ['Breathing', 'breath', item.breathing, 'per min'],
          ] as const
        ).map(([label, icon, trend, unit]) => (
          <View key={label} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 132, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={icon} size={16} color={colors.inkMuted} />
              <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{label}</Text>
            </View>
            <TrendValue trend={trend} unit={unit} bright={urgent} />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space2 }}>
        <StatusBadge severity={severity} label={statusText(item.state, item.minutesSinceObserved)} />
        {item.score != null ? (
          <ScoreChip score={item.score} measured={item.parametersMeasured} />
        ) : (
          <Text style={[theme.type.caption, { color: colors.inkFaint }]}>Not scored</Text>
        )}
        {source ? <ProvenanceTag kind="recording" label={source} /> : null}
      </View>

      {showsLastObserved || toAcknowledge ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
          {toAcknowledge ? (
            <Text
              style={[
                theme.type.caption,
                { fontWeight: weight.medium, color: urgent ? colors.urgent : severity === 'watch' ? colors.watch : colors.ink },
              ]}
            >
              {toAcknowledge}
            </Text>
          ) : null}
          {showsLastObserved ? <Text style={[theme.type.caption, { color: colors.inkFaint }]}>{lastObservedText(item)}</Text> : null}
        </View>
      ) : null}
    </Touchable>
  );
}
