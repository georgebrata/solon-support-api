import { readConfig } from "./config";
import {
  chatRequestSchema,
  NOT_CONFIGURED_BODY,
  TIMEOUT_REPLY,
  WAKE_FAILED_REPLY,
  type PublicChatResponse,
} from "./contract";
import { resolveCors } from "./cors";
import { json, readJsonBody } from "./http";
import { createPendingJob, readHistory, readJob } from "./jobs";
import { getKv } from "./kv";
import { allowChat, clientAddress } from "./rate-limit";
import { getWakeClient, WAKE_HISTORY_LIMIT, type WakeHistoryItem } from "./wake";
import type { HistoryEntry } from "./contract";

const historyForWake = (entries: HistoryEntry[]): WakeHistoryItem[] => {
  const items: WakeHistoryItem[] = [];
  for (const entry of entries.slice(-WAKE_HISTORY_LIMIT)) {
    if (entry.role === "user" && entry.message) {
      items.push({ role: "user", text: entry.message });
    } else if (entry.role === "assistant" && entry.reply) {
      const text = entry.reply.messages.map((message) => message.text).join("\n\n");
      if (text) items.push({ role: "assistant", text });
    }
  }
  return items;
};

export const CHAT_POLL_INTERVAL_MS = 400;
export const CHAT_WAIT_BUDGET_MS = 55_000;
const WAKE_TIMEOUT_CAP_MS = 10_000;

type ChatTiming = {
  pollIntervalMs: number;
  timeoutMs: number;
};

let timingOverride: ChatTiming | null = null;

const assertTestHook = (): void => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("test_hook_forbidden");
  }
};

export const setChatTimingForTests = (timing: ChatTiming | null): void => {
  assertTestHook();
  timingOverride = timing;
};

const resolveTiming = (): ChatTiming => {
  if (process.env.NODE_ENV !== "production" && timingOverride) {
    return timingOverride;
  }
  return {
    pollIntervalMs: CHAT_POLL_INTERVAL_MS,
    timeoutMs: CHAT_WAIT_BUDGET_MS,
  };
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const pollForReply = async (
  jobId: string,
  deadline: number,
  intervalMs: number,
): Promise<PublicChatResponse> => {
  const kv = getKv();
  if (!kv) return TIMEOUT_REPLY;
  while (Date.now() < deadline) {
    const job = await readJob(kv, jobId);
    if (job?.status === "done" && job.reply) return job.reply;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }
  const last = await readJob(kv, jobId);
  if (last?.status === "done" && last.reply) return last.reply;
  console.error(JSON.stringify({ event: "chat_timeout", job_id: jobId }));
  return TIMEOUT_REPLY;
};

export const handleChat = async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");
  const cors = resolveCors(origin);
  const configured = readConfig().chatConfigured;
  const corsHeaders = cors.allowed ? cors.headers : {};

  if (request.method === "OPTIONS") {
    if (!configured) return json(NOT_CONFIGURED_BODY, 503);
    if (!cors.allowed) return json({ error: "origin_not_allowed" }, 403);
    return new Response(null, { status: 204, headers: cors.headers });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  if (!configured) {
    return json(NOT_CONFIGURED_BODY, 503, corsHeaders);
  }

  if (!cors.allowed) {
    return json({ error: "origin_not_allowed" }, 403);
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request);
  } catch {
    return json({ error: "bad_request" }, 400, cors.headers);
  }

  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "bad_request" }, 400, cors.headers);
  }

  const config = readConfig();
  const kv = getKv();
  const wake = getWakeClient();
  if (!kv || !wake) {
    return json(NOT_CONFIGURED_BODY, 503, cors.headers);
  }

  try {
    const allowed = await allowChat(kv, {
      sessionId: parsed.data.session_id,
      ip: clientAddress(request),
      limit: config.rateLimitPerMin,
    });
    if (!allowed) {
      return json({ error: "rate_limited" }, 429, {
        ...cors.headers,
        "retry-after": "60",
      });
    }

    const timing = resolveTiming();
    const deadline = Date.now() + timing.timeoutMs;
    const priorHistory = await readHistory(kv, parsed.data.session_id);
    const job = await createPendingJob(kv, parsed.data);
    const wakeBudget = Math.min(WAKE_TIMEOUT_CAP_MS, Math.max(1, deadline - Date.now()));
    const wakeResult = await wake.wake(
      {
        job_id: job.job_id,
        session_id: job.session_id,
        message: job.message,
        history: historyForWake(priorHistory),
        has_contact: Boolean(job.email || job.name),
      },
      { timeoutMs: wakeBudget },
    );

    if (!wakeResult.ok) {
      console.error(JSON.stringify({ event: "wake_failed", job_id: job.job_id }));
      return json(WAKE_FAILED_REPLY, 200, cors.headers);
    }

    const reply = await pollForReply(job.job_id, deadline, timing.pollIntervalMs);
    return json(reply, 200, cors.headers);
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ event: "chat_failed", name }));
    return json({ error: "internal_error" }, 500, cors.headers);
  }
};
