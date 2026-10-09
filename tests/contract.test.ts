import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_POLL_INTERVAL_MS, CHAT_WAIT_BUDGET_MS } from "../src/lib/chat-service";
import {
  chatRequestSchema,
  normalizeReply,
  publicChatResponseSchema,
} from "../src/lib/contract";
import { kvValueToString } from "../src/lib/kv";
import { wakeBodyKeys } from "../src/lib/wake";
import { WEBSITE_SUPPORT_SOURCE, type ProspectHandoff } from "../src/lib/trello-types";

const sessionId = "00000000-0000-4000-8000-000000000001";

describe("public contract", () => {
  it("accepts the widget request", () => {
    const parsed = chatRequestSchema.parse({
      message: "  Hello  ",
      session_id: sessionId,
      channel: "website",
    });
    expect(parsed.message).toBe("Hello");
    expect(parsed.channel).toBe("website");
  });

  it("rejects bad input", () => {
    expect(chatRequestSchema.safeParse({}).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        message: "   ",
        session_id: sessionId,
        channel: "website",
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        message: "Hello",
        session_id: "not-a-uuid",
        channel: "website",
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        message: "Hello",
        session_id: sessionId,
        channel: "sms",
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        message: "Hello",
        session_id: sessionId,
        channel: "website",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("normalizes string quick replies to caption objects", () => {
    const reply = normalizeReply({
      messages: [
        {
          type: "text",
          text: "Sample reply",
          buttons: [{ type: "url", caption: "Docs", url: "https://example.com/docs" }],
        },
      ],
      quick_replies: ["Alpha", { caption: "Beta" }],
      actions: [{ tag_name: "needs_human" }],
    });
    expect(reply.quick_replies).toEqual([{ caption: "Alpha" }, { caption: "Beta" }]);
    expect(publicChatResponseSchema.safeParse(reply).success).toBe(true);
  });

  it("rejects non-http button urls", () => {
    const parsed = publicChatResponseSchema.safeParse({
      messages: [
        {
          type: "text",
          text: "Sample reply",
          buttons: [{ type: "url", caption: "Bad", url: "javascript:alert(1)" }],
        },
      ],
      quick_replies: [],
      actions: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("bridge invariants", () => {
  it("keeps the wait budget inside the 60s function limit", () => {
    expect(CHAT_WAIT_BUDGET_MS).toBe(55_000);
    expect(CHAT_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(100);
    expect(CHAT_POLL_INTERVAL_MS).toBeLessThanOrEqual(1000);
  });

  it("wakes the bot with only job_id, session_id, and message", () => {
    expect([...wakeBodyKeys()].sort()).toEqual(["job_id", "message", "session_id"]);
  });

  it("does not use an in-memory map in the production kv module", () => {
    const source = readFileSync("src/lib/kv.ts", "utf8");
    expect(source).not.toMatch(/new Map/);
    expect(source).toContain("@upstash/redis");
    expect(source).toContain("KV_REST_API_URL");
    expect(source).toContain("KV_REST_API_TOKEN");
  });

  it("round-trips json values stored through the kv string adapter", () => {
    expect(kvValueToString({ ok: true })).toBe(JSON.stringify({ ok: true }));
    expect(kvValueToString("plain")).toBe("plain");
    expect(kvValueToString(null)).toBeNull();
  });

  it("documents the prospect handoff without calling trello", () => {
    const handoff: ProspectHandoff = {
      list: "PROSPECT",
      emailProvided: true,
      comment: { source: WEBSITE_SUPPORT_SOURCE, summary: "short summary" },
    };
    expect(handoff.comment.source).toBe("website-support-chat");
    const source = readFileSync("src/lib/trello-types.ts", "utf8");
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("commits only placeholder env names", () => {
    const example = readFileSync(".env.example", "utf8");
    const keys = example
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.split("=")[0]);
    expect(keys).toEqual([
      "GROK_SUPPORT_WEBHOOK_URL",
      "GROK_SUPPORT_WEBHOOK_KEY",
      "INTERNAL_API_SECRET",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
      "ALLOWED_ORIGINS",
      "RATE_LIMIT_PER_MIN",
    ]);
    expect(example).not.toMatch(/sk-/);
    expect(example).toContain("https://example.com");
  });

  it("ignores env files, vercel output, dependencies, next build, and coverage", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toMatch(/\.env\*/);
    expect(gitignore).toMatch(/!\.env\.example/);
    expect(gitignore).toMatch(/node_modules/);
    expect(gitignore).toMatch(/\.next/);
    expect(gitignore).toMatch(/\.vercel/);
    expect(gitignore).toMatch(/coverage/);
  });

  it("pins a single hobby region and a 60s chat function", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      regions?: string[];
      functionFailoverRegions?: string[];
      functions?: Record<string, { maxDuration?: number }>;
    };
    expect(vercel.regions).toEqual(["fra1"]);
    expect(vercel.functionFailoverRegions).toBeUndefined();
    expect(vercel.functions?.["src/app/api/chat/route.ts"]?.maxDuration).toBe(60);
  });
});
