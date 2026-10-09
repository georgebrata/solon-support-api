# AGENT.md

Maintenance contract for bots that change this repository. Read this file before opening a pull request.

This repository is the sync bridge only. It is public. Do not add secrets, webhook URLs, tokens, real email addresses, client data, or the support persona prompt. Persona copy and the widget live elsewhere. CRM writes stay on the support bot.

No agent merges pull requests here. Dev Bot, Support Bot, Quality Bot, and the owner may open or review PRs. A human merges.

## Architecture

```
Website widget
  POST /api/chat { message, session_id, channel, email?, name? }
    1. validate (zod) and CORS (ALLOWED_ORIGINS)
    2. rate-limit per session and per IP in KV
    3. write a pending job to KV
    4. POST wake { job_id, session_id, message } with the bearer key
    5. poll KV until done or the 55s budget ends
Support bot
  optional GET /api/internal/job?job_id=
  POST /api/internal/reply { job_id, session_id, reply, email_captured? }
Widget receives { messages, quick_replies, actions }
```

The browser must never call the bot webhook. The wake call returns when the run has started, not when the answer is ready. This service polls KV for the reply.

KV is Upstash Redis from the Vercel Marketplace, read with `@upstash/redis` using `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The interface is `src/lib/kv.ts`. Tests pass an in-memory fake from `tests/`. Do not put a `Map` (or any other process-local store) on the production path. Do not add Supabase or Cloudflare.

Wake body is minimal on purpose: `job_id`, `session_id`, and `message` only. Treat that body as untrusted visitor input. Email, name, and earlier turns are on `GET /api/internal/job` after the internal auth check. Do not log message text, email, name, or secrets.

Jobs and session history expire after 24 hours. A later phase can tighten that TTL. The cap on history is 40 entries.

## Public response

Keep this shape. The website widget parses `messages[]`, `quick_replies[]`, and `actions[]`.

- `messages[]`: `{ type: "text", text, buttons? }`. Buttons are `{ type: "url", caption, url }` and the URL must be `http` or `https`. The widget only renders `type === "text"`.
- `quick_replies[]`: `{ caption }`. The widget ignores entries without `caption`. The internal reply also accepts a string and this bridge normalizes it to `{ caption }` before storage and before the HTTP response.
- `actions[]`: `{ tag_name }`. `needs_human` is the handoff signal the widget already understands. Unknown tags are allowed by the schema if they match `^[a-z0-9_]+$`; do not remove `needs_human`.

Limits: 10 messages, 11 quick replies, 5 buttons per message. Text fields are trimmed and length-capped.

Timeouts and wake failures return HTTP 200 with a short operational fallback plus `needs_human`. The widget treats non-2xx as a generic error and would hide that fallback. Those strings are bridge errors, not the persona.

`/api/chat` statuses: 200, 400 `bad_request`, 403 `origin_not_allowed`, 429 `rate_limited`, 503 `not_configured`, 500 `internal_error`.

`/api/health` is always 200 when the process is up: `{ ok, service, version, commit, time, kv, webhook }`. `kv` and `webhook` are `configured` or `not_configured`. Never echo env values. Health must stay green when env is missing.

## Internal API

Support Bot calls these after it is woken. The secret is `INTERNAL_API_SECRET` from the bot secret store, not from this repository.

`POST /api/internal/reply`

Header: `Authorization` using the Bearer scheme and the internal secret.

```json
{
  "job_id": "<uuid from the wake body>",
  "session_id": "<uuid from the wake body>",
  "reply": {
    "messages": [{ "type": "text", "text": "<answer>" }],
    "quick_replies": [{ "caption": "<short label>" }],
    "actions": []
  },
  "email_captured": false
}
```

`email_captured` is an optional boolean. Do not send the visitor email again in that field. If the widget posted an email, it is already on the job.

`GET /api/internal/job?job_id=<uuid>` uses the same authorization and returns `{ job, history }`.

Statuses: 200, 400 `bad_request`, 401 `unauthorized`, 404 `not_found`, 409 `session_mismatch`, 503 `not_configured`, 500 `internal_error`. A second reply for a finished job returns 200 `already_done` and does not overwrite the first reply.

Auth compares SHA-256 digests with `timingSafeEqual`. Missing and wrong tokens both return 401 when the secret is configured. If the secret or KV is missing, the route returns 503 instead of comparing.

## How Dev Bot opens a PR

1. Branch from `main`.
2. Read this file and `README.md`.
3. Change the bridge only. Do not add persona prompts, secrets, marketing-site UI, or a new datastore.
4. Update `tests/contract.test.ts` and `tests/chat-flow.test.ts` in the same PR if behavior changes.
5. Open a pull request. CI runs `npm ci`, typecheck, lint, test, and build. It does not need secrets.
6. Stop. Do not merge.

## Invariants

- Never put webhook/internal secrets in client JS
- Never change public response shape without updating widget parser + tests
- Never add Supabase/Cloudflare dependencies without George OK
- maxDuration and KV poll interval must keep p95 < 45s
- Never send chat message text or email to GA4
- Public copy always presents **Maria** (human CS); never “asistentul SOLON” / bot

This package does not send analytics. The p95 target depends on the bot; the bridge budget is 55 seconds (`CHAT_WAIT_BUDGET_MS`) with a 400ms poll (`CHAT_POLL_INTERVAL_MS`) and `maxDuration` 60. Region is a single `fra1`, which Hobby allows. Do not add paid-only settings such as multi-region or function failover.

## Security

- Secrets live in the Vercel project environment and the bot secret store.
- CORS reflects only an origin listed in `ALLOWED_ORIGINS`. Requests with no `Origin` (server-side smoke tests) are not browser calls and are allowed through CORS.
- Rate limit before creating a job.
- Wake redirects are errors, so the bearer key is not forwarded to another host.
- Webhook URL must be `https` or `/api/chat` stays `not_configured`.
- A voluntary email may sit on the KV job until the 24 hour TTL so the bot can read it. This service does not create the CRM card.
