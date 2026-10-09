import { formatAuthorization } from "./auth";
import { readConfig } from "./config";

export type WakePayload = {
  job_id: string;
  session_id: string;
  message: string;
};

export type WakeClient = {
  wake(payload: WakePayload, options?: { timeoutMs?: number }): Promise<{ ok: boolean }>;
};

const WAKE_KEYS = ["job_id", "message", "session_id"] as const;

export const minimalWakeBody = (payload: WakePayload): WakePayload => {
  return {
    job_id: payload.job_id,
    session_id: payload.session_id,
    message: payload.message,
  };
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
