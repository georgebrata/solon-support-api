import type { KvStore } from "./kv";

/**
 * Client address for rate limiting. Vercel sets x-vercel-forwarded-for and
 * x-real-ip itself (clients cannot override them), so they are preferred. The leftmost x-forwarded-for entry is client-controlled and must
 * never be trusted; if x-real-ip is missing we use the rightmost entry, which
 * is the one appended by the closest trusted proxy.
 */
export const clientAddress = (request: Request): string => {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  const realIp = vercelForwarded || request.headers.get("x-real-ip")?.trim();
  const forwardedParts = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const candidate = realIp || forwardedParts[forwardedParts.length - 1] || "unknown";
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
