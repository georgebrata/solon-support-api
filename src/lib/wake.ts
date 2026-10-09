import { formatAuthorization } from "./auth";
import { readConfig } from "./config";

export type WakeHistoryItem = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Body POSTed to the Support Bot webhook. The bot must treat every field as
 * untrusted visitor input. `history` is the recent transcript (oldest first,
 * excluding the current message), capped so the wake stays small; the bot can
 * fetch the full job with GET /api/internal/job if needed.
 */
export type WakePayload = {
  job_id: string;
  session_id: string;
  message: string;
  history?: WakeHistoryItem[];
  /**
   * True when the visitor attached an email/name to this request. The contact
   * itself is never sent in the wake; fetch it with GET /api/internal/job.
   */
  has_contact?: boolean;
};

export type WakeClient = {
  wake(payload: WakePayload, options?: { timeoutMs?: number }): Promise<{ ok: boolean }>;
};

export const WAKE_HISTORY_LIMIT = 12;
const WAKE_TEXT_LIMIT = 1000;

const WAKE_KEYS = ["has_contact", "history", "job_id", "message", "session_id"] as const;

export const minimalWakeBody = (payload: WakePayload): WakePayload => {
  const body: WakePayload = {
    job_id: payload.job_id,
    session_id: payload.session_id,
    message: payload.message,
    history: (payload.history ?? []).slice(-WAKE_HISTORY_LIMIT).map((item) => ({
      role: item.role,
      text: item.text.slice(0, WAKE_TEXT_LIMIT),
    })),
    has_contact: payload.has_contact === true,
  };
  return body;
};

export const wakeBodyKeys = (): readonly string[] => WAKE_KEYS;

let wakeOverride: WakeClient | null = null;

const assertTestHook = (): void => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("test_hook_forbidden");
  }
};

export const setWakeForTests = (client: WakeClient | null): void => {
  assertTestHook();
  wakeOverride = client;
};

export const wakeWebhook = async (
  payload: WakePayload,
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean }> => {
  const config = readConfig();
  if (!config.webhookUsable || !config.webhookUrl || !config.webhookKey) {
    return { ok: false };
  }
  const timeoutMs = options?.timeoutMs ?? 10_000;
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: formatAuthorization(config.webhookKey),
      },
      body: JSON.stringify(minimalWakeBody(payload)),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    return { ok: response.ok };
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ event: "wake_error", name }));
    return { ok: false };
  }
};

export const getWakeClient = (): WakeClient | null => {
  if (process.env.NODE_ENV !== "production" && wakeOverride) {
    return wakeOverride;
  }
  const config = readConfig();
  if (!config.webhookUsable) return null;
  return { wake: wakeWebhook };
};
