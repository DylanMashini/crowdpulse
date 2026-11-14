import { patientLabel, type WorklistItem } from '@triagecam/contracts';
import { View } from 'react-native';

import { lastObservedText, sourceLabel, statusText } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';

import { Icon } from './Icon';
import { PatientIdentity } from './PatientIdentity';
import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { TrendValue } from './TrendValue';
import { Text } from './Text';

/** One patient in the nurse worklist. The whole card is one touch target and opens the patient. */
export function WorklistCard({ item, onPress }: { item: WorklistItem; onPress: () => void }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const outline = {
    observed: { borderWidth: 1, borderColor: colors.line, borderStyle: 'solid' as const },
    flag: { borderWidth: 2, borderColor: colors.flag, borderStyle: 'solid' as const },
    overdue: { borderWidth: 2, borderColor: colors.ink, borderStyle: 'solid' as const },
    'no-reading': { borderWidth: 1, borderColor: colors.lineStrong, borderStyle: 'dashed' as const },
  }[item.state];
  const source = sourceLabel(item.source);
  // The badge already carries the age for observed and overdue patients.
  const showsLastObserved = item.state === 'flag' || item.state === 'no-reading' || item.sittingInProgress;
  const waitingFlags = item.flags.filter((flag) => flag.acknowledgedAt == null).length;

  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${item.rank}, ${patientLabel(item.patient)}, ${statusText(item.state, item.minutesSinceObserved)}`}
      accessibilityHint="Opens the patient"
      style={({ pressed }) => [
        {
          gap: space.space3,
          // A 2px outline takes 1px from the padding, so cards keep one size.
          padding: space.space4 - (outline.borderWidth - 1),
          borderRadius: theme.radius.radiusXl,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surfaceRaised,
        },
        outline,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.space3 }}>
        <Text
          accessibilityElementsHidden
          style={{ minWidth: 20, fontFamily: fonts.mono[500], fontSize: 17, lineHeight: 24, color: colors.inkMuted }}
        >
          {item.rank}
        </Text>
        <View style={{ flex: 1 }}>
          <PatientIdentity
            patient={item.patient}
            size="md"
            detail={item.ageYears != null ? `${item.ageYears} y` : null}
          />
        </View>
        <Icon name="chevron" size={20} color={colors.inkMuted} />
      </View>

      {item.reasonForVisit ? (
        <Text numberOfLines={2} style={[theme.type.body, { color: colors.ink }]}>
          {item.reasonForVisit}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
        <StatusBadge state={item.state} minutes={item.minutesSinceObserved} />
        {showsLastObserved ? (
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{lastObservedText(item)}</Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.space4, rowGap: space.space2 }}>
        {(
          [
            ['Pulse', 'pulse', item.pulse, 'bpm'],
            ['Breathing', 'breath', item.breathing, 'per min'],
          ] as const
        ).map(([label, icon, trend, unit]) => (
          <View key={label} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 132 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={icon} size={16} color={colors.inkMuted} />
              <Text style={[theme.type.label, { color: colors.inkMuted }]}>{label}</Text>
            </View>
            <TrendValue trend={trend} unit={unit} />
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2 }}>
        {item.score != null ? (
          <ScoreChip score={item.score} measured={item.parametersMeasured} />
        ) : (
          <Text style={[theme.type.caption, { color: colors.inkMuted }]}>Not scored</Text>
        )}
        {source ? <ProvenanceTag kind="recording" label={source} /> : null}
        {waitingFlags > 0 ? (
          <Text style={[theme.type.label, { color: colors.flag }]}>
            {waitingFlags === 1 ? '1 flag to acknowledge' : `${waitingFlags} flags to acknowledge`}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
}
