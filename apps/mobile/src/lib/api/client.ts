import { ErrorResponse } from '@triagecam/contracts';

import { ApiError } from './errors.ts';

type Parser<T> = { parse: (data: unknown) => T };

export type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** A path from `routes` in @triagecam/contracts. */
  path: string;
  query?: Record<string, string | number | undefined>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as it is, with this content type. */
  raw?: { body: Blob | string; contentType: string };
};

export type ApiClientConfig = {
  /** Base URL without a trailing slash. Every request is baseUrl + path. */
  baseUrl: string;
  getToken: () => string | null;
  /** Called when the server says the session is gone, so the app can return to sign-in. */
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type ApiClient = {
  baseUrl: string;
  /** Sends a request and checks the answer against a contract schema. */
  request<T>(options: RequestOptions, schema: Parser<T>): Promise<T>;
  /** Sends a request whose answer has no body worth reading (204). */
  send(options: RequestOptions): Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function buildUrl(baseUrl: string, { path, query }: RequestOptions): string {
  const pairs = Object.entries(query ?? {})
    .filter((pair): pair is [string, string | number] => pair[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return baseUrl + path + (pairs.length > 0 ? `?${pairs.join('&')}` : '');
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { baseUrl } = config;
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // ngrok's free tier answers a browser-warning page without this.
      'ngrok-skip-browser-warning': '1',
    };
    const token = config.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: Blob | string | undefined;
    if (options.raw) {
      headers['Content-Type'] = options.raw.contentType;
      body = options.raw.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(buildUrl(baseUrl, options), {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        'network',
        controller.signal.aborted
          ? `The server at ${baseUrl} did not answer within ${Math.round(timeoutMs / 1000)} s. Check that it is running and that the tunnel is open.`
          : `Cannot reach the server at ${baseUrl}. Check that it is running and that the tunnel is open.`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return response;
    throw await failure(response);
  }

  async function failure(response: Response): Promise<ApiError> {
    const parsed = ErrorResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      // A tunnel or proxy answered, not the Triage Cam server.
      return new ApiError(
        'http',
        `The server at ${baseUrl} answered ${response.status} without a Triage Cam error. Check that the tunnel points at the web server.`,
        { status: response.status },
      );
    }
    const { code, message } = parsed.data.error;
    if (code === 'unauthenticated') config.onUnauthenticated?.();
    return new ApiError('http', message, { code, status: response.status });
  }

  return {
    baseUrl,
    async request(options, schema) {
      const response = await call(options);
      const data: unknown = await response.json().catch(() => undefined);
      try {
        return schema.parse(data);
      } catch {
        throw new ApiError(
          'invalid_response',
          `The server at ${baseUrl} sent an answer this app does not understand. The app and the server may be different versions.`,
          { status: response.status },
        );
      }
    },
    async send(options) {
      await call(options);
    },
  };
}
