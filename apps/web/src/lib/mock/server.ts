// An in-browser stand-in for the API routes, used only when NEXT_PUBLIC_API_MOCK=1.
// localStorage "tc-mock" picks a scenario: "empty" (nothing in the waiting room) or "error"
// (every read fails), so loading, empty and error states can be looked at.

import type { ErrorCode, SittingDetailResponse, StreamEvent, TicketListResponse } from '@triagecam/contracts';

import type { StreamHandlers } from '../stream';
import * as data from './data';

const SIGNED_OUT_KEY = 'tc-mock-signed-out';

function scenario(): 'default' | 'empty' | 'error' {
  const value = window.localStorage.getItem('tc-mock');
  return value === 'empty' || value === 'error' ? value : 'default';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fail(status: number, code: ErrorCode, message: string): Response {
  return json(status, { error: { code, message } });
}

const iso = (ms: number) => new Date(ms).toISOString();

function sittingDetail(): SittingDetailResponse {
  const elapsed = Math.min(data.RUNNING_SECONDS - 1, Math.floor((Date.now() - data.runningStart) / 1000));
  const seconds = Array.from({ length: elapsed + 1 }, (_, i) => i);
  return {
    sitting: data.runningSitting(),
    readings: seconds.map(data.runningReading),
    referenceReadings: seconds.map(data.runningReference),
    beatIntervals: [],
    meanAbsoluteErrorBpm: 1.6,
    pairedReadings: seconds.length,
    within5BpmShare: 1,
  };
}

export async function mockFetch(path: string, init: RequestInit): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const url = new URL(path, 'http://mock.invalid');
  const route = url.pathname;
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const mode = scenario();
  const empty = mode === 'empty';

  if (route === '/api/auth/me') {
    if (window.sessionStorage.getItem(SIGNED_OUT_KEY)) return fail(401, 'unauthenticated', 'Sign in to continue');
    return json(200, { user: data.user, session: { kind: 'web', expiresAt: iso(Date.now() + 7 * 86_400_000) } });
  }
  if (route === '/api/auth/sign-in') {
    if (body.password === 'wrong-password') return fail(401, 'invalid_credentials', 'Email or password is incorrect');
    if (String(body.email).startsWith('new@')) return fail(403, 'email_not_verified', 'This email address has not been verified yet');
    window.sessionStorage.removeItem(SIGNED_OUT_KEY);
    return json(200, { user: data.user, expiresAt: iso(Date.now() + 7 * 86_400_000) });
  }
  if (route === '/api/auth/sign-up') {
    if (String(body.email).startsWith('taken@')) return fail(409, 'email_taken', 'An account with this email already exists');
    return json(201, { user: { ...data.user, email: String(body.email), emailVerified: false }, devVerificationToken: 'mock-token' });
  }
  if (route === '/api/auth/verify-email') {
    if (body.token !== 'mock-token') return fail(410, 'token_invalid', 'This verification link has expired or was already used');
    return json(200, { user: data.user });
  }
  if (route === '/api/auth/resend-verification') return json(200, { ok: true, devVerificationToken: 'mock-token' });
  if (route === '/api/auth/sign-out') {
    window.sessionStorage.setItem(SIGNED_OUT_KEY, '1');
    return new Response(null, { status: 204 });
  }

  if (mode === 'error' && method === 'GET') return fail(500, 'internal', 'The server could not complete the request');

  if (route === '/api/devices') return json(200, { devices: empty ? [] : data.devices });
  if (route === '/api/worklist') {
    return json(200, { generatedAt: iso(Date.now()), recheckIntervalMin: data.settings.value.recheckIntervalMin, items: empty ? [] : data.worklistItems() });
  }
  if (route === '/api/tickets') {
    const status = url.searchParams.get('status') ?? 'waiting';
    const items = empty ? [] : data.tickets().filter((ticket) => status === 'all' || ticket.status === status);
    return json(200, { items, nextCursor: null } satisfies TicketListResponse);
  }
  if (route === '/api/settings') {
    if (method === 'PATCH') {
      data.settings.value = { ...data.settings.value, ...body };
      data.settings.updatedAt = iso(Date.now());
    }
    return json(200, { settings: data.settings.value, updatedAt: data.settings.updatedAt });
  }
  if (route === '/api/statistics') return json(200, data.statistics(empty));

  const ticketMatch = /^\/api\/tickets\/(\d+)(\/discharge)?$/.exec(route);
  if (ticketMatch) {
    const number = Number(ticketMatch[1]);
    if (ticketMatch[2]) data.discharged.set(number, data.discharged.get(number) ?? iso(Date.now()));
    const detail = data.ticketDetail(number);
    if (!detail) return fail(404, 'not_found', `There is no ticket ${number}`);
    return json(200, ticketMatch[2] ? { ticket: detail.ticket } : detail);
  }

  const acknowledgeMatch = /^\/api\/flags\/([^/]+)\/acknowledge$/.exec(route);
  if (acknowledgeMatch?.[1]) {
    const id = acknowledgeMatch[1];
    if (!data.acknowledged.has(id)) data.acknowledged.set(id, iso(Date.now()));
    const flag = data.findFlag(id);
    return flag ? json(200, { flag }) : fail(404, 'not_found', 'There is no such flag');
  }

  const sittingMatch = /^\/api\/sittings\/([^/]+)(\/reference)?$/.exec(route);
  if (sittingMatch) {
    if (sittingMatch[2]) return json(200, { accepted: Array.isArray(body.readings) ? body.readings.length : 0 });
    if (sittingMatch[1] === data.runningSittingId) return json(200, sittingDetail());
    return fail(404, 'not_found', 'There is no such sitting');
  }

  return fail(404, 'not_found', `The mock has no route ${method} ${route}`);
}

export function openMockStream({ onEvent, onStatus }: StreamHandlers): () => void {
  let finishedSent = data.runningFinished();
  const opening = setTimeout(() => onStatus('open'), 200);
  const timer = setInterval(() => {
    if (scenario() !== 'default') return;
    const second = Math.floor((Date.now() - data.runningStart) / 1000);
    const events: StreamEvent[] = [];
    if (second < data.RUNNING_SECONDS) {
      events.push({ type: 'reading', sittingId: data.runningSittingId, ticketNumber: data.RUNNING_TICKET, reading: data.runningReading(second) });
    } else if (!finishedSent) {
      finishedSent = true;
      events.push({ type: 'sitting_finished', sitting: data.runningSitting() }, { type: 'worklist_changed', at: iso(Date.now()) });
    }
    events.forEach(onEvent);
  }, 1000);
  return () => {
    clearTimeout(opening);
    clearInterval(timer);
  };
}
