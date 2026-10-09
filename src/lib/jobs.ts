import {
  historyEntrySchema,
  storedJobSchema,
  type ChatRequest,
  type HistoryEntry,
  type PublicChatResponse,
  type StoredJob,
} from "./contract";
import type { KvStore } from "./kv";
import { z } from "zod";

const JOB_TTL_SECONDS = 24 * 60 * 60;
const HISTORY_LIMIT = 40;

const jobKey = (jobId: string): string => `job:${jobId}`;
const historyKey = (sessionId: string): string => `session:${sessionId}:history`;

const parseJson = (raw: string): unknown => {
  return JSON.parse(raw) as unknown;
};

export const readJob = async (kv: KvStore, jobId: string): Promise<StoredJob | null> => {
  const raw = await kv.get(jobKey(jobId));
  if (!raw) return null;
  try {
    const result = storedJobSchema.safeParse(parseJson(raw));
    return result.success ? result.data : null;
  } catch {
    console.error(JSON.stringify({ event: "job_corrupt", job_id: jobId }));
    return null;
  }
};

export const readHistory = async (kv: KvStore, sessionId: string): Promise<HistoryEntry[]> => {
  const raw = await kv.get(historyKey(sessionId));
  if (!raw) return [];
  try {
    const result = z.array(historyEntrySchema).safeParse(parseJson(raw));
    if (!result.success) return [];
    return result.data.slice(-HISTORY_LIMIT);
  } catch {
    console.error(JSON.stringify({ event: "history_corrupt" }));
    return [];
  }
};

const saveJob = async (kv: KvStore, job: StoredJob): Promise<void> => {
  const checked = storedJobSchema.parse(job);
  await kv.set(jobKey(checked.job_id), JSON.stringify(checked), { ex: JOB_TTL_SECONDS });
};

const appendHistory = async (kv: KvStore, sessionId: string, entry: HistoryEntry): Promise<void> => {
  const checked = historyEntrySchema.parse(entry);
  const current = await readHistory(kv, sessionId);
  const next = [...current, checked].slice(-HISTORY_LIMIT);
  await kv.set(historyKey(sessionId), JSON.stringify(next), { ex: JOB_TTL_SECONDS });
};

export const createPendingJob = async (kv: KvStore, input: ChatRequest): Promise<StoredJob> => {
  const now = new Date().toISOString();
  const job: StoredJob = {
    job_id: crypto.randomUUID(),
    session_id: input.session_id,
    status: "pending",
    message: input.message,
    channel: "website",
    created_at: now,
    updated_at: now,
  };
  if (input.email) job.email = input.email;
  if (input.name) job.name = input.name;
  await saveJob(kv, job);
  await appendHistory(kv, job.session_id, {
    at: now,
    job_id: job.job_id,
    role: "user",
    message: input.message,
  });
  return job;
};

export const completeJob = async (
  kv: KvStore,
  job: StoredJob,
  reply: PublicChatResponse,
  emailCaptured?: boolean,
): Promise<StoredJob> => {
  const now = new Date().toISOString();
  const next: StoredJob = {
    ...job,
    status: "done",
    reply,
    updated_at: now,
  };
  if (emailCaptured !== undefined) {
    next.email_captured = emailCaptured;
  }
  await saveJob(kv, next);
  await appendHistory(kv, next.session_id, {
    at: now,
    job_id: next.job_id,
    role: "assistant",
    reply,
  });
  return next;
};
