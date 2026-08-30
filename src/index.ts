import { handleMessage } from "./handlers/commands";
import { Telegram } from "./lib/telegram";
import type { Env, TgUpdate } from "./types";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			const row = await env.DB.prepare(
				"SELECT COUNT(*) AS n FROM watches WHERE status = 'active'",
			).first<{ n: number }>();
			return Response.json({
				ok: true,
				active_watches: row?.n ?? 0,
				ts: Date.now(),
			});
		}

		if (url.pathname === "/webhook" && request.method === "POST") {
			if (
				request.headers.get("x-telegram-bot-api-secret-token") !==
				env.WEBHOOK_SECRET
			) {
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

	async scheduled(
		_event: ScheduledController,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		const due = await env.DB.prepare(
			"SELECT id, url FROM watches WHERE status = 'active' AND next_check_at <= ? ORDER BY next_check_at LIMIT 20",
		)
			.bind(new Date().toISOString())
			.all();
		console.log(`sweep: ${due.results?.length ?? 0} watches due`);
	},
};

async function dispatch(update: TgUpdate, env: Env): Promise<void> {
	const tg = new Telegram(env.BOT_TOKEN);
	try {
		if (update.message) {
			await handleMessage(update.message, env, tg);
		} else if (update.callback_query) {
			await tg.answerCallbackQuery(update.callback_query.id);
		}
	} catch (err) {
		console.error("dispatch failed", err);
	}
}
