const ENV_KEYS = [
  "GROK_SUPPORT_WEBHOOK_URL",
  "GROK_SUPPORT_WEBHOOK_KEY",
  "INTERNAL_API_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "ALLOWED_ORIGINS",
  "RATE_LIMIT_PER_MIN",
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
] as const;

export const applyTestEnv = (): void => {
  process.env.GROK_SUPPORT_WEBHOOK_URL = "https://example.com/webhook/support-chat";
  process.env.GROK_SUPPORT_WEBHOOK_KEY = "test-webhook-key";
  process.env.INTERNAL_API_SECRET = "test-internal-secret";
  process.env.KV_REST_API_URL = "https://example.com";
  process.env.KV_REST_API_TOKEN = "test-kv-token";
  process.env.ALLOWED_ORIGINS = "https://example.com";
  process.env.RATE_LIMIT_PER_MIN = "20";
};

export const clearTestEnv = (): void => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
};
