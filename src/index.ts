import { handleCallback } from "./handlers/callbacks";
import { handleMessage } from "./handlers/commands";
import { advanceDemos } from "./lib/demo";
import { report } from "./lib/health";
import { alertAdmin } from "./lib/ops";
import { runSweep } from "./lib/sweep";
import { Telegram } from "./lib/telegram";
import type { Env, TgUpdate } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const health = await report(env);
      return Response.json(
        {
          ok: health.ok,
          reasons: health.reasons,
          active_watches: health.stats.activeWatches,
          last_sweep_ago_s:
            health.stats.lastSweepAgoMs === null
              ? null
              : Math.round(health.stats.lastSweepAgoMs / 1000),
          ts: Date.now(),
        },
        { status: health.ok ? 200 : 503 },
      );
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      let update: TgUpdate;
      try {
        update = await request.json();
      } catch {
        return new Response("ok");
      }
      ctx.waitUntil(dispatch(update, env));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tg = new Telegram(env.BOT_TOKEN);
    const job =
      event.cron === "* * * * *"
        ? advanceDemos(env, tg).then((n) => {
            if (n > 0) console.log(`demo: advanced ${n}`);
          })
        : runSweep(env, tg).then((stats) => {
            console.log(`sweep checked=${stats.checked} warned=${stats.warned}`);
          });

    ctx.waitUntil(
      job.catch(async (error: unknown) => {
        console.error(`cron ${event.cron} failed`, error);
        await alertAdmin(
          env,
          `cron:${event.cron}`,
          `Cron ${event.cron} failed: ${String(error).slice(0, 200)}`,
        );
      }),
    );
  },
};

async function dispatch(update: TgUpdate, env: Env): Promise<void> {
  const tg = new Telegram(env.BOT_TOKEN);
  try {
    if (update.message) {
      await handleMessage(update.message, env, tg);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query, env, tg);
    }
  } catch (err) {
    console.error("dispatch failed", err);
  }
}
