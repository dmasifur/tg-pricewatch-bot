import { startDemo } from "../lib/demo";
import { clampInterval, isoIn } from "../lib/limits";
import { formatPrice } from "../lib/price";
import { escapeHtml, type Telegram } from "../lib/telegram";
import type { Env, InlineButton, TgCallbackQuery } from "../types";
import { confirmationKeyboard, confirmCandidate } from "./watch";

export async function handleCallback(cq: TgCallbackQuery, env: Env, tg: Telegram): Promise<void> {
  const chatId = cq.message?.chat.id;
  const data = cq.data ?? "";
  if (chatId === undefined) return;

  if (data === "demo:start") {
    await tg.answerCallbackQuery(cq.id);
    await startDemo(chatId, env, tg);
    return;
  }

  if (data.startsWith("list:")) {
    await tg.answerCallbackQuery(cq.id);
    await sendList(chatId, env, tg);
    return;
  }

  const match = data.match(/^w:(\d+):(\w+)(?::(\w+))?$/);
  if (!match) {
    await tg.answerCallbackQuery(cq.id);
    return;
  }
  const [, idRaw, action, arg] = match;
  const watchId = Number(idRaw);

  const owned = await env.DB.prepare(
    "SELECT id, title, host FROM watches WHERE id = ? AND chat_id = ?",
  )
    .bind(watchId, chatId)
    .first<{ id: number; title: string | null; host: string }>();
  if (!owned) {
    await tg.answerCallbackQuery(cq.id, "That watch is gone.");
    return;
  }

  switch (action) {
    case "c": {
      const outcome = await confirmCandidate(watchId, Number(arg), env);
      await tg.answerCallbackQuery(cq.id, outcome.ok ? "Got it" : "Couldn't read that one");
      if (outcome.ok && cq.message) {
        const label = outcome.label ?? "unknown";
        await tg.editMessageText(
          chatId,
          cq.message.message_id,
          `<b>${escapeHtml(owned.title ?? owned.host)}</b>\nCurrent price: <b>${escapeHtml(label)}</b>\n\nWatching from now on.`,
          confirmationKeyboard(watchId, env),
        );
      }
      return;
    }
    case "x":
      await env.DB.prepare("DELETE FROM watches WHERE id = ?").bind(watchId).run();
      await tg.answerCallbackQuery(cq.id, "Dropped");
      if (cq.message) {
        await tg.editMessageText(
          chatId,
          cq.message.message_id,
          "No problem — send me another link when you're ready.",
        );
      }
      return;
    case "m":
      if (arg === "tgt") {
        await env.DB.prepare("UPDATE users SET pending_action = ? WHERE chat_id = ?")
          .bind(`target:${watchId}`, chatId)
          .run();
        await tg.answerCallbackQuery(cq.id);
        await tg.sendMessage(chatId, "What price should I alert you at? Send just the number.");
      } else {
        await env.DB.prepare(
          "UPDATE watches SET notify_mode = 'any_drop', target_price = NULL WHERE id = ?",
        )
          .bind(watchId)
          .run();
        await tg.answerCallbackQuery(cq.id, "I'll alert on any drop");
      }
      return;
    case "i": {
      const minutes = clampInterval(Number(arg), env);
      await env.DB.prepare(
        "UPDATE watches SET interval_minutes = ?, next_check_at = ? WHERE id = ?",
      )
        .bind(minutes, isoIn(minutes), watchId)
        .run();
      await tg.answerCallbackQuery(
        cq.id,
        `Checking every ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}`,
      );
      return;
    }
    case "del":
      await env.DB.prepare("DELETE FROM watches WHERE id = ?").bind(watchId).run();
      await tg.answerCallbackQuery(cq.id, "Removed");
      if (cq.message) {
        await tg.editMessageText(chatId, cq.message.message_id, "Watch removed.");
      }
      return;
    case "ext": {
      const days = Number(env.WATCH_TTL_DAYS);
      await env.DB.prepare(
        `UPDATE watches SET expires_at = ?, extended_count = extended_count + 1, status = 'active'
           WHERE id = ? AND chat_id = ?`,
      )
        .bind(new Date(Date.now() + days * 86_400_000).toISOString(), watchId, chatId)
        .run();
      await tg.answerCallbackQuery(cq.id, `Extended ${days} more days`);
      return;
    }

    case "pause": {
      const row = await env.DB.prepare(
        `UPDATE watches SET status = CASE WHEN status = 'paused' THEN 'active' ELSE 'paused' END,
             paused_reason = CASE WHEN status = 'paused' THEN NULL ELSE 'user' END,
             next_check_at = ?
           WHERE id = ? AND chat_id = ? RETURNING status`,
      )
        .bind(new Date().toISOString(), watchId, chatId)
        .first<{ status: string }>();
      await tg.answerCallbackQuery(cq.id, row?.status === "paused" ? "Paused" : "Resumed");
      return;
    }

    default:
      await tg.answerCallbackQuery(cq.id);
  }
}

export async function sendList(chatId: number, env: Env, tg: Telegram): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, title, host, last_price, currency, target_price, interval_minutes, expires_at
     FROM watches WHERE chat_id = ? AND status IN ('active','failing') ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(chatId)
    .all<{
      id: number;
      title: string | null;
      host: string;
      last_price: number | null;
      currency: string | null;
      target_price: number | null;
      interval_minutes: number;
      expires_at: string;
    }>();

  const list = rows.results ?? [];
  if (!list.length) {
    await tg.sendMessage(chatId, "No active watches. Send me a product link to start one.");
    return;
  }

  const lines = list.map((w) => {
    const price = w.last_price !== null ? formatPrice(w.last_price, w.currency) : "—";
    const target = w.target_price ? ` · target ${formatPrice(w.target_price, w.currency)}` : "";
    const days = Math.max(0, Math.ceil((Date.parse(w.expires_at) - Date.now()) / 86_400_000));
    return `• <b>${escapeHtml(w.title ?? w.host)}</b>\n  ${escapeHtml(price)}${escapeHtml(target)} · expires in ${days}d`;
  });

  const keyboard: InlineButton[][] = list.map((w) => [
    {
      text: `🗑 ${(w.title ?? w.host).slice(0, 28)}`,
      callback_data: `w:${w.id}:del`,
    },
  ]);

  await tg.sendMessage(chatId, lines.join("\n\n"), keyboard);
}
