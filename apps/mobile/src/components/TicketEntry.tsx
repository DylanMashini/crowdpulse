import type { Ticket } from '@triagecam/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { api, errorMessage, isApiError } from '@/lib/api';
import { parseTicketNumber } from '@/lib/capture/readingFormat';

import { Button } from './Button';
import { Field } from './Field';
import { useScopedTheme } from './ThemeScope';

type Props = {
  /** Called with a waiting ticket that exists on the server. */
  onFound: (ticket: Ticket) => void;
  variant?: 'primary' | 'secondary';
};

/** Asks for a ticket number and checks it with the server before a re-check starts. */
export function TicketEntry({ onFound, variant = 'secondary' }: Props) {
  const theme = useScopedTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseTicketNumber(text);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    setBusy(true);
    try {
      const { ticket } = await api.ticket(parsed.number);
      if (ticket.status === 'discharged') {
        setError(`Ticket ${ticket.number} has been discharged. Create a new ticket instead.`);
      } else {
        onFound(ticket);
      }
    } catch (failure) {
      setError(
        isApiError(failure) && failure.code === 'not_found'
          ? `There is no ticket ${parsed.number}. Check the number on the patient's slip.`
          : errorMessage(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.space.space3 }}>
      <Field
        label="Ticket number"
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (error) setError(null);
        }}
        error={error}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={9}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Button
        variant={variant}
        block
        label={busy ? 'Checking ticket' : 'Start re-check'}
        disabled={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}
