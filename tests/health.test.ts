import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "../src/app/api/health/route";
import { runtime as chatRuntime, maxDuration } from "../src/app/api/chat/route";
import { runtime as replyRuntime } from "../src/app/api/internal/reply/route";
import { runtime as jobRuntime } from "../src/app/api/internal/job/route";
import { runtime as healthRuntime } from "../src/app/api/health/route";
import packageJson from "../package.json";
import { clearTestEnv } from "./test-env";

describe("GET /api/health", () => {
  beforeEach(() => {
    clearTestEnv();
  });

  afterEach(() => {
    clearTestEnv();
  });

  it("stays green when env vars are missing and does not echo values", async () => {
    process.env.KV_REST_API_TOKEN = "test-kv-token";
    process.env.GROK_SUPPORT_WEBHOOK_KEY = "test-webhook-key";
    process.env.INTERNAL_API_SECRET = "test-internal-secret";

    const response = await healthGet();
    const raw = await response.text();
    const body = JSON.parse(raw) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "solon-support-api",
      version: packageJson.version,
      commit: "unknown",
      time: body.time,
      kv: "not_configured",
      webhook: "not_configured",
    });
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(raw).not.toContain("test-kv-token");
    expect(raw).not.toContain("test-webhook-key");
    expect(raw).not.toContain("test-internal-secret");
    expect(raw).not.toContain("KV_REST_API");
  });

  it("reports configured only when both values of a pair are present", async () => {
    process.env.KV_REST_API_URL = "https://example.com";
    process.env.KV_REST_API_TOKEN = "test-kv-token";
    process.env.GROK_SUPPORT_WEBHOOK_URL = "https://example.com/webhook/support-chat";
    const missingKey = await healthGet();
    const missingBody = (await missingKey.json()) as { kv: string; webhook: string };
    expect(missingBody.kv).toBe("configured");
    expect(missingBody.webhook).toBe("not_configured");

    process.env.GROK_SUPPORT_WEBHOOK_KEY = "test-webhook-key";
    const ready = await healthGet();
    const readyBody = (await ready.json()) as { kv: string; webhook: string; ok: boolean };
    expect(ready.status).toBe(200);
    expect(readyBody.ok).toBe(true);
    expect(readyBody.webhook).toBe("configured");
    expect(JSON.stringify(readyBody)).not.toContain("test-kv-token");
    expect(JSON.stringify(readyBody)).not.toContain("test-webhook-key");
  });

  it("uses the node runtime on every route", () => {
    expect(healthRuntime).toBe("nodejs");
    expect(chatRuntime).toBe("nodejs");
    expect(replyRuntime).toBe("nodejs");
    expect(jobRuntime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });
});
