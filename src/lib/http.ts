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
