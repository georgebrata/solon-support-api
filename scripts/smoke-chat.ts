/**
 * Smoke test for a deployed (or local) solon-support-api.
 *
 *   npm run smoke -- https://solon-support-api.vercel.app            # health only
 *   npm run smoke -- https://solon-support-api.vercel.app --chat     # health + one real chat round trip
 *   npm run smoke -- <url> --chat --allow-unconfigured                # accept 503 not_configured
 *   npm run smoke -- <url> --chat --message "Ce servicii oferiți?" --origin https://solon.agency
 *
 * Never prints message text or reply content; only status, latency and shape.
 * A chat reply that escalates (needs_human) fails the smoke because it means
 * the Support Bot did not answer in time or the wake failed.
 */
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const optionValues = new Set(
  ["--message", "--origin"].map((name) => option(name)).filter((value) => value !== undefined),
);
const chat = flag("--chat");
const allowUnconfigured = flag("--allow-unconfigured");
const positional = args.find((arg) => !arg.startsWith("--") && !optionValues.has(arg));
const base = (positional ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const message = option("--message") ?? "Bună! Ce servicii oferiți pentru avocați?";
const chatOrigin = option("--origin") ?? "https://solon.agency";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isHealth = (
  value: unknown,
): value is { ok: true; service: string; kv: string; webhook: string } => {
  if (!isRecord(value)) return false;
  return (
    value.ok === true &&
    value.service === "solon-support-api" &&
    (value.kv === "configured" || value.kv === "not_configured") &&
    (value.webhook === "configured" || value.webhook === "not_configured")
  );
};

const tagsOf = (body: unknown): string[] => {
  if (!isRecord(body) || !Array.isArray(body.actions)) return [];
  return body.actions
    .map((action: unknown) => (isRecord(action) ? action.tag_name : undefined))
    .filter((tag): tag is string => typeof tag === "string");
};

const fail = (event: string, extra: Record<string, unknown> = {}): never => {
  console.error(JSON.stringify({ event, ...extra }));
  process.exit(1);
};

const main = async (): Promise<void> => {
  const healthResponse = await fetch(`${base}/api/health`);
  const healthBody: unknown = await healthResponse.json().catch(() => null);
  if (!healthResponse.ok || !isHealth(healthBody)) {
    fail("health_failed", { status: healthResponse.status });
  }
  const health = healthBody as { kv: string; webhook: string };
  console.log(JSON.stringify({ event: "health_ok", kv: health.kv, webhook: health.webhook }));
  if (!chat) return;

  const started = Date.now();
  const chatResponse = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: chatOrigin },
    body: JSON.stringify({ message, session_id: crypto.randomUUID(), channel: "website" }),
    signal: AbortSignal.timeout(70_000),
  });
  const latencyMs = Date.now() - started;
  const chatBody: unknown = await chatResponse.json().catch(() => null);

  if (chatResponse.status === 503 && allowUnconfigured) {
    console.log(JSON.stringify({ event: "chat_not_configured", status: 503, latency_ms: latencyMs }));
    return;
  }
  if (chatResponse.status !== 200) {
    fail("chat_failed", { status: chatResponse.status, latency_ms: latencyMs });
  }
  const tags = tagsOf(chatBody);
  const messageCount =
    isRecord(chatBody) && Array.isArray(chatBody.messages) ? chatBody.messages.length : 0;
  if (messageCount === 0) fail("chat_empty", { latency_ms: latencyMs });
  if (tags.includes("needs_human")) {
    fail("chat_escalated", { latency_ms: latencyMs, actions: tags });
  }
  console.log(
    JSON.stringify({
      event: "chat_ok",
      status: 200,
      latency_ms: latencyMs,
      messages: messageCount,
      actions: tags,
    }),
  );
};

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "smoke_failed";
  console.error(JSON.stringify({ event: "smoke_failed", name }));
  process.exit(1);
});
