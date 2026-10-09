# solon-support-api

Sync bridge between the website support widget and the support bot. This service validates a chat request, stores a short-lived job, wakes the bot, and waits until the bot posts a reply. It does not own the widget, the persona, or CRM writes.

This repository is public. Do not commit secrets, webhook URLs, tokens, real email addresses, client data, or persona prompt text. Put runtime values in the host environment only.

## Setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run dev
```

Health check (env can be missing):

```bash
curl -sS http://127.0.0.1:3000/api/health
```

`kv` and `webhook` are `configured` or `not_configured`. The body never includes the values.

Copy `.env.example` to `.env.local` when you need a real local run. `.env.local` is gitignored. The dev server reads it; do not commit it.

Smoke test against a running server. By default it only calls `/api/health`. The base URL comes from the first argument or `SMOKE_BASE_URL`, otherwise `http://127.0.0.1:3000`.

```bash
npm run smoke
npm run smoke -- http://127.0.0.1:3000
npm run smoke -- http://127.0.0.1:3000 --chat
```

`--chat` also POSTs `/api/chat` and may wait for the sync reply. Leave it off unless you intend to create a job.

## Env

Set these on the host. Names match `.env.example`. Values stay out of git.

| Name | Purpose |
| --- | --- |
| `GROK_SUPPORT_WEBHOOK_URL` | HTTPS URL the bridge POSTs to wake the bot. |
| `GROK_SUPPORT_WEBHOOK_KEY` | Bearer token for that wake call. |
| `INTERNAL_API_SECRET` | Bearer token the bot sends to `/api/internal/*`. |
| `KV_REST_API_URL` | Injected by the Vercel Marketplace Redis integration. |
| `KV_REST_API_TOKEN` | Injected by the same integration. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins. HTTPS, or `http://localhost` / `http://127.0.0.1` with an optional port. `*` is ignored. |
| `RATE_LIMIT_PER_MIN` | Per session and per IP, fixed one-minute window. Default 20. Invalid values fall back to 20. |

`/api/chat` returns 503 `not_configured` until the webhook URL is HTTPS and the webhook key, both KV variables, and the internal secret are set. `/api/health` stays 200 either way and only reports whether each pair is present.

## API

`POST /api/chat`

```json
{ "message": "string", "session_id": "uuid", "channel": "website", "email": "optional", "name": "optional" }
```

Success and the timeout fallback are both HTTP 200 so the widget can render them:

```json
{
  "messages": [{ "type": "text", "text": "...", "buttons": [{ "type": "url", "caption": "...", "url": "https://example.com" }] }],
  "quick_replies": [{ "caption": "..." }],
  "actions": [{ "tag_name": "needs_human" }]
}
```

The live widget reads `messages[]`, `quick_replies[]`, and `actions[]`. It renders a quick reply only when the entry has `caption`, and it treats `actions[].tag_name === "needs_human"` as a handoff. The internal reply accepts caption objects or plain strings and stores the caption form.

Other chat statuses: `400 bad_request`, `403 origin_not_allowed`, `429 rate_limited`, `503 not_configured`, `500 internal_error`.

`POST /api/internal/reply` and `GET /api/internal/job?job_id=` use `Authorization` with the Bearer scheme and `INTERNAL_API_SECRET`. Comparison is a SHA-256 timing-safe compare. See `AGENT.md` for the body.

The chat route exports `maxDuration = 60`. The wait budget is 55 seconds, including the wake call, so the handler returns before the platform limit and before the widget's 60 second abort.

## Deploy

1. Import this GitHub repository as a Vercel project.
2. Provision Redis from the Vercel Marketplace (this is the current Vercel KV product). The integration injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Set the other variables from `.env.example` in the project environment UI. Do not paste them into git, issues, or pull requests.
4. Deploy. `GET /api/health` should return `ok: true`.
5. Point the website widget at `POST /api/chat` in the website repository. This repo does not contain the widget.

`vercel.json` runs functions in a single region, `fra1`. Hobby allows one region, and Frankfurt is the one this bridge uses. Chat `maxDuration` is 60 seconds, which is inside the Hobby duration cap. Failover regions are not set (that setting is enterprise-only).

Production job state is Upstash Redis behind `src/lib/kv.ts`. There is no in-memory store on the production path. Jobs and session history expire after 24 hours.

## Rollback

1. Point the website widget back at the previous chat provider and restore that host in the site `connect-src` policy.
2. Keep the previous provider available for 14 days.
3. Leave this project deployed so `/api/health` can still be checked.
4. Do not copy environment values into the repository while rolling back.

## CI

`.github/workflows/ci.yml` runs install, typecheck, lint, test, and build on pull requests and pushes. It does not need secrets.
