import type { WorklistItem } from '@triagecam/contracts';
import { useCallback, useEffect, useState } from 'react';

import { api, errorMessage } from '@/lib/api';
import { statusText } from '@/lib/nurse/worklistFormat';

import { Button } from './Button';
import { Notice } from './Notice';
import { PatientIdentity } from './PatientIdentity';
import { Row, RowList } from './RowList';

type Props = {
  /** Called with the waiting patient the operator tapped. */
  onPick: (item: WorklistItem) => void;
};

const REFRESH_MS = 10_000;

/** Everyone in the waiting room, by face and name, to start a re-check for one of them. */
export function PatientPicker({ onPick }: Props) {
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
      <Notice title="Loading the waiting room" />
    );
  }
  if (items.length === 0) return <Notice title="Nobody is waiting yet" />;

  // Longest without an observation first: they are the ones a re-check is for.
  const ordered = [...items].sort((a, b) => (b.minutesSinceObserved ?? Infinity) - (a.minutesSinceObserved ?? Infinity));

  return (
    <RowList>
      {ordered.map((item, index) => (
        <Row
          key={item.patientNumber}
          divided={index > 0}
          accessibilityHint="Starts a re-check for this patient"
          onPress={() => onPick(item)}
        >
          <PatientIdentity
            patient={item.patient}
            size="md"
            detail={item.reasonForVisit}
            status={statusText(item.state, item.minutesSinceObserved)}
          />
        </Row>
      ))}
    </RowList>
  );
}
