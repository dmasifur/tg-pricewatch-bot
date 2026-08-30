# tg-pricewatch-bot

A Telegram bot that watches product pages and messages you when the price drops. Runs on Cloudflare Workers with a D1 database; scrapes via `HTMLRewriter` (JSON-LD → Open Graph/meta → microdata → user-picked selector, in that order).

## Stack

- Cloudflare Workers (`src/index.ts` is the entry point: `fetch` handles the Telegram webhook and `/health`; `scheduled` runs the price-check sweep and the demo-flow cron)
- D1 (SQLite) for storage — schema in `schema.sql` + `migrations/`
- Bun as package manager and test runner
- Biome for lint/format

## Setup

```bash
bun install
```

### 1. Create the D1 database

```bash
bunx wrangler d1 create pricewatch
```

Copy the resulting `database_id` into `wrangler.toml`'s `[[d1_databases]]` block if it differs from the one already committed.

### 2. Apply the schema

```bash
bun run db:migrate:local   # for local dev (wrangler dev)
bun run db:migrate:remote  # for the deployed database
```

This runs `schema.sql` followed by every file in `migrations/`, in order. See `scripts/migrate.sh`.

### 3. Set secrets

These are read from `Env` (see `src/types.ts`) but are **not** in `wrangler.toml`'s `[vars]` — set them as Worker secrets, never commit them:

```bash
bunx wrangler secret put BOT_TOKEN        # from @BotFather
bunx wrangler secret put WEBHOOK_SECRET   # any random string; you choose it
bunx wrangler secret put ADMIN_CHAT_ID    # your Telegram chat_id, for cron-failure alerts
```

Non-secret config (rate limits, TTLs, portfolio/gig links) lives in `wrangler.toml`'s `[vars]`.

### 4. Register the Telegram webhook

Once deployed (see below), point Telegram at it:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://<your-worker-subdomain>.workers.dev/webhook","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
```

Use the real `BOT_TOKEN` and `WEBHOOK_SECRET` values from step 3 — never paste them into a committed file.

## Development

```bash
bun run dev              # wrangler dev, local D1 + local cron triggers
bun run test             # bun test
bun run lint             # biome check .
bun run lint:fix         # biome check --write .
bun run typecheck        # tsc --noEmit
```

## Deploy

```bash
bun run deploy
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, and tests on every push/PR, and deploys `main` on green via `wrangler deploy` using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets.

## Health check

`GET /health` reports sweep freshness and today's failure rate — see `src/lib/health.ts` for the thresholds.
