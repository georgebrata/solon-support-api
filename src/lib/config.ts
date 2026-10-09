export type AppConfig = {
  webhookUrl: string | null;
  webhookKey: string | null;
  internalSecret: string | null;
  kvUrl: string | null;
  kvToken: string | null;
  allowedOrigins: string[];
  rateLimitPerMin: number;
  kvConfigured: boolean;
  webhookConfigured: boolean;
  webhookUsable: boolean;
  internalConfigured: boolean;
  chatConfigured: boolean;
};

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const isOriginEntry = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    if (url.protocol === "https:") return true;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local;
  } catch {
    return false;
  }
};

const readOrigins = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter(isOriginEntry);
};

const readRateLimit = (raw: string | undefined): number => {
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return 20;
  return parsed;
};

export const readConfig = (): AppConfig => {
  const webhookUrl = clean(process.env.GROK_SUPPORT_WEBHOOK_URL);
  const webhookKey = clean(process.env.GROK_SUPPORT_WEBHOOK_KEY);
  const internalSecret = clean(process.env.INTERNAL_API_SECRET);
  const kvUrl = clean(process.env.KV_REST_API_URL);
  const kvToken = clean(process.env.KV_REST_API_TOKEN);
  const kvConfigured = Boolean(kvUrl && kvToken);
  const webhookConfigured = Boolean(webhookUrl && webhookKey);
  const webhookUsable = Boolean(webhookUrl && webhookKey && isHttpsUrl(webhookUrl));
  const internalConfigured = Boolean(internalSecret);

  return {
    webhookUrl,
    webhookKey,
    internalSecret,
    kvUrl,
    kvToken,
    allowedOrigins: readOrigins(process.env.ALLOWED_ORIGINS),
    rateLimitPerMin: readRateLimit(process.env.RATE_LIMIT_PER_MIN),
    kvConfigured,
    webhookConfigured,
    webhookUsable,
    internalConfigured,
    chatConfigured: webhookUsable && kvConfigured && internalConfigured,
  };
};
