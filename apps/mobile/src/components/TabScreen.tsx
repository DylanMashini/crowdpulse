import { type ReactNode, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { clockTime, sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { type Connection, connectionText } from '@/lib/nurse/nurseFormat';
import { weight } from '@/theme';

import { Button } from './Button';
import { Notice } from './Notice';
import { ScreenTitle } from './Screen';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Props = {
  /** The one title of the tab. */
  title: string;
  /** A count or a sentence under the title. */
  subtitle?: string;
  /**
   * What pulling down and "Try again" load: the tab's own data together with the shared
   * worklist and flags. Left out, they load the shared data only. It must not reject.
   */
  onRefresh?: () => Promise<void>;
  children: ReactNode;
};

/**
 * The frame of one nurse tab. The scroll view is the screen's first view, which is what lets
 * the native tab bar float over the content and inset it by itself; the title scrolls with it.
 */
export function TabScreen({ title, subtitle, onRefresh, children }: Props) {
  const theme = useScopedTheme();
  const { colors, space } = theme;
  const { connection, failure, worklist, refresh } = useNurse();
  // The spinner stays for as long as the request is in the air, on every tab.
  const [pulling, setPulling] = useState(false);
  const reload = onRefresh ?? refresh;
  const pull = async () => {
    setPulling(true);
    try {
      await reload();
    } finally {
      setPulling(false);
    }
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      indicatorStyle="white"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.inkMuted} />}
      contentContainerStyle={{
        paddingHorizontal: space.space4,
        paddingTop: space.space4,
        paddingBottom: space.space8,
        gap: space.space6,
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.space2 }}>
        <ScreenTitle title={title} subtitle={subtitle} />
        <ConnectionStatus connection={connection} />
      </View>
      {failure ? (
        <Notice
          title={worklist ? `Not updated since ${clockTime(worklist.generatedAt)}` : 'The server cannot be reached'}
          body={worklist ? sentences(failure, 'What is shown may be out of date') : failure}
        >
          <Button variant="secondary" block label="Try again" onPress={() => void reload()} />
        </Notice>
      ) : null}
      {children}
    </ScrollView>
  );
}

/**
 * Whether changes arrive by themselves. Told apart by the mark's shape as well as its colour:
 * a lit dot while the stream is open, a ring while the lists are polled, a square when the
 * server cannot be reached. It is chrome, so it never borrows a severity colour.
 */
export function ConnectionStatus({ connection }: { connection: Connection }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const mark = {
    live: { backgroundColor: colors.signal, borderColor: colors.signal, borderRadius: 3 },
    polling: { backgroundColor: 'transparent', borderColor: colors.inkFaint, borderRadius: 3 },
    offline: { backgroundColor: colors.ink, borderColor: colors.ink, borderRadius: 1 },
  }[connection];
  return (
    <View
      accessible
      accessibilityLabel={`Connection: ${connectionText(connection)}`}
      // As tall as the title's line, so the two share a centre.
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: theme.type.title.lineHeight }}
    >
      <View style={[{ width: 6, height: 6, borderWidth: 1 }, mark]} />
      <Text
        style={[
          theme.type.caption,
          { fontWeight: weight.medium, color: connection === 'offline' ? colors.ink : colors.inkMuted, fontVariant: ['tabular-nums'] },
        ]}
      >
        {connectionText(connection)}
      </Text>
    </View>
  );
}

/**
 * A titled group inside a tab or the patient screen. The heading is a quiet label that sits
 * closer to its own group than to the one above; `count` prints beside it.
 */
export function Section({ heading, count, children }: { heading: string; count?: number; children: ReactNode }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View style={{ gap: theme.space.space2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text accessibilityRole="header" style={[theme.type.label, { color: colors.inkMuted }]}>
          {heading}
        </Text>
        {count != null ? (
          <Text style={[theme.type.label, { fontWeight: weight.normal, color: colors.inkFaint, fontVariant: ['tabular-nums'] }]}>{count}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
