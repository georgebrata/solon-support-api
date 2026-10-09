import { Redis } from "@upstash/redis";

export type KvSetOptions = {
  ex?: number;
};

/**
 * String store used by the sync bridge.
 * Production uses Upstash Redis (Vercel Marketplace KV) via KV_REST_API_URL
 * and KV_REST_API_TOKEN. Tests inject their own KvStore. Do not add an
 * in-memory Map on this production path.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: KvSetOptions): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Atomically append to a list, keep only the last maxLen items and refresh
   * the TTL (single MULTI/EXEC transaction on Upstash).
   */
  appendList(key: string, value: string, options: { maxLen: number; ex: number }): Promise<void>;
  /** Return the last `count` items of a list (oldest first). */
  readListTail(key: string, count: number): Promise<string[]>;
}

export const kvValueToString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export const isKvConfigured = (): boolean => {
  return Boolean(clean(process.env.KV_REST_API_URL) && clean(process.env.KV_REST_API_TOKEN));
};

let cached: KvStore | null = null;
let kvOverride: KvStore | null = null;

const assertTestHook = (): void => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("test_hook_forbidden");
  }
};

export const setKvForTests = (store: KvStore | null): void => {
  assertTestHook();
  kvOverride = store;
};

const createUpstashStore = (): KvStore => {
  const url = clean(process.env.KV_REST_API_URL);
  const token = clean(process.env.KV_REST_API_TOKEN);
  if (!url || !token) {
    throw new Error("kv_not_configured");
  }
  const redis = new Redis({ url, token });
  return {
    async get(key) {
      const value: unknown = await redis.get(key);
      return kvValueToString(value);
    },
    async set(key, value, options) {
      if (options?.ex !== undefined) {
        await redis.set(key, value, { ex: options.ex });
        return;
      }
      await redis.set(key, value);
    },
    async incr(key) {
      return redis.incr(key);
    },
    async expire(key, seconds) {
      await redis.expire(key, seconds);
    },
    async del(key) {
      await redis.del(key);
    },
    async appendList(key, value, options) {
      const tx = redis.multi();
      tx.rpush(key, value);
      tx.ltrim(key, -options.maxLen, -1);
      tx.expire(key, options.ex);
      await tx.exec();
    },
    async readListTail(key, count) {
      const values: unknown[] = await redis.lrange(key, -count, -1);
      return values
        .map((value) => kvValueToString(value))
        .filter((value): value is string => value !== null);
    },
  };
};

export const getKv = (): KvStore | null => {
  if (process.env.NODE_ENV !== "production" && kvOverride) {
    return kvOverride;
  }
  if (!isKvConfigured()) return null;
  if (!cached) {
    cached = createUpstashStore();
  }
  return cached;
};
