const args = process.argv.slice(2);
const chat = args.includes("--chat");
const positional = args.find((arg) => !arg.startsWith("--"));
const base = (positional ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

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

const main = async (): Promise<void> => {
  const healthResponse = await fetch(`${base}/api/health`);
  const healthBody: unknown = await healthResponse.json();
  if (!healthResponse.ok || !isHealth(healthBody)) {
    console.error(JSON.stringify({ event: "health_failed", status: healthResponse.status }));
    process.exit(1);
  }
  console.log(JSON.stringify(healthBody));
  if (!chat) return;

  const chatResponse = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "smoke",
      session_id: crypto.randomUUID(),
      channel: "website",
    }),
    signal: AbortSignal.timeout(70_000),
  });
  const chatBody: unknown = await chatResponse.json();
  console.log(JSON.stringify({ status: chatResponse.status, body: chatBody }));
  if (chatResponse.status !== 200 && chatResponse.status !== 503) {
    process.exit(1);
  }
};

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "smoke_failed";
  console.error(JSON.stringify({ event: "smoke_failed", name }));
  process.exit(1);
});
