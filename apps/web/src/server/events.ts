import type { PatientRef, StreamEvent } from "@triagecam/contracts";

type Listener = (event: StreamEvent) => void;

// In memory and per process: the app runs as one server process (docs/CONTRACTS.md, section 4).
const globalForEvents = globalThis as typeof globalThis & { triagecamListeners?: Set<Listener> };
const listeners = (globalForEvents.triagecamListeners ??= new Set());

/** Sends an event to every open GET /api/stream connection. Events are not kept. */
export function publish(event: StreamEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const worklistChanged = (): void => publish({ type: "worklist_changed", at: new Date().toISOString() });

export const patientChanged = (patient: PatientRef): void =>
  publish({ type: "patient_changed", patientNumber: patient.number, patient, at: new Date().toISOString() });
