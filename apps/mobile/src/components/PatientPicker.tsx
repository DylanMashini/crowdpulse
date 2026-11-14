import type { WorklistItem } from '@triagecam/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { api, errorMessage } from '@/lib/api';
import { statusText } from '@/lib/nurse/worklistFormat';

import { Button } from './Button';
import { Notice } from './Notice';
import { PatientIdentity } from './PatientIdentity';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';

type Props = {
  /** Called with the waiting patient the operator tapped. */
  onPick: (item: WorklistItem) => void;
};

const REFRESH_MS = 10_000;

/** Everyone in the waiting room, by face and name, to start a re-check for one of them. */
export function PatientPicker({ onPick }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const [items, setItems] = useState<WorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.worklist().then(
      (worklist) => {
        setItems(worklist.items);
        setError(null);
      },
      (failure: unknown) => setError(errorMessage(failure)),
    );
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (items === null) {
    return error ? (
      <Notice title="The waiting room could not be loaded" body={error}>
        <Button variant="secondary" block label="Try again" onPress={load} />
      </Notice>
    ) : (
      <Text style={[theme.type.bodyTouch, { color: colors.inkMuted }]}>Loading the waiting room</Text>
    );
  }
  if (items.length === 0) {
    return <Text style={[theme.type.bodyTouch, { color: colors.inkMuted }]}>Nobody is waiting yet</Text>;
  }

  // Longest without an observation first: they are the ones a re-check is for.
  const ordered = [...items].sort((a, b) => (b.minutesSinceObserved ?? Infinity) - (a.minutesSinceObserved ?? Infinity));

  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: theme.radius.radiusLg, overflow: 'hidden' }}>
      {ordered.map((item, index) => (
        <Touchable
          key={item.patientNumber}
          accessibilityRole="button"
          accessibilityHint="Starts a re-check for this patient"
          onPress={() => onPick(item)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.space3,
            minHeight: theme.size.controlTouch + space.space3,
            paddingVertical: space.space2,
            paddingHorizontal: space.space3,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: colors.line,
            backgroundColor: pressed ? colors.surfaceSunken : colors.surfaceRaised,
          })}
        >
          <PatientIdentity patient={item.patient} size="sm" detail={item.reasonForVisit} />
          <Text style={[theme.type.caption, { color: colors.inkMuted, flexShrink: 0 }]}>
            {statusText(item.state, item.minutesSinceObserved)}
          </Text>
        </Touchable>
      ))}
    </View>
  );
}
