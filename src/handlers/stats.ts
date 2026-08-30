import { snapshot } from "../lib/ops";
import type { Telegram } from "../lib/telegram";
import type { Env } from "../types";

export async function sendStats(chatId: number, env: Env, tg: Telegram): Promise<void> {
  if (env.STATS_PUBLIC !== "true" && String(chatId) !== env.ADMIN_CHAT_ID) {
    await tg.sendMessage(chatId, "Stats aren't public right now.");
    return;
  }

  const stats = await snapshot(env);
  const lines = [
    "<b>Bot stats</b>",
    `Active watches: <b>${stats.activeWatches}</b>`,
    `People served: <b>${stats.totalUsers}</b>`,
    `Alerts sent: <b>${stats.alertsAllTime}</b>`,
    stats.resolutionRate === null
      ? "Prices resolved automatically: —"
      : `Prices resolved automatically: <b>${stats.resolutionRate}%</b>`,
    `Checks today: <b>${stats.checksToday}</b> ok, ${stats.failuresToday} failed`,
    stats.uptimeDays === null ? "" : `Running for <b>${stats.uptimeDays}</b> days`,
  ].filter((line) => line.length > 0);

  await tg.sendMessage(chatId, lines.join("\n"));
}
