import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { clockTime, sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { type Connection, connectionText } from '@/lib/nurse/nurseFormat';

import { Button } from './Button';
import { Notice } from './Notice';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** The one title of the tab. */
  title: string;
  /** A count or a sentence under the title. */
  subtitle?: string;
  /** Pull to refresh. Left out, pulling refreshes the shared worklist and flags. */
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
  children: ReactNode;
};

/**
 * The frame of one nurse tab. The scroll view is the screen's first view, which is what lets
 * the native tab bar float over the content and inset it by itself; the title scrolls with it.
 */
export function TabScreen({ title, subtitle, onRefresh, refreshing = false, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { connection, failure, worklist, refresh } = useNurse();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void (onRefresh ?? refresh)()}
          tintColor={colors.inkMuted}
        />
      }
      contentContainerStyle={{
        padding: space.space4,
        paddingBottom: space.space6,
        gap: space.space4,
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
      }}
    >
      <View style={{ gap: space.space1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.space2 }}>
          <Text accessibilityRole="header" style={[theme.type.title, { color: colors.ink }]}>
            {title}
          </Text>
          <ConnectionStatus connection={connection} />
        </View>
        {subtitle ? <Text style={[theme.type.bodyTouch, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
      </View>
      {failure ? (
        <Notice
          title={worklist ? `Not updated since ${clockTime(worklist.generatedAt)}` : 'The server cannot be reached'}
          body={worklist ? sentences(failure, 'What is shown may be out of date') : failure}
        >
          <Button variant="secondary" block label="Try again" onPress={() => void refresh()} />
        </Notice>
      ) : null}
      {children}
    </ScrollView>
  );
}

/** Whether changes arrive by themselves. Told apart by the mark's shape as well as its colour. */
export function ConnectionStatus({ connection }: { connection: Connection }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const mark = {
    live: { backgroundColor: colors.signal, borderColor: colors.signal, borderRadius: 4 },
    polling: { backgroundColor: 'transparent', borderColor: colors.lineStrong, borderRadius: 4 },
    offline: { backgroundColor: colors.flag, borderColor: colors.flag, borderRadius: 1 },
  }[connection];
  return (
    <View
      accessible
      accessibilityLabel={`Connection: ${connectionText(connection)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 }}
    >
      <View style={[{ width: 8, height: 8, borderWidth: 1.5 }, mark]} />
      <Text style={[theme.type.label, { color: connection === 'offline' ? colors.flag : colors.inkMuted }]}>
        {connectionText(connection)}
      </Text>
    </View>
  );
}

/** A titled group inside a tab or the patient screen. `count` prints beside the heading. */
export function Section({ heading, count, children }: { heading: string; count?: number; children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View style={{ gap: theme.space.space3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space.space2 }}>
        <Text accessibilityRole="header" style={[theme.type.heading, { color: theme.colors.ink }]}>
          {heading}
        </Text>
        {count != null ? (
          <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted, fontVariant: ['tabular-nums'] }]}>{count}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
