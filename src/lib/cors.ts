import { readConfig } from "./config";

export type CorsDecision = {
  allowed: boolean;
  headers: Record<string, string>;
};

export const resolveCors = (origin: string | null): CorsDecision => {
  if (!origin) {
    return { allowed: true, headers: {} };
  }
  const allowed = readConfig().allowedOrigins.includes(origin);
  if (!allowed) {
    return { allowed: false, headers: {} };
  }
  return {
    allowed: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "origin",
    },
  };
};
