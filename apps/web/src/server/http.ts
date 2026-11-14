import { type ErrorCode, type ErrorResponse, errorStatus, Id, TicketNumber } from "@triagecam/contracts";
import * as z from "zod";

/** Throw from anywhere in a route to answer with the standard error body. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Turns anything a route threw into the error response of docs/CONTRACTS.md section 5.
 * ApiError keeps its code, a ZodError becomes invalid_request with its issues, and anything
 * else is logged and reported as internal without leaking its message.
 */
export function errorResponse(error: unknown): Response {
  let body: ErrorResponse["error"];
  if (error instanceof ApiError) {
    body = { code: error.code, message: error.message, details: error.details };
  } else if (error instanceof z.ZodError) {
    body = { code: "invalid_request", message: "The request is not valid", details: error.issues };
  } else {
    console.error(error);
    body = { code: "internal", message: "Something went wrong on the server" };
  }
  return Response.json({ error: body } satisfies ErrorResponse, { status: errorStatus[body.code] });
}

type Handler<Context> = (request: Request, context: Context) => Promise<Response>;

/** Wraps a route handler so that anything it throws becomes the standard error response. */
export function route<Context>(handler: Handler<Context>): Handler<Context> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const JSON_BODY_MAX_BYTES = 1_000_000;

/** Parses a JSON body against a schema. An empty body is read as `{}`. */
export async function readJson<Schema extends z.ZodType>(request: Request, schema: Schema): Promise<z.output<Schema>> {
  const tooLarge = new ApiError("payload_too_large", "The request body is too large");
  if (Number(request.headers.get("content-length") ?? 0) > JSON_BODY_MAX_BYTES) throw tooLarge;
  const text = await request.text();
  if (text.length > JSON_BODY_MAX_BYTES) throw tooLarge;
  let value: unknown = {};
  if (text.trim() !== "") {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError("invalid_request", "The request body is not valid JSON");
    }
  }
  return schema.parse(value);
}

export function readQuery<Schema extends z.ZodType>(request: Request, schema: Schema): z.output<Schema> {
  return schema.parse(Object.fromEntries(new URL(request.url).searchParams));
}

const TicketNumberParam = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number).pipe(TicketNumber);

/** A `:number` path segment. Anything that is not a ticket number cannot name a ticket. */
export function ticketNumberParam(value: string): number {
  const parsed = TicketNumberParam.safeParse(value);
  if (!parsed.success) throw new ApiError("not_found", "There is no ticket with that number");
  return parsed.data;
}

/** An `:id` path segment. */
export function idParam(value: string, what: string): string {
  const parsed = Id.safeParse(value);
  if (!parsed.success) throw new ApiError("not_found", `There is no ${what} with that id`);
  return parsed.data;
}

export const noContent = () => new Response(null, { status: 204 });
