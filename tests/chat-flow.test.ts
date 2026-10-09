import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as chatPost, OPTIONS as chatOptions } from "../src/app/api/chat/route";
import { GET as jobGet } from "../src/app/api/internal/job/route";
import { POST as replyPost } from "../src/app/api/internal/reply/route";
import { formatAuthorization, secretsMatch } from "../src/lib/auth";
import { setChatTimingForTests } from "../src/lib/chat-service";
import { NOT_CONFIGURED_BODY, TIMEOUT_REPLY, WAKE_FAILED_REPLY } from "../src/lib/contract";
import { setKvForTests } from "../src/lib/kv";
import { setWakeForTests, wakeWebhook, type WakePayload } from "../src/lib/wake";
import { createFakeKv } from "./fake-kv";
import { applyTestEnv, clearTestEnv } from "./test-env";

const sessionId = "00000000-0000-4000-8000-000000000001";
const origin = "https://example.com";

const chatRequest = (body: unknown, headers?: Record<string, string>): Request => {
  return new Request("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
};

const widgetBody = {
  message: "Hello",
  session_id: sessionId,
  channel: "website",
};

const sampleReply = {
  messages: [
    {
      type: "text",
      text: "Sample reply",
      buttons: [{ type: "url", caption: "Docs", url: "https://example.com/docs" }],
    },
  ],
  quick_replies: ["Alpha", { caption: "Beta" }],
  actions: [{ tag_name: "needs_human" }],
};

const authorizedReply = (body: unknown, token = process.env.INTERNAL_API_SECRET ?? ""): Request => {
  return new Request("http://127.0.0.1:3000/api/internal/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: formatAuthorization(token),
    },
    body: JSON.stringify(body),
  });
};

describe("chat flow", () => {
  beforeEach(() => {
    clearTestEnv();
    applyTestEnv();
    setKvForTests(createFakeKv());
    setWakeForTests(null);
    setChatTimingForTests({ pollIntervalMs: 15, timeoutMs: 200 });
  });

  afterEach(() => {
    setKvForTests(null);
    setWakeForTests(null);
    setChatTimingForTests(null);
    clearTestEnv();
  });

  it("returns the normalized reply after the bot writes it", async () => {
    const wakeCalls: WakePayload[] = [];
    const seenHeaders: string[] = [];
    setWakeForTests({
      async wake(payload) {
        wakeCalls.push(payload);
        seenHeaders.push(formatAuthorization(process.env.GROK_SUPPORT_WEBHOOK_KEY ?? ""));
        const reply = await replyPost(
          authorizedReply({
            job_id: payload.job_id,
            session_id: payload.session_id,
            reply: sampleReply,
            email_captured: false,
          }),
        );
        expect(reply.status).toBe(200);
        return { ok: true };
      },
    });

    const email = ["visitor", "example.com"].join("@");
    const response = await chatPost(
      chatRequest({
        ...widgetBody,
        email,
        name: "Visitor",
      }),
    );
    const body = (await response.json()) as {
      messages: Array<{ type: string; text: string }>;
      quick_replies: Array<{ caption: string }>;
      actions: Array<{ tag_name: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      {
        type: "text",
        text: "Sample reply",
        buttons: [{ type: "url", caption: "Docs", url: "https://example.com/docs" }],
      },
    ]);
    expect(body.quick_replies).toEqual([{ caption: "Alpha" }, { caption: "Beta" }]);
    expect(body.actions).toEqual([{ tag_name: "needs_human" }]);
    expect(wakeCalls).toHaveLength(1);
    expect(Object.keys(wakeCalls[0] ?? {}).sort()).toEqual(["job_id", "message", "session_id"]);
    expect(wakeCalls[0]?.message).toBe("Hello");
    expect(JSON.stringify(wakeCalls[0])).not.toContain(email);
    expect(seenHeaders[0]).toBe(formatAuthorization("test-webhook-key"));

    const jobId = wakeCalls[0]?.job_id ?? "";
    const jobResponse = await jobGet(
      new Request(`http://127.0.0.1:3000/api/internal/job?job_id=${jobId}`, {
        headers: { authorization: formatAuthorization(process.env.INTERNAL_API_SECRET ?? "") },
      }),
    );
    const jobBody = (await jobResponse.json()) as {
      job: { status: string; email?: string; name?: string };
      history: Array<{ role: string }>;
    };
    expect(jobResponse.status).toBe(200);
    expect(jobBody.job.status).toBe("done");
    expect(jobBody.job.email).toBe(email);
    expect(jobBody.job.name).toBe("Visitor");
    expect(jobBody.history.map((entry) => entry.role)).toEqual(["user", "assistant"]);
  });

  it("returns a needs_human fallback when the reply never arrives", async () => {
    setWakeForTests({
      async wake() {
        return { ok: true };
      },
    });
    const response = await chatPost(chatRequest(widgetBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TIMEOUT_REPLY);
  });

  it("returns a needs_human fallback when the wake call fails", async () => {
    setWakeForTests({
      async wake() {
        return { ok: false };
      },
    });
    const response = await chatPost(chatRequest(widgetBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(WAKE_FAILED_REPLY);
  });

  it("rejects an unauthorized internal call", async () => {
    const missing = await replyPost(
      new Request("http://127.0.0.1:3000/api/internal/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id: sessionId, session_id: sessionId, reply: sampleReply }),
      }),
    );
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "unauthorized" });

    const wrong = await replyPost(authorizedReply({ job_id: sessionId }, "nope"));
    expect(wrong.status).toBe(401);
    expect(secretsMatch("nope", "test-internal-secret")).toBe(false);
    expect(secretsMatch("test-internal-secret", "test-internal-secret")).toBe(true);
  });

  it("rejects bad input", async () => {
    const empty = await chatPost(chatRequest({}));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "bad_request" });

    const invalid = await chatPost(
      new Request("http://127.0.0.1:3000/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: "{",
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects a browser origin that is not allowed", async () => {
    const response = await chatPost(
      chatRequest(widgetBody, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await chatOptions(
      new Request("http://127.0.0.1:3000/api/chat", {
        method: "OPTIONS",
        headers: { origin },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("returns not_configured when the bridge env is missing", async () => {
    clearTestEnv();
    const response = await chatPost(chatRequest(widgetBody));
    const raw = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(raw)).toEqual(NOT_CONFIGURED_BODY);
    expect(raw).not.toContain("test-webhook-key");
    expect(raw).not.toContain("test-kv-token");
  });

  it("rate limits a session", async () => {
    process.env.RATE_LIMIT_PER_MIN = "1";
    setWakeForTests({
      async wake() {
        return { ok: false };
      },
    });
    const first = await chatPost(chatRequest(widgetBody));
    expect(first.status).toBe(200);
    const second = await chatPost(chatRequest(widgetBody));
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "rate_limited" });
  });

  it("treats a non-https webhook url as not configured", async () => {
    process.env.GROK_SUPPORT_WEBHOOK_URL = "http://example.com/webhook/support-chat";
    const response = await chatPost(chatRequest(widgetBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(NOT_CONFIGURED_BODY);
  });

  it("posts only the minimal wake body to the configured https webhook", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response("{}", { status: 200 });
    };
    try {
      const result = await wakeWebhook({
        job_id: sessionId,
        session_id: sessionId,
        message: "Hello",
      });
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://example.com/webhook/support-chat");
      expect(calls[0]?.init?.redirect).toBe("error");
      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get("authorization")).toBe(formatAuthorization("test-webhook-key"));
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        job_id: sessionId,
        session_id: sessionId,
        message: "Hello",
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects a reply whose session does not match the job", async () => {
    let jobId = "";
    setWakeForTests({
      async wake(payload) {
        jobId = payload.job_id;
        return { ok: false };
      },
    });
    await chatPost(chatRequest(widgetBody));
    const mismatch = await replyPost(
      authorizedReply({
        job_id: jobId,
        session_id: "00000000-0000-4000-8000-000000000099",
        reply: {
          messages: [{ type: "text", text: "Sample reply" }],
          quick_replies: [],
          actions: [],
        },
      }),
    );
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: "session_mismatch" });
  });
});
