export const json = (
  body: unknown,
  status: number,
  extra?: Record<string, string>,
): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
};

/** Hard cap for JSON request bodies on every route (not just Content-Length). */
export const MAX_BODY_BYTES = 32_000;

export class BodyTooLargeError extends Error {
  constructor() {
    super("body_too_large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads a JSON body while enforcing MAX_BODY_BYTES on the actual bytes, so a
 * missing or lying Content-Length header cannot bypass the cap.
 */
export const readJsonBody = async (request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> => {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBytes) throw new BodyTooLargeError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new BodyTooLargeError();
  return JSON.parse(raw) as unknown;
};
