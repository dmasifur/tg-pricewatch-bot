import { assertSafeUrl, UnsafeUrlError } from "../lib/fetcher";
import { escapeHtml, type Telegram } from "../lib/telegram";
import type { Env, InlineButton, TgMessage } from "../types";

const START_TEXT =
	"I watch product pages and message you when the price drops.\n\n" +
	"Send me a product link, or tap below to see it work.";

const startKeyboard: InlineButton[][] = [
	[{ text: "▶️  See it work", callback_data: "demo:start" }],
	[{ text: "📋  My watches", callback_data: "list:1" }],
];

export async function handleMessage(
	msg: TgMessage,
	env: Env,
	tg: Telegram,
): Promise<void> {
	const chatId = msg.chat?.id;

	const text = msg.text?.trim() ?? "";
	if (!text) return;

	await ensureUser(chatId, env);

	if (text.startsWith("/")) {
		const command = text.split(/[\s@]/)[0]?.toLowerCase();
		switch (command) {
			case "/start":
				await tg.sendMessage(chatId, START_TEXT, startKeyboard);
				return;
			case "/demo":
				await tg.sendMessage(chatId, "Setting up a demo watch…"); // Phase 3
				return;
			case "/list":
				await tg.sendMessage(chatId, "You have no active watches yet."); // Phase 1
				return;
			case "/about":
				await tg.sendMessage(
					chatId,
					"Built by <b>asifur.dev</b> - automation, scraping and internal tooling.",
					[
						[
							{ text: "Portfolio", url: env.PORTFOLIO_URL },
							{ text: "Hire me", url: env.GIG_URL },
						],
					],
				);
				return;
			case "/hire":
				await tg.sendMessage(chatId, "What would you want automated?"); // Phase 3
				return;
			case "/forget":
				await forgetUser(chatId, env);
				await tg.sendMessage(
					chatId,
					"Deleted everything I had for you. Send /start to begin again.",
				);
				return;
			case "/help":
				await tg.sendMessage(
					chatId,
					"Send a product link to watch it.\n\n" +
						"/list - your watches\n/demo - see it work\n/about - who built this\n/forget - delete my data",
				);
				return;
			default:
				await tg.sendMessage(chatId, "I don't know that command. Try /help.");
				return;
		}
	}

	const candidate = text.match(/https?:\/\/\S+/i)?.[0];
	if (!candidate) {
		await tg.sendMessage(
			chatId,
			"Send me a product link and I'll start watching it.",
		);
		return;
	}

	try {
		const url = assertSafeUrl(candidate);

		await tg.sendMessage(
			chatId,
			`Checking <b>${escapeHtml(url.hostname)}</b>…`,
		);
	} catch (err) {
		const message =
			err instanceof UnsafeUrlError
				? err.message
				: "I couldn't read that link.";
		await tg.sendMessage(chatId, message);
	}
}

async function ensureUser(chatId: number, env: Env): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO users (chat_id, first_seen) VALUES (?, ?) ON CONFLICT(chat_id) DO NOTHING",
	)
		.bind(chatId, new Date().toISOString())
		.run();
}

async function forgetUser(chatId: number, env: Env): Promise<void> {
	await env.DB.batch([
		env.DB.prepare(
			"DELETE FROM price_points WHERE watch_id IN (SELECT id FROM watches WHERE chat_id = ?)",
		).bind(chatId),
		env.DB.prepare(
			"DELETE FROM alerts WHERE watch_id IN (SELECT id FROM watches WHERE chat_id = ?)",
		).bind(chatId),
		env.DB.prepare("DELETE FROM watches WHERE chat_id = ?").bind(chatId),
		env.DB.prepare("DELETE FROM leads WHERE chat_id = ?").bind(chatId),
		env.DB.prepare("DELETE FROM rate_limits WHERE chat_id = ?").bind(chatId),
		env.DB.prepare("DELETE FROM users WHERE chat_id = ?").bind(chatId),
	]);
}
