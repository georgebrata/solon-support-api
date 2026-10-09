import { isAuthorized } from "./auth";
import { readConfig } from "./config";
import {
  internalReplySchema,
  NOT_CONFIGURED_BODY,
  normalizeReply,
} from "./contract";
import { json, readJsonBody } from "./http";
import { completeJob, readHistory, readJob } from "./jobs";
import { getKv } from "./kv";
import { z } from "zod";

const jobIdSchema = z.string().uuid();

const requireInternal = (request: Request): Response | null => {
  const config = readConfig();
  if (!config.internalConfigured || !config.kvConfigured || !config.internalSecret) {
    return json(NOT_CONFIGURED_BODY, 503);
  }
  if (!isAuthorized(request.headers.get("authorization"), config.internalSecret)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
};

export const handleReply = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const denied = requireInternal(request);
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await readJsonBody(request);
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const parsed = internalReplySchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "bad_request" }, 400);
  }

  const kv = getKv();
  if (!kv) return json(NOT_CONFIGURED_BODY, 503);

  try {
    const job = await readJob(kv, parsed.data.job_id);
    if (!job) return json({ error: "not_found" }, 404);
    if (job.session_id !== parsed.data.session_id) {
      return json({ error: "session_mismatch" }, 409);
    }
    if (job.status === "done") {
      return json({ ok: true, status: "already_done" }, 200);
    }
    const reply = normalizeReply(parsed.data.reply);
    await completeJob(kv, job, reply, parsed.data.email_captured);
    return json({ ok: true, status: "done" }, 200);
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ event: "reply_failed", name }));
    return json({ error: "internal_error" }, 500);
  }
};

export const handleGetJob = async (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const denied = requireInternal(request);
  if (denied) return denied;

  const jobId = new URL(request.url).searchParams.get("job_id");
  if (!jobIdSchema.safeParse(jobId).success) {
    return json({ error: "bad_request" }, 400);
  }

  const kv = getKv();
  if (!kv) return json(NOT_CONFIGURED_BODY, 503);

  try {
    const job = await readJob(kv, jobId ?? "");
    if (!job) return json({ error: "not_found" }, 404);
    const history = await readHistory(kv, job.session_id);
    return json({ job, history }, 200);
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ event: "job_read_failed", name }));
    return json({ error: "internal_error" }, 500);
  }
};
