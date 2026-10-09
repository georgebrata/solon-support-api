import { createHash, timingSafeEqual } from "node:crypto";

export const formatAuthorization = (token: string): string => {
  return ["Bearer", token].join(" ");
};

export const tokenFromAuthorization = (header: string | null): string | null => {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const scheme = parts[0];
  const token = parts[1];
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
};

export const secretsMatch = (actual: string, expected: string): boolean => {
  const actualHash = createHash("sha256").update(actual, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualHash, expectedHash);
};

export const isAuthorized = (header: string | null, secret: string): boolean => {
  const presented = tokenFromAuthorization(header) ?? "";
  return secretsMatch(presented, secret);
};
