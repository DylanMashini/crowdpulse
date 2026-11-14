import type { CaptureSource, TimelineEntry, WorklistItem } from '@triagecam/contracts';

import type { Provenance, TimelineItem, WorklistRow } from '@/components/ds';

import { clockTime, ruleText, sourceText } from './format';

/**
 * The design system's "Live" tag marks a camera measurement. On a row that describes a finished
 * sitting the word is "Camera"; every other source keeps its dashed tag and its own word.
 */
export function provenanceOf(source: CaptureSource): { kind: Provenance; label: string } {
  return { kind: source === 'camera' ? 'live' : 'recording', label: sourceText(source) };
}

export function toWorklistRow(item: WorklistItem): WorklistRow & { measured: number } {
  const provenance = item.source ? provenanceOf(item.source) : null;
  return {
    ticket: item.ticketNumber,
    state: item.state,
    minutes: item.minutesSinceObserved,
    pulse: item.pulse,
    breathing: item.breathing,
    score: item.score,
    source: provenance?.kind,
    sourceLabel: provenance?.label,
    sittingInProgress: item.sittingInProgress,
    measured: item.parametersMeasured,
  };
}

function toTimelineItem(entry: TimelineEntry): TimelineItem {
  const time = clockTime(entry.at);
  switch (entry.type) {
    case 'created':
      return { time, title: 'Ticket created' };
    case 'sitting': {
      const provenance = provenanceOf(entry.source);
      const noReading = entry.heartRate == null && entry.breathingRate == null;
      return {
        time,
        title: entry.kind === 'check_in' ? 'Check-in sitting' : 'Re-check sitting',
        vitals: { pulse: entry.heartRate, breathing: entry.breathingRate },
        score: entry.score,
        state: noReading ? 'no-reading' : 'observed',
        source: provenance.kind,
        sourceLabel: provenance.label,
      };
    }
    case 'flag_opened':
      return { time, title: 'Flag opened', state: entry.rule === 'overdue' ? 'overdue' : 'flag', note: ruleText(entry.rule) };
    case 'flag_acknowledged':
      return { time, title: 'Flag acknowledged', note: `Acknowledged by ${entry.by}` };
    case 'flag_closed':
      return {
        time,
        title: 'Flag closed',
        note: entry.rule === 'overdue' ? 'The ticket is no longer overdue' : 'The trend rule no longer applies',
      };
    case 'discharged':
      return { time, title: 'Discharged', note: 'Open flags closed and face data deleted' };
  }
}

/** The server sends the timeline newest first; the timeline component reads oldest first. */
export function toTimelineItems(entries: TimelineEntry[]): TimelineItem[] {
  return entries.map(toTimelineItem).reverse();
}
