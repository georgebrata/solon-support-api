import packageJson from "../../package.json";
import { healthResponseSchema, type HealthResponse } from "./contract";
import { readConfig } from "./config";
import { json } from "./http";

const readCommit = (): string => {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha;
  return "unknown";
};

export const buildHealthBody = (): HealthResponse => {
  const config = readConfig();
  const body: HealthResponse = {
    ok: true,
    service: "solon-support-api",
    version: packageJson.version,
    commit: readCommit(),
    time: new Date().toISOString(),
    kv: config.kvConfigured ? "configured" : "not_configured",
    webhook: config.webhookConfigured ? "configured" : "not_configured",
  };
  return healthResponseSchema.parse(body);
};

export const handleHealth = (): Response => {
  return json(buildHealthBody(), 200);
};
