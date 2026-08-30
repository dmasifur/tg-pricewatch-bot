import type { Env } from "../types";

export interface LimitVerdict {
  ok: boolean;
  reason?: string;
}

export async function checkWatchLimits(chatId: number, env: Env): Promise<LimitVerdict> {
  const maxActive = Number(env.MAX_ACTIVE_WATCHES);
  const maxPerHour = Number(env.MAX_REGISTRATIONS_PER_HOUR);
  const window = new Date().toISOString().slice(0, 13); // hour bucket

  const [active, rate] = await env.DB.batch<{ n: number }>([
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM watches WHERE chat_id = ? AND status IN ('active','failing')",
    ).bind(chatId),
    env.DB.prepare(
      "SELECT registrations AS n FROM rate_limits WHERE chat_id = ? AND window_start = ?",
    ).bind(chatId, window),
  ]);

  if ((active?.results?.[0]?.n ?? 0) >= maxActive) {
    return {
      ok: false,
      reason: `You're watching ${maxActive} products already — that's the limit. Remove one with /list first.`,
    };
  }
  if ((rate?.results?.[0]?.n ?? 0) >= maxPerHour) {
    return {
      ok: false,
      reason: "You've added a few watches just now. Try again in an hour.",
    };
  }
  return { ok: true };
}

export async function recordRegistration(chatId: number, env: Env): Promise<void> {
  const window = new Date().toISOString().slice(0, 13);
  await env.DB.prepare(
    `INSERT INTO rate_limits (chat_id, window_start, registrations) VALUES (?, ?, 1)
     ON CONFLICT(chat_id, window_start) DO UPDATE SET registrations = registrations + 1`,
  )
    .bind(chatId, window)
    .run();
}

export function clampInterval(minutes: number, env: Env): number {
  return Math.max(Number(env.MIN_INTERVAL_MINUTES), Math.min(minutes, 24 * 60));
}

export function isoIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
