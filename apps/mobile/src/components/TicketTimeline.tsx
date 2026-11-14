import { Text, View } from 'react-native';

import type { TimelineRow } from '@/lib/nurse/worklistFormat';
import { fonts } from '@/theme';

import { ProvenanceTag } from './ProvenanceTag';
import { ScoreChip } from './ScoreChip';
import { StatusBadge } from './StatusBadge';
import { useScopedTheme } from './ThemeScope';

const TIME_WIDTH = 52;
const MARK = 10;

/** Every observation and flag event for one ticket, oldest first, with the failed sittings kept. */
export function TicketTimeline({ rows }: { rows: TimelineRow[] }) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  return (
    <View accessibilityRole="list">
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const mark = {
          observed: { backgroundColor: colors.surfaceRaised, borderColor: colors.lineStrong, borderRadius: MARK },
          flag: { backgroundColor: colors.flag, borderColor: colors.flag, borderRadius: 2 },
          overdue: { backgroundColor: colors.ink, borderColor: colors.ink, borderRadius: MARK },
          'no-reading': {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.lineStrong,
            borderRadius: MARK,
            borderStyle: 'dashed' as const,
          },
        }[row.state];
        return (
          <View key={row.key} style={{ flexDirection: 'row', gap: space.space3, paddingBottom: last ? 0 : space.space4 }}>
            <Text
              style={{
                width: TIME_WIDTH,
                textAlign: 'right',
                fontFamily: fonts.mono[400],
                fontSize: 13,
                lineHeight: 26,
                color: colors.inkMuted,
              }}
            >
              {row.time}
            </Text>
            <View style={{ width: 16, alignItems: 'center' }}>
              {last ? null : (
                <View
                  style={{
                    position: 'absolute',
                    top: 14,
                    bottom: -space.space4 - 6,
                    width: 2,
                    backgroundColor: colors.line,
                  }}
                />
              )}
              <View style={[{ width: MARK + 4, height: MARK + 4, marginTop: 6, borderWidth: 2 }, mark]} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.space2, minHeight: 26 }}
              >
                <Text style={[theme.type.subheading, { color: colors.ink }]}>{row.title}</Text>
                {row.state === 'flag' ? <StatusBadge state="flag" /> : null}
                {row.state === 'overdue' ? <StatusBadge state="overdue" label="Overdue" /> : null}
                {row.state === 'no-reading' ? <StatusBadge state="no-reading" /> : null}
                {row.sourceLabel ? <ProvenanceTag kind="recording" label={row.sourceLabel} /> : null}
              </View>
              {row.vitals ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.space4, rowGap: space.space1 }}>
                  <Vital value={row.vitals.pulse} unit="bpm" name="pulse" />
                  <Vital value={row.vitals.breathing} unit="breaths per min" name="breathing" />
                  {row.vitals.score != null ? <ScoreChip score={row.vitals.score} caption={false} /> : null}
                </View>
              ) : null}
              {row.note ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{row.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Vital({ value, unit, name }: { value: string | null; unit: string; name: string }) {
  const theme = useScopedTheme();
  return (
    <Text style={[theme.type.caption, { lineHeight: 24, color: theme.colors.inkMuted }]}>
      <Text style={{ fontFamily: fonts.mono[600], fontSize: value ? 17 : 13, color: theme.colors.ink }}>
        {value ?? 'No reading'}
      </Text>
      {value ? ` ${unit}` : ` for ${name}`}
    </Text>
  );
}
