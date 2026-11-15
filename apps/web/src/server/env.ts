import * as z from "zod";

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);
const optional = () => z.preprocess(emptyAsUndefined, z.string().optional());

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.preprocess(emptyAsUndefined, z.url().default("http://localhost:3100")),
  RESEND_API_KEY: optional(),
  /** From address for verification emails. EMAIL_FROM is the older name and is read when this is empty. */
  RESEND_FROM: optional(),
  EMAIL_FROM: z.preprocess(emptyAsUndefined, z.string().default("Crowdpulse <onboarding@resend.dev>")),
  EXPO_ACCESS_TOKEN: optional(),
  EXPO_PUSH_URL: z.preprocess(emptyAsUndefined, z.url().default("https://exp.host/--/api/v2/push/send")),
  SITTING_FILES_DIR: z.preprocess(emptyAsUndefined, z.string().default("./recordings")),
  /**
   * How many proxies of ours stand in front of the server (production: Cloudflare and the load
   * balancer, 2). Decides which X-Forwarded-For entry is the caller: see rate-limit.ts.
   */
  TRUSTED_PROXY_HOPS: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(0).max(5).optional()),
  FACE_MODELS_DIR: z.preprocess(emptyAsUndefined, z.string().default("./.models")),
  /** The live-sitting executable that measures on webcam frames. Default: the release build under eval/video-to-sitting. */
  LIVE_SITTING_BIN: optional(),
});

export type Env = z.infer<typeof Env>;

let cached: Env | undefined;

/** Validated server environment. Throws on first use, naming every bad variable. */
export function env(): Env {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment (see apps/web/.env.example):\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
