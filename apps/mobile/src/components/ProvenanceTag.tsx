import { View } from 'react-native';

import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

type Kind = 'live' | 'recording' | 'experimental' | 'ai-draft' | 'reference';

const WORDS: Record<Kind, string> = {
  live: 'Live',
  recording: 'Recording',
  experimental: 'Experimental',
  'ai-draft': 'AI draft',
  reference: 'Reference',
};

/** Says where a number came from. Square-cornered and outlined, so it is never read as a status. */
export function ProvenanceTag({ kind, label }: { kind: Kind; label?: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const filled = kind === 'live' || kind === 'ai-draft';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        height: 22,
        paddingHorizontal: theme.space.space2,
        borderRadius: theme.radius.radiusSm,
        borderWidth: 1,
        borderStyle: filled ? 'solid' : 'dashed',
        borderColor: filled ? 'transparent' : colors.lineStrong,
        backgroundColor: kind === 'live' ? colors.signalSoft : kind === 'ai-draft' ? colors.surfaceSunken : 'transparent',
      }}
    >
      {kind === 'live' ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.signal }} />
      ) : null}
      <Text style={[theme.type.label, { color: kind === 'experimental' ? colors.inkMuted : colors.ink }]}>
        {label ?? WORDS[kind]}
      </Text>
    </View>
  );
}
