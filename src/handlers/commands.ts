import type { Telegram } from "../lib/telegram";
import type { Env, TgMessage } from "../types";
import { sendList } from "./callbacks";
import { startWatch } from "./watch";

const START_TEXT =
  "I watch product pages and message you when the price drops.\n\n" +
  "Send me a product link, or tap below to see it work.";

export async function handleMessage(msg: TgMessage, env: Env, tg: Telegram): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (!text) return;

  const user = await ensureUser(chatId, env);

  if (user.pending_action && !text.startsWith("/")) {
    await resolvePendingAction(chatId, user.pending_action, text, env, tg);
    return;
  }

  if (text.startsWith("/")) {
    await env.DB.prepare("UPDATE users SET pending_action = NULL WHERE chat_id = ?")
      .bind(chatId)
      .run();
    const command = text?.split(/[\s@]/)[0]?.toLowerCase();
    switch (command) {
      case "/start":
        await tg.sendMessage(chatId, START_TEXT, [
          [{ text: "▶️  See it work", callback_data: "demo:start" }],
          [{ text: "📋  My watches", callback_data: "list:1" }],
        ]);
        return;
      case "/list":
        await sendList(chatId, env, tg);
        return;
      case "/demo":
        await tg.sendMessage(chatId, "Setting up a demo watch…"); // Phase 3
        return;
      case "/about":
        await tg.sendMessage(
          chatId,
          "Built by <b>asifur.dev</b> — automation, scraping and internal tooling.",
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
          "Send a product link to watch it.\n\n/list — your watches\n/demo — see it work\n/about — who built this\n/forget — delete my data",
        );
        return;
      default:
        await tg.sendMessage(chatId, "I don't know that command. Try /help.");
        return;
    }
  }

  const candidate = text.match(/https?:\/\/\S+/i)?.[0];
  if (!candidate) {
    await tg.sendMessage(chatId, "Send me a product link and I'll start watching it.");
    return;
  }
  await startWatch(chatId, candidate, env, tg);
}

async function resolvePendingAction(
  chatId: number,
  action: string,
  text: string,
  env: Env,
  tg: Telegram,
): Promise<void> {
  const [kind, arg] = action.split(":");
  await env.DB.prepare("UPDATE users SET pending_action = NULL WHERE chat_id = ?")
    .bind(chatId)
    .run();

  if (kind !== "target") return;

  const { parsePrice, formatPrice } = await import("../lib/price");
  const parsed = parsePrice(text);
  if (!parsed) {
    await tg.sendMessage(
      chatId,
      "I couldn't read that as a price. Tap 🎯 Set target again to retry.",
    );
    return;
  }

  const updated = await env.DB.prepare(
    "UPDATE watches SET target_price = ?, notify_mode = 'target' WHERE id = ? AND chat_id = ? RETURNING currency",
  )
    .bind(parsed.amount, Number(arg), chatId)
    .first<{ currency: string | null }>();

  if (!updated) {
    await tg.sendMessage(chatId, "That watch is gone.");
    return;
  }
  await tg.sendMessage(
    chatId,
    `Set. I'll message you when it hits ${formatPrice(parsed.amount, updated.currency)} or lower.`,
  );
}

async function ensureUser(chatId: number, env: Env): Promise<{ pending_action: string | null }> {
  await env.DB.prepare(
    "INSERT INTO users (chat_id, first_seen) VALUES (?, ?) ON CONFLICT(chat_id) DO NOTHING",
  )
    .bind(chatId, new Date().toISOString())
    .run();

  const user = await env.DB.prepare("SELECT pending_action FROM users WHERE chat_id = ?")
    .bind(chatId)
    .first<{ pending_action: string | null }>();

  return user ?? { pending_action: null };
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
