import { startDemo } from "../lib/demo";
import { GUIDE_TEXT } from "../lib/guide";
import { formatPrice, parsePrice } from "../lib/price";
import type { Telegram } from "../lib/telegram";
import type { Env, TgMessage, TgUser } from "../types";
import { sendList } from "./callbacks";
import { continueHire, type HireStep, startHire } from "./hire";
import { sendStats } from "./stats";
import { startWatch } from "./watch";

// Single source of truth for /help, setMyCommands, and the typo suggester.
export interface BotCommand {
  command: string;
  description: string;
  hidden?: boolean;
}

export const COMMANDS: BotCommand[] = [
  { command: "start", description: "What this bot does" },
  { command: "list", description: "Your watches" },
  { command: "guide", description: "How to add a product link" },
  { command: "demo", description: "See it work with a sample product" },
  { command: "about", description: "Who built this" },
  { command: "hire", description: "Get in touch about a project" },
  { command: "forget", description: "Delete everything I have on you" },
  { command: "cancel", description: "Cancel the current action" },
  { command: "help", description: "List every command" },
  { command: "stats", description: "Bot usage stats", hidden: true },
];

export function commandMenu(): Array<{ command: string; description: string }> {
  return COMMANDS.filter((c) => !c.hidden).map(({ command, description }) => ({
    command,
    description,
  }));
}

function helpText(): string {
  const lines = COMMANDS.filter((c) => !c.hidden).map((c) => `/${c.command} — ${c.description}`);
  return `Send a product link any time to watch it — no command needed.\n\n${lines.join("\n")}`;
}

const START_TEXT =
  "I watch product pages and message you the moment the price drops.\n\n" +
  "Just send me a product link — Amazon, Daraz, Bikroy, and most Shopify or WooCommerce stores all work. " +
  "No commands needed, I'll take it from there.";

export async function handleMessage(msg: TgMessage, env: Env, tg: Telegram): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (!text) return;

  const user = await ensureUser(chatId, env);

  if (user.pending_action !== null && !text.startsWith("/")) {
    const [kind, arg] = user.pending_action.split(":");
    if (kind === "hire" && (arg === "use_case" || arg === "contact")) {
      await continueHire(chatId, arg as HireStep, text, msg.from, env, tg);
      return;
    }
    if (kind === "target" && arg !== undefined) {
      await resolvePendingAction(chatId, user.pending_action, text, env, tg);
      return;
    }
  }

  if (text.startsWith("/")) {
    await env.DB.prepare("UPDATE users SET pending_action = NULL WHERE chat_id = ?")
      .bind(chatId)
      .run();
    const command = text?.split(/[\s@]/)[0]?.toLowerCase().slice(1);
    switch (command) {
      case "start":
        await tg.sendMessage(chatId, START_TEXT, [
          [{ text: "▶️  See it work", callback_data: "demo:start" }],
          [{ text: "📋  My watches", callback_data: "list:1" }],
          [{ text: "❓  How do I add a link?", callback_data: "guide:open" }],
        ]);
        return;
      case "list":
        await sendList(chatId, env, tg);
        return;
      case "guide":
        await tg.sendMessage(chatId, GUIDE_TEXT, [
          [{ text: "▶️  See it work", callback_data: "demo:start" }],
          [{ text: "📋  My watches", callback_data: "list:1" }],
        ]);
        return;
      case "demo":
        await startDemo(chatId, env, tg);
        return;
      case "about":
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
      case "hire":
        await startHire(chatId, env, tg);
        return;
      case "forget":
        await forgetUser(chatId, env);
        await tg.sendMessage(
          chatId,
          "Deleted everything I had for you. Send /start to begin again.",
        );
        return;
      case "help":
        await tg.sendMessage(chatId, helpText());
        return;
      case "stats":
        await sendStats(chatId, env, tg);
        return;
      case "cancel":
        await tg.sendMessage(chatId, "Cancelled.");
        return;
      default: {
        const suggestion = closestCommand(command ?? "");
        await tg.sendMessage(
          chatId,
          suggestion
            ? `I don't know /${command}. Did you mean /${suggestion}? Or try /help for the full list.`
            : "I don't know that command. Try /help for the full list — or just send me a product link.",
        );
        return;
      }
    }
  }

  const candidate = text.match(/https?:\/\/\S+/i)?.[0];
  if (!candidate) {
    await tg.sendMessage(
      chatId,
      "Send me a product link and I'll start watching it — or try /guide if you're not sure how.",
    );
    return;
  }
  await startWatch(chatId, candidate, env, tg);
}

/** Small edit-distance lookup so a typo'd command gets a real suggestion. */
export function closestCommand(typed: string): string | null {
  if (!typed) return null;
  let best: { command: string; distance: number } | null = null;
  for (const { command, hidden } of COMMANDS) {
    if (hidden) continue;
    const distance = editDistance(typed, command);
    if (!best || distance < best.distance) best = { command, distance };
  }
  return best && best.distance <= 2 ? best.command : null;
}

function editDistance(a: string, b: string): number {
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const diagonal = prev[j - 1] ?? 0;
      const above = prev[j] ?? 0;
      const left = cur[j - 1] ?? 0;
      cur.push(a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(above, left, diagonal));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
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
