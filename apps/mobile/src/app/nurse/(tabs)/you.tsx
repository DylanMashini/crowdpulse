import type { Settings, SettingsResponse, UpdateSettingsRequest } from '@triagecam/contracts';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { RolePicker } from '@/components/RolePicker';
import { Stepper } from '@/components/Stepper';
import { Switch } from '@/components/Switch';
import { Section, TabScreen } from '@/components/TabScreen';
import { useScopedTheme } from '@/components/ThemeScope';
import { useLoadOn } from '@/hooks/useLoadOn';
import { api, errorMessage } from '@/lib/api';
import { clockTime, sentences } from '@/lib/format';
import { useNurse } from '@/lib/nurse/NurseProvider';
import { connectionText } from '@/lib/nurse/nurseFormat';
import { useSession } from '@/lib/session/SessionProvider';
import { useAccountActions } from '@/lib/session/useAccountActions';
import { fonts } from '@/theme';
import { Text } from '@/components/Text';

/** The account, how flags reach this phone, the station's flag rules, and the phone's role. */
export default function You() {
  const theme = useScopedTheme();
  const { colors } = theme;
  const { state } = useSession();
  const { push, connection, revision, failure: unreachable } = useNurse();
  const role = state.status === 'signedIn' ? (state.device?.role ?? null) : null;
  const { busy, failure: roleFailure, changeRole, confirmSignOut } = useAccountActions(role);

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);

  // Quick taps send one request each. `saves` counts the ones in the air and `lastSave`
  // names the newest, so an answer that is already out of date never reaches the screen.
  const saves = useRef(0);
  const lastSave = useRef(0);
  /** The newest answer from the server: what the screen returns to when a save fails. */
  const confirmed = useRef<SettingsResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await api.settings();
      confirmed.current = answer;
      // A save in the air will bring a newer answer than this one.
      if (saves.current === 0) setSettings(answer);
      setLoadFailure(null);
    } catch (error) {
      setLoadFailure(errorMessage(error));
    }
  }, []);

  // The rules are shared: the dashboard or another phone may have changed them.
  useLoadOn(load, revision);

  /**
   * Shows the change at once, then keeps the server's answer to the newest change. When a
   * save fails the screen goes back to what the server holds, not to a value remembered here.
   */
  const change = async (changes: UpdateSettingsRequest) => {
    if (!settings) return;
    lastSave.current += 1;
    const mine = lastSave.current;
    saves.current += 1;
    setSaveFailure(null);
    setSettings((current) => (current ? { ...current, settings: { ...current.settings, ...changes } } : current));
    let failed = false;
    try {
      const answer = await api.updateSettings(changes);
      confirmed.current = answer;
      if (lastSave.current === mine) setSettings(answer);
    } catch (error) {
      failed = true;
      setSaveFailure(errorMessage(error));
    } finally {
      saves.current -= 1;
    }
    if (failed && saves.current === 0) {
      setSettings(confirmed.current);
      await load();
    }
  };

  if (state.status !== 'signedIn') return null;
  const rules: Settings | null = settings?.settings ?? null;

  return (
    <TabScreen title="You" subtitle={state.user.email} onRefresh={load}>
      <Section heading="Notifications">
        <Panel>
          <Detail
            label="Push to this phone"
            value={push == null ? 'Checking' : push.available ? 'On' : 'Off'}
            note={
              push == null
                ? undefined
                : push.available
                  ? 'A new flag arrives as a notification, also when the app is closed'
                  : sentences(push.reason, 'New flags still appear as a banner while the app is open')
            }
          />
          {push && !push.available && push.fixInSettings ? (
            <Button variant="secondary" label="Open the Settings app" onPress={() => void Linking.openSettings()} />
          ) : null}
          <Detail label="Updates while the app is open" value={connectionText(connection)} />
        </Panel>
      </Section>

      <Section heading="Flag rules">
        <Text style={[theme.type.body, { color: colors.inkMuted }]}>
          Shared by the whole station: a change here applies to every phone and the dashboard
        </Text>
        {!rules ? (
          // The frame already says so, with the one Try again, when the server cannot be reached.
          unreachable ? null : loadFailure ? (
            <Notice title="The flag rules did not load" body={loadFailure}>
              <Button variant="secondary" block label="Try again" onPress={() => void load()} />
            </Notice>
          ) : (
            <Notice title="Loading the flag rules" />
          )
        ) : (
          <Panel>
            <Stepper
              label="Re-check interval"
              hint="A patient is overdue after this long without an observation"
              value={rules.recheckIntervalMin}
              unit="min"
              min={5}
              max={240}
              step={5}
              onChange={(next) => void change({ recheckIntervalMin: next })}
            />
            <Rule />
            <Stepper
              label="Quiet time per patient"
              hint="The shortest gap between two notifications about one patient"
              value={rules.notifyCooldownMin}
              unit="min"
              min={0}
              max={240}
              step={5}
              onChange={(next) => void change({ notifyCooldownMin: next })}
            />
            <Rule />
            <Stepper
              label="Pulse change"
              hint="Flags a pulse this far from the check-in value"
              value={rules.pulseDeltaBpm}
              unit="bpm"
              min={5}
              max={100}
              step={5}
              onChange={(next) => void change({ pulseDeltaBpm: next })}
            />
            <Rule />
            <Stepper
              label="Breathing change"
              hint="Flags a breathing rate this far from the check-in value"
              value={rules.breathingDeltaPerMin}
              unit="per min"
              min={1}
              max={30}
              step={1}
              onChange={(next) => void change({ breathingDeltaPerMin: next })}
            />
            <Rule />
            <Switch
              label="Flag a change from check-in"
              hint="Pulse or breathing outside the changes above, on two sittings in a row"
              checked={rules.baselineShiftEnabled}
              onChange={(next) => void change({ baselineShiftEnabled: next })}
            />
            <Switch
              label="Flag a rising score"
              hint="A partial NEWS2 score above check-in, on two sittings in a row"
              checked={rules.scoreRiseEnabled}
              onChange={(next) => void change({ scoreRiseEnabled: next })}
            />
            <Switch
              label="Flag overdue re-checks"
              hint="Nobody observed for longer than the re-check interval"
              checked={rules.overdueEnabled}
              onChange={(next) => void change({ overdueEnabled: next })}
            />
            {saveFailure ? <Notice title="The change was not saved" body={saveFailure} /> : null}
            {settings ? (
              <Text style={[theme.type.caption, { color: colors.inkMuted }]}>
                Last changed {clockTime(settings.updatedAt)}
              </Text>
            ) : null}
          </Panel>
        )}
      </Section>

      <Section heading="Role of this phone">
        <RolePicker value={role} onChange={(next) => void changeRole(next)} disabled={busy} />
        {roleFailure ? <Notice title="The role was not changed" body={roleFailure} /> : null}
      </Section>

      <Section heading="Account">
        <Panel>
          <Detail label="Signed in as" value={state.user.email} />
          <Detail label="Server" value={api.baseUrl} />
        </Panel>
        <Button variant="secondary" block label="Sign out" onPress={confirmSignOut} />
      </Section>
    </TabScreen>
  );

}

function Panel({ children }: { children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View
      style={{
        padding: theme.space.space4,
        gap: theme.space.space4,
        borderWidth: 1,
        borderColor: theme.colors.line,
        borderRadius: theme.radius.radiusXl,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      {children}
    </View>
  );
}

function Rule() {
  const theme = useScopedTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.line }} />;
}

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  const theme = useScopedTheme();
  const { colors } = theme;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{label}</Text>
      <Text selectable style={[theme.type.bodyTouch, { fontFamily: fonts.sans[600], color: colors.ink }]}>
        {value}
      </Text>
      {note ? <Text style={[theme.type.caption, { color: colors.inkMuted }]}>{note}</Text> : null}
    </View>
  );
}
