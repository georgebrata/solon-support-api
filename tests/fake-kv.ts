import type { KvStore } from "../src/lib/kv";

type Entry = {
  value: string;
  expiresAt: number | null;
};

type ListEntry = {
  items: string[];
  expiresAt: number | null;
};

export const createFakeKv = (): KvStore => {
  const entries = new Map<string, Entry>();
  const lists = new Map<string, ListEntry>();

  const readList = (key: string): ListEntry | null => {
    const entry = lists.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      lists.delete(key);
      return null;
    }
    return entry;
  };

  const read = (key: string): Entry | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  };

  return {
    async get(key) {
      return read(key)?.value ?? null;
    },
    async set(key, value, options) {
      const expiresAt = options?.ex ? Date.now() + options.ex * 1000 : null;
      entries.set(key, { value, expiresAt });
    },
    async incr(key) {
      const current = read(key);
      const next = (current ? Number(current.value) : 0) + 1;
      entries.set(key, {
        value: String(next),
        expiresAt: current?.expiresAt ?? null,
      });
      return next;
    },
    async expire(key, seconds) {
      const current = read(key);
      if (!current) return;
      entries.set(key, {
        value: current.value,
        expiresAt: Date.now() + seconds * 1000,
      });
    },
    async del(key) {
      entries.delete(key);
      lists.delete(key);
    },
    async appendList(key, value, options) {
      const current = readList(key)?.items ?? [];
      const items = [...current, value].slice(-options.maxLen);
      lists.set(key, { items, expiresAt: Date.now() + options.ex * 1000 });
    },
    async readListTail(key, count) {
      return (readList(key)?.items ?? []).slice(-count);
    },
  };
};
