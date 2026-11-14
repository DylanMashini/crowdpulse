import { View } from 'react-native';

import type { TimelineRow } from '@/lib/nurse/worklistFormat';
import { hairline } from '@/theme';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

const TIME_WIDTH = 44;
const MARK = 8;

/** Every observation and flag event for one patient, oldest first, with the failed sittings kept. */
export function PatientTimeline({ rows }: { rows: TimelineRow[] }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const line = theme.type.bodyStrong.lineHeight;
  return (
    <View accessibilityRole="list">
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        // A flag's mark takes its severity colour; every other mark is a quiet ring.
        const mark = {
          stable: { backgroundColor: colors.surface0, borderColor: colors.lineHover, borderWidth: 1 },
          watch: { backgroundColor: colors.watch, borderColor: colors.watch, borderWidth: 0 },
          urgent: { backgroundColor: colors.urgent, borderColor: colors.urgent, borderWidth: 0, boxShadow: theme.shadow.glowUrgent },
          overdue: { backgroundColor: colors.overdue, borderColor: colors.overdue, borderWidth: 0 },
          none: { backgroundColor: colors.surface0, borderColor: colors.lineHover, borderWidth: 1, borderStyle: 'dashed' as const },
        }[row.severity];
        return (
          <View key={row.key} style={{ flexDirection: 'row', gap: space.space3, paddingBottom: last ? 0 : space.space4 }}>
            <Text style={[theme.type.readoutSm, { width: TIME_WIDTH, lineHeight: line, textAlign: 'right', color: colors.inkFaint }]}>
              {row.time}
            </Text>
            <View style={{ width: MARK, alignItems: 'center' }}>
              {last ? null : (
                <View
                  style={{
                    position: 'absolute',
                    top: (line + MARK) / 2 + space.space1,
                    bottom: -space.space4 - (line - MARK) / 2 + space.space1,
                    width: hairline,
                    backgroundColor: colors.lineStrong,
                  }}
                />
              )}
              <View style={[{ width: MARK, height: MARK, borderRadius: MARK / 2, marginTop: (line - MARK) / 2 }, mark]} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space2, rowGap: space.space1, minHeight: line }}>
                <Text style={[theme.type.bodyStrong, { color: colors.ink }]}>{row.title}</Text>
                {row.state === 'flag' && row.severity !== 'stable' && row.severity !== 'none' ? (
                  <StatusBadge severity={row.severity} label="Trend flag" />
                ) : null}
                {row.state === 'overdue' ? <StatusBadge severity="overdue" label="Overdue" /> : null}
                {row.state === 'no-reading' ? <StatusBadge severity="none" label="No reading" /> : null}
                {row.sourceLabel ? <ProvenanceTag kind="recording" label={row.sourceLabel} /> : null}
              </View>
              {row.vitals ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space3, rowGap: space.space1 }}>
                  <Vital value={row.vitals.pulse} unit="bpm" name="pulse" />
                  <Vital value={row.vitals.breathing} unit="breaths per min" name="breathing" />
                  {row.vitals.score != null ? <ScoreChip score={row.vitals.score} caption={false} /> : null}
                </View>
              ) : null}
              {row.note ? <Text style={[theme.type.dense, { color: colors.inkMuted }]}>{row.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Vital({ value, unit, name }: { value: string | null; unit: string; name: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <Text style={[theme.type.caption, { lineHeight: theme.type.readoutSm.lineHeight, color: colors.inkMuted }]}>
      <Text style={value ? [theme.type.readoutSm, { color: colors.ink }] : undefined}>{value ?? 'No reading'}</Text>
      {value ? ` ${unit}` : ` for ${name}`}
    </Text>
  );
}
