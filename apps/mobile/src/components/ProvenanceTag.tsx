import { View } from 'react-native';

import { weight } from '@/theme';

import { StatusBadge } from './StatusBadge';
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

/**
 * Says where a number came from. Outlined, with no dot, so it is never read as a status.
 * `live` is the exception: ice on its soft fill, with the lit dot of a camera that is reading.
 */
export function ProvenanceTag({ kind, label }: { kind: Kind; label?: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  if (kind === 'live') return <StatusBadge severity="live" label={label ?? WORDS.live} />;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        justifyContent: 'center',
        minHeight: 22,
        paddingVertical: 2,
        paddingHorizontal: theme.space.space2,
        borderRadius: theme.radius.radiusSm,
        borderWidth: 1,
        borderColor: colors.lineStrong,
      }}
    >
      <Text style={[theme.type.caption, { fontWeight: weight.medium, color: colors.inkMuted }]}>{label ?? WORDS[kind]}</Text>
    </View>
  );
}
