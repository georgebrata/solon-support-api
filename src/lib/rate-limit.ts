import type { KvStore } from "./kv";

export const clientAddress = (request: Request): string => {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  if (!/^[A-Za-z0-9:.\-]{1,64}$/.test(candidate)) return "unknown";
  return candidate;
};

export const consumeRateLimit = async (
  kv: KvStore,
  bucket: string,
  limit: number,
  now = Date.now(),
): Promise<boolean> => {
  const window = Math.floor(now / 60_000);
  const key = `rl:${bucket}:${window}`;
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, 120);
  }
  return count <= limit;
};

export const allowChat = async (
  kv: KvStore,
  input: { sessionId: string; ip: string; limit: number },
): Promise<boolean> => {
  const sessionOk = await consumeRateLimit(kv, `session:${input.sessionId}`, input.limit);
  const ipOk = await consumeRateLimit(kv, `ip:${input.ip}`, input.limit);
  return sessionOk && ipOk;
};
