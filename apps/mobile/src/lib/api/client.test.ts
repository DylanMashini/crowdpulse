/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WorklistResponse, routes } from '@triagecam/contracts';

import { type ApiClientConfig, createApiClient } from './client.ts';
import { ApiError } from './errors.ts';

const BASE = 'https://clinic.ngrok-free.app';

type Call = { url: string; init: RequestInit };

function clientWith(respond: (call: Call) => Response | Promise<Response>, extra: Partial<ApiClientConfig> = {}) {
  const calls: Call[] = [];
  const client = createApiClient({
    baseUrl: BASE,
    getToken: () => 'token-123',
    fetch: (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }) as typeof fetch,
    ...extra,
  });
  return { client, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const emptyWorklist = { generatedAt: '2026-11-14T03:21:07.512Z', recheckIntervalMin: 30, items: [] };

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, 'expected an ApiError');
    return error;
  }
  throw new Error('expected the request to fail');
}

test('sends the bearer token, the ngrok header and JSON to baseUrl + path', async () => {
  const { client, calls } = clientWith(() => json(200, emptyWorklist));
  const result = await client.request(
    { method: 'POST', path: routes.worklist, query: { status: 'open', limit: 5, skip: undefined }, body: { a: 1 } },
    WorklistResponse,
  );
  assert.deepEqual(result, emptyWorklist);
  assert.equal(calls[0]!.url, `${BASE}/api/worklist?status=open&limit=5`);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer token-123');
  assert.equal(headers['ngrok-skip-browser-warning'], '1');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(calls[0]!.init.body, '{"a":1}');
});

test('leaves the Authorization header out when signed out', async () => {
  const { client, calls } = clientWith(() => json(200, emptyWorklist), { getToken: () => null });
  await client.request({ method: 'GET', path: routes.worklist }, WorklistResponse);
  assert.equal('Authorization' in (calls[0]!.init.headers as Record<string, string>), false);
});

test('a request that cannot connect says the server cannot be reached and names the URL', async () => {
  const { client } = clientWith(() => {
    throw new TypeError('Network request failed');
  });
  const error = await failure(client.request({ method: 'GET', path: routes.worklist }, WorklistResponse));
  assert.equal(error.kind, 'network');
  assert.equal(error.retryable, true);
  assert.match(error.message, /^Cannot reach the server at https:\/\/clinic\.ngrok-free\.app\./);
});

test('a request with no answer in time is a network failure that names the URL', async () => {
  const { client } = clientWith(
    ({ init }) =>
      new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    { timeoutMs: 20 },
  );
  const error = await failure(client.request({ method: 'GET', path: routes.worklist }, WorklistResponse));
  assert.equal(error.kind, 'network');
  assert.match(error.message, /https:\/\/clinic\.ngrok-free\.app did not answer/);
});

test('a contract error keeps its code, status and the server sentence', async () => {
  const { client } = clientWith(() =>
    json(409, { error: { code: 'patient_discharged', message: 'Patient 14 has been discharged' } }),
  );
  const error = await failure(client.request({ method: 'GET', path: routes.patient(14) }, WorklistResponse));
  assert.equal(error.kind, 'http');
  assert.equal(error.code, 'patient_discharged');
  assert.equal(error.status, 409);
  assert.equal(error.message, 'Patient 14 has been discharged');
  assert.equal(error.retryable, false);
});

test('an unauthenticated answer calls the sign-out handler once', async () => {
  let signedOut = 0;
  const { client } = clientWith(
    () => json(401, { error: { code: 'unauthenticated', message: 'Sign in to continue' } }),
    { onUnauthenticated: () => (signedOut += 1) },
  );
  const error = await failure(client.send({ method: 'POST', path: routes.auth.signOut }));
  assert.equal(error.code, 'unauthenticated');
  assert.equal(signedOut, 1);
});

test('wrong credentials do not sign the phone out', async () => {
  let signedOut = 0;
  const { client } = clientWith(
    () => json(401, { error: { code: 'invalid_credentials', message: 'Email or password is wrong' } }),
    { onUnauthenticated: () => (signedOut += 1) },
  );
  await failure(client.send({ method: 'POST', path: routes.auth.signIn }));
  assert.equal(signedOut, 0);
});

test('an error page from the tunnel is reported with its status and the URL', async () => {
  const { client } = clientWith(() => new Response('<html>ERR_NGROK_3200</html>', { status: 502 }));
  const error = await failure(client.request({ method: 'GET', path: routes.worklist }, WorklistResponse));
  assert.equal(error.kind, 'http');
  assert.equal(error.code, null);
  assert.equal(error.status, 502);
  assert.equal(error.retryable, true);
  assert.match(error.message, /https:\/\/clinic\.ngrok-free\.app answered 502/);
});

test('rate limits and server errors can be retried, other refusals cannot', async () => {
  const status = async (code: string, http: number) => {
    const { client } = clientWith(() => json(http, { error: { code, message: 'x' } }));
    return (await failure(client.send({ method: 'POST', path: routes.sittings }))).retryable;
  };
  assert.equal(await status('rate_limited', 429), true);
  assert.equal(await status('internal', 500), true);
  assert.equal(await status('invalid_request', 400), false);
  assert.equal(await status('sitting_finished', 409), false);
});

test('a 2xx body that does not match the contract is an invalid response, not data', async () => {
  const { client } = clientWith(() => json(200, { items: 'nope' }));
  const error = await failure(client.request({ method: 'GET', path: routes.worklist }, WorklistResponse));
  assert.equal(error.kind, 'invalid_response');
  assert.equal(error.retryable, false);
  assert.match(error.message, /https:\/\/clinic\.ngrok-free\.app/);
});

test('send accepts an empty 204', async () => {
  const { client } = clientWith(() => new Response(null, { status: 204 }));
  await client.send({ method: 'POST', path: routes.auth.signOut });
});

test('a raw body goes out unchanged with its content type', async () => {
  const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
  await client.send({
    method: 'PUT',
    path: routes.sittingFile('abc'),
    raw: { body: '{"format":"triagecam.sitting"}\n', contentType: 'application/x-ndjson' },
  });
  assert.equal(calls[0]!.init.body, '{"format":"triagecam.sitting"}\n');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['Content-Type'], 'application/x-ndjson');
});
