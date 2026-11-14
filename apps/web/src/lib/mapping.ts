import type { CaptureSource, FlagRule, TimelineEntry, WorklistItem } from '@triagecam/contracts';

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
    patient: item.patient,
    reason: item.reasonForVisit,
    ageYears: item.ageYears,
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

function toTimelineItem(entry: TimelineEntry, rules: Map<string, FlagRule>): TimelineItem {
  const time = clockTime(entry.at);
  switch (entry.type) {
    case 'created':
      return { time, title: 'Intake started' };
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
    case 'flag_acknowledged': {
      // Says which alert was acknowledged. One acknowledgement covers both trend flags.
      const rule = rules.get(entry.flagId);
      const which = rule === undefined ? 'Acknowledged' : rule === 'overdue' ? 'Overdue flag acknowledged' : 'Trend flag acknowledged';
      return { time, title: 'Flag acknowledged', note: `${which} by ${entry.by}` };
    }
    case 'flag_closed':
      return {
        time,
        title: 'Flag closed',
        note: entry.rule === 'overdue' ? 'The patient is no longer overdue' : 'The trend rule no longer applies',
      };
    case 'discharged':
      return { time, title: 'Discharged', note: 'Open flags closed and face-match data deleted' };
  }
}

/** The server sends the timeline newest first; the timeline component reads oldest first. */
export function toTimelineItems(entries: TimelineEntry[]): TimelineItem[] {
  const rules = new Map<string, FlagRule>();
  for (const entry of entries) {
    if (entry.type === 'flag_opened') rules.set(entry.flagId, entry.rule);
  }
  return entries.map((entry) => toTimelineItem(entry, rules)).reverse();
}
