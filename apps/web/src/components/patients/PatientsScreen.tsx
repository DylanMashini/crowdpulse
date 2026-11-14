'use client';

import { patientLabel, type Patient } from '@triagecam/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { useLive, useLiveEvents } from '@/components/app/live';
import { Button, PatientIdentity, StatusBadge, TableFrame, tableCell, tableHeadCell, tableRow } from '@/components/ds';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { PageHeader } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage, type PatientStatusFilter } from '@/lib/api';
import { ageText, dayTime } from '@/lib/format';
import { rowSeverity } from '@/lib/mapping';
import { useResource } from '@/lib/use-resource';

const EMPTY: Record<PatientStatusFilter, { title: string; text: string }> = {
  waiting: { title: 'Nobody is waiting', text: 'A patient appears here as soon as their check-in starts on a camera phone.' },
  discharged: { title: 'Nobody has been discharged', text: 'A patient is discharged from their own page.' },
  all: { title: 'There are no patients yet', text: 'A patient appears here as soon as their check-in starts on a camera phone.' },
};

interface MorePages {
  status: PatientStatusFilter;
  items: Patient[];
  nextCursor: string | null;
}

export function PatientsScreen() {
  const { worklist } = useLive();
  const [status, setStatus] = useState<PatientStatusFilter>('waiting');
  const first = useResource(`patients:${status}`, () => api.patients(status));
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useLiveEvents((event) => {
    if (event.type === 'patient_changed' || event.type === 'reconnected') {
      setMore(null);
      first.reload();
    }
  });

  const extra = more?.status === status ? more : null;
  const items = first.data ? [...first.data.items, ...(extra?.items ?? [])] : [];
  const nextCursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null);
  const states = new Map(worklist.data?.worklist.items.map((item) => [item.patientNumber, item]));

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore({ busy: true, error: null });
    try {
      const page = await api.patients(status, nextCursor);
      setMore({ status, items: [...(extra?.items ?? []), ...page.items], nextCursor: page.nextCursor });
      setLoadingMore({ busy: false, error: null });
    } catch (error) {
      setLoadingMore({ busy: false, error: errorMessage(error) });
    }
  };

  return (
    <>
      <PageHeader title="Patients" description="Everyone checked in, newest first">
        <LiveStatus updatedAt={first.updatedAt} />
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'waiting', label: 'Waiting' },
            { value: 'discharged', label: 'Discharged' },
            { value: 'all', label: 'All' },
          ]}
        />
      </PageHeader>

      {first.loading ? <StateMessage kind="loading" title="Loading patients" /> : null}
      {first.error && !first.data ? (
        <StateMessage kind="error" title="The patients could not be loaded" onRetry={first.reload}>
          {first.error.message}
        </StateMessage>
      ) : null}
      {first.data && items.length === 0 ? (
        <StateMessage kind="empty" title={EMPTY[status].title}>
          {EMPTY[status].text}
        </StateMessage>
      ) : null}

      {items.length > 0 ? (
        <TableFrame label="Patients">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={tableHeadCell}>
                  Patient
                </th>
                <th scope="col" className={tableHeadCell}>
                  Reason for visit
                </th>
                <th scope="col" className={tableHeadCell}>
                  Status
                </th>
                <th scope="col" className={`${tableHeadCell} text-right`}>
                  Checked in
                </th>
                <th scope="col" className={`${tableHeadCell} text-right`}>
                  Discharged
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((patient) => {
                const item = states.get(patient.number);
                return (
                  <tr key={patient.number} className={`relative ${tableRow}`}>
                    <td className={`${tableCell} w-[30%] max-w-0 min-w-[280px]`}>
                      <Link
                        href={`/patients/${patient.number}`}
                        aria-label={`Open ${patientLabel(patient)}`}
                        className="flex rounded-sm after:absolute after:inset-0 after:content-['']"
                      >
                        <PatientIdentity patient={patient} size="sm" detail={ageText(patient.dateOfBirth)} quiet={patient.status === 'discharged'} />
                      </Link>
                    </td>
                    <td className={`${tableCell} w-[36%] max-w-0`}>
                      {patient.reasonForVisit ? (
                        <span className="block truncate" title={patient.reasonForVisit}>
                          {patient.reasonForVisit}
                        </span>
                      ) : (
                        <span className="block truncate text-ink-faint">{patient.intakeCompletedAt ? 'Not given' : 'Intake not finished'}</span>
                      )}
                    </td>
                    <td className={tableCell}>
                      {patient.status === 'discharged' ? (
                        <span className="text-ink-faint">Discharged</span>
                      ) : item ? (
                        <StatusBadge state={item.state} severity={rowSeverity(item)} minutes={item.minutesSinceObserved} lowConfidence={item.pulse.lowConfidence != null} />
                      ) : (
                        'Waiting'
                      )}
                    </td>
                    <td className={`${tableCell} text-right whitespace-nowrap tabular-nums`}>{dayTime(patient.createdAt)}</td>
                    <td className={`${tableCell} text-right whitespace-nowrap tabular-nums`}>
                      {patient.dischargedAt ? dayTime(patient.dischargedAt) : <span className="text-ink-faint">Still waiting</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      ) : null}

      {nextCursor ? (
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Button onClick={loadMore} disabled={loadingMore.busy}>
            {loadingMore.busy ? 'Loading' : 'Show earlier patients'}
          </Button>
          {loadingMore.error ? (
            <p role="alert" className="type-caption text-urgent">
              {loadingMore.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
