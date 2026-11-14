import type { Severity } from '@/lib/nurse/severity';

import { Card } from './Card';
import { useScopedTheme } from './ThemeScope';
import { Text } from './Text';

/**
 * The sentence a nurse reads before walking over. It comes from the server's fixed template
 * and is shown as it is. For an urgent patient the note is the tinted card; otherwise it is a
 * plain one. A flat fill either way.
 */
export function HandoffNote({ sentence, severity = 'stable' }: { sentence: string; severity?: Severity }) {
  const theme = useScopedTheme();
  return (
    <Card tone={severity === 'urgent' ? 'urgent' : 'plain'}>
      <Text selectable style={[theme.type.bodyTouch, { color: theme.colors.ink }]}>
        {sentence}
      </Text>
    </Card>
  );
}
