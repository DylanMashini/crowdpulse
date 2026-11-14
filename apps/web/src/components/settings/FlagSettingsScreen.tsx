'use client';

import type { Settings } from '@triagecam/contracts';
import { useState, type FormEvent } from 'react';

import { Button, Field, Switch } from '@/components/ds';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

type NumberKey = 'pulseDeltaBpm' | 'breathingDeltaPerMin' | 'recheckIntervalMin' | 'notifyCooldownMin';
type SwitchKey = 'scoreRiseEnabled' | 'baselineShiftEnabled' | 'overdueEnabled';

/** Ranges are the server's own (docs/CONTRACTS.md, Settings). */
const NUMBERS: Record<NumberKey, { label: string; unit: string; min: number; max: number; hint: string }> = {
  pulseDeltaBpm: {
    label: 'Pulse change',
    unit: 'bpm',
    min: 1,
    max: 100,
    hint: 'From baseline, on two observations in a row. 1 to 100.',
  },
  breathingDeltaPerMin: {
    label: 'Breathing change',
    unit: 'breaths per min',
    min: 1,
    max: 30,
    hint: 'From baseline, on two observations in a row. 1 to 30.',
  },
  recheckIntervalMin: {
    label: 'Re-check interval',
    unit: 'min',
    min: 1,
    max: 240,
    hint: 'A patient is overdue after this long without an observation. 1 to 240.',
  },
  notifyCooldownMin: {
    label: 'Wait between notifications',
    unit: 'min',
    min: 0,
    max: 240,
    hint: 'For one patient, on the nurse phones. 0 to 240.',
  },
};

const NUMBER_KEYS = Object.keys(NUMBERS) as NumberKey[];
const SWITCH_KEYS: SwitchKey[] = ['scoreRiseEnabled', 'baselineShiftEnabled', 'overdueEnabled'];

function problem(key: NumberKey, text: string): string | null {
  const { min, max } = NUMBERS[key];
  const value = Number(text);
  if (text.trim() === '' || !Number.isInteger(value) || value < min || value > max) return `Enter a whole number from ${min} to ${max}`;
  return null;
}

export function FlagSettingsScreen() {
  const settings = useResource('settings', api.settings);

  return (
    <>
      <PageHeader title="Flag settings" description="The rules that raise a flag in the waiting room" />
      {settings.loading ? <StateMessage kind="loading" title="Loading the flag rules" /> : null}
      {settings.error && !settings.data ? (
        <StateMessage kind="error" title="The flag rules could not be loaded" onRetry={settings.reload}>
          {settings.error.message}
        </StateMessage>
      ) : null}
      {settings.data ? <SettingsForm key={settings.data.updatedAt} saved={settings.data.settings} savedAt={settings.data.updatedAt} onSaved={settings.reload} /> : null}
    </>
  );
}

function SettingsForm({ saved, savedAt, onSaved }: { saved: Settings; savedAt: string; onSaved: () => void }) {
  const [numbers, setNumbers] = useState<Record<NumberKey, string>>(() => ({
    pulseDeltaBpm: String(saved.pulseDeltaBpm),
    breathingDeltaPerMin: String(saved.breathingDeltaPerMin),
    recheckIntervalMin: String(saved.recheckIntervalMin),
    notifyCooldownMin: String(saved.notifyCooldownMin),
  }));
  const [switches, setSwitches] = useState<Record<SwitchKey, boolean>>(() => ({
    scoreRiseEnabled: saved.scoreRiseEnabled,
    baselineShiftEnabled: saved.baselineShiftEnabled,
    overdueEnabled: saved.overdueEnabled,
  }));
  const [status, setStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const errors = Object.fromEntries(NUMBER_KEYS.map((key) => [key, problem(key, numbers[key])])) as Record<NumberKey, string | null>;
  const invalid = NUMBER_KEYS.some((key) => errors[key] !== null);
  const dirty = NUMBER_KEYS.some((key) => numbers[key].trim() !== String(saved[key])) || SWITCH_KEYS.some((key) => switches[key] !== saved[key]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !dirty) return;
    setStatus({ busy: true, error: null });
    try {
      await api.updateSettings({
        pulseDeltaBpm: Number(numbers.pulseDeltaBpm),
        breathingDeltaPerMin: Number(numbers.breathingDeltaPerMin),
        recheckIntervalMin: Number(numbers.recheckIntervalMin),
        notifyCooldownMin: Number(numbers.notifyCooldownMin),
        ...switches,
      });
      setStatus({ busy: false, error: null });
      // The form is keyed on the saved time, so reloading replaces it with the stored values.
      onSaved();
    } catch (error) {
      setStatus({ busy: false, error: errorMessage(error) });
    }
  };

  const field = (key: NumberKey) => (
    <div className="w-[340px] max-w-full">
      <Field
        block
        label={NUMBERS[key].label}
        unit={NUMBERS[key].unit}
        hint={NUMBERS[key].hint}
        error={errors[key] ?? undefined}
        inputMode="numeric"
        name={key}
        value={numbers[key]}
        onChange={(event) => setNumbers((previous) => ({ ...previous, [key]: event.target.value }))}
      />
    </div>
  );
  const toggle = (key: SwitchKey, label: string, hint: string) => (
    <Switch label={label} hint={hint} checked={switches[key]} onChange={(next) => setSwitches((previous) => ({ ...previous, [key]: next }))} />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-[760px] flex-col gap-5">
      <Panel heading="Trend rules">
        <div className="flex flex-col gap-4">
          {toggle('scoreRiseEnabled', 'Flag a rise in partial score', 'The two latest observations both score higher than baseline')}
          {toggle('baselineShiftEnabled', 'Flag a move from baseline', 'Pulse or breathing differs from baseline by more than the amounts below. Baseline is check-in, or the first re-check with a reading')}
          <div className="flex flex-wrap gap-x-5 gap-y-4 border-t border-line pt-4">
            {field('pulseDeltaBpm')}
            {field('breathingDeltaPerMin')}
          </div>
        </div>
      </Panel>

      <Panel heading="Re-checks">
        <div className="flex flex-col gap-4">
          {toggle('overdueEnabled', 'Flag overdue patients', 'A waiting patient has gone too long without an observation')}
          <div className="flex flex-wrap gap-x-5 gap-y-4 border-t border-line pt-4">
            {field('recheckIntervalMin')}
            {field('notifyCooldownMin')}
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="primary" disabled={status.busy || invalid || !dirty}>
          {status.busy ? 'Saving rules' : 'Save rules'}
        </Button>
        {status.error ? (
          <p role="alert" className="font-medium text-critical">
            The rules were not saved: {status.error}
          </p>
        ) : (
          <p role="status" className="type-caption text-ink-muted">
            {invalid ? 'Correct the marked fields to save' : dirty ? 'Changes are not saved yet' : `Saved at ${clockTime(savedAt)}. They apply from the next sitting and the next overdue check.`}
          </p>
        )}
      </div>
    </form>
  );
}
