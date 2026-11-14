import type { Ticket } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Text, View } from 'react-native';
import TriageCapture from 'triage-capture';

import { Button } from '@/components/Button';
import { ConsentSheet } from '@/components/ConsentSheet';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useScopedTheme } from '@/components/ThemeScope';
import { TicketEntry } from '@/components/TicketEntry';
import { TicketNumber } from '@/components/TicketNumber';
import { api, errorMessage } from '@/lib/api';
import { sentences } from '@/lib/format';
import { sourceLabel } from '@/lib/nurse/worklistFormat';

type NewTicket =
  | { step: 'idle' }
  | { step: 'creating' }
  | { step: 'failed'; message: string }
  /** The ticket exists and the patient is being asked about face match. */
  | { step: 'consent'; ticket: number; saving: boolean }
  /** The patient said yes but the choice did not reach the server. */
  | { step: 'opt_in_failed'; ticket: number; message: string };

export default function CheckIn() {
  const theme = useScopedTheme();
  const router = useRouter();
  const [newTicket, setNewTicket] = useState<NewTicket>({ step: 'idle' });
  const source = sourceLabel(TriageCapture.getSource());

  const startSitting = (ticket: number, kind: 'check_in' | 'recheck', enrolFace: boolean) => {
    setNewTicket({ step: 'idle' });
    router.push({
      pathname: '/camera/sitting',
      params: { ticket: String(ticket), kind, enrol: enrolFace ? '1' : '0' },
    });
  };

  const createTicket = async () => {
    setNewTicket({ step: 'creating' });
    try {
      const { ticket } = await api.createTicket();
      setNewTicket({ step: 'consent', ticket: ticket.number, saving: false });
    } catch (error) {
      setNewTicket({ step: 'failed', message: errorMessage(error) });
    }
  };

  const acceptFaceMatch = async (ticket: number) => {
    setNewTicket({ step: 'consent', ticket, saving: true });
    try {
      await api.setFaceOptIn(ticket, true);
      startSitting(ticket, 'check_in', true);
    } catch (error) {
      setNewTicket({ step: 'opt_in_failed', ticket, message: errorMessage(error) });
    }
  };

  const recheck = (ticket: Ticket) => startSitting(ticket.number, 'recheck', ticket.faceOptIn && !ticket.faceEnrolled);

  return (
    <Screen
      title="Check in"
      subtitle={source ? `${source} signal: this build is not measuring with the camera` : undefined}
      action={{ icon: 'sliders', label: 'Settings', onPress: () => router.push('/settings') }}
    >
      <Section heading="New patient" body="Gives the patient the next ticket number, then starts a 60-second sitting">
        {newTicket.step === 'failed' ? <Notice title="No ticket was created" body={newTicket.message} /> : null}
        {newTicket.step === 'opt_in_failed' ? (
          <Notice
            title="Face match was not turned on"
            body={sentences(newTicket.message, 'The ticket was created and its number works for re-checks')}
          >
            <TicketNumber number={newTicket.ticket} size="lg" />
            <Button
              variant="primary"
              block
              label="Start sitting without face match"
              onPress={() => startSitting(newTicket.ticket, 'check_in', false)}
            />
          </Notice>
        ) : (
          <Button
            variant="primary"
            block
            icon="ticket"
            label={newTicket.step === 'creating' ? 'Creating ticket' : 'New ticket'}
            disabled={newTicket.step === 'creating' || newTicket.step === 'consent'}
            onPress={() => void createTicket()}
          />
        )}
      </Section>

      <View style={{ height: 1, backgroundColor: theme.colors.line }} />

      <Section heading="Re-check" body="For a patient who already has a ticket">
        <TicketEntry onFound={recheck} />
        <Button
          variant="secondary"
          block
          icon="scan"
          label="Find ticket by face"
          accessibilityHint="For patients who turned on face match at check-in"
          onPress={() => router.push('/camera/match')}
        />
        <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>
          Face match works only for patients who turned it on at check-in
        </Text>
      </Section>

      {newTicket.step === 'consent' ? (
        <ConsentSheet
          visible
          ticket={newTicket.ticket}
          busy={newTicket.saving}
          onDecline={() => startSitting(newTicket.ticket, 'check_in', false)}
          onAccept={() => void acceptFaceMatch(newTicket.ticket)}
        />
      ) : null}
    </Screen>
  );
}

function Section({ heading, body, children }: { heading: string; body: string; children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View style={{ gap: theme.space.space3 }}>
      <View style={{ gap: theme.space.space1 }}>
        <Text accessibilityRole="header" style={[theme.type.heading, { color: theme.colors.ink }]}>
          {heading}
        </Text>
        <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>{body}</Text>
      </View>
      {children}
    </View>
  );
}
