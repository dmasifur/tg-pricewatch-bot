import type { Env, InlineButton } from "../types";
import { type Budget, checkWatch, spend, type WatchRow } from "./check";
import { alertAdmin, bump, clearAlert, setState } from "./ops";
import { escapeHtml, type Telegram } from "./telegram";

const SUBREQUEST_BUDGET = 40;
const BATCH_SIZE = 15;
const CONCURRENCY = 5;
const EXPIRY_WARNING_LIMIT = 5;
const RETENTION_DAYS = 30;

export interface SweepStats {
  checked: number;
  expired: number;
  warned: number;
}

export async function runSweep(env: Env, tg: Telegram): Promise<SweepStats> {
  const startedAt = Date.now();
  try {
    const stats = await sweepInner(env, tg);
    await setState(env, "last_sweep", String(startedAt));
    await bump(env, { sweeps: 1 });
    await clearAlert(env, "sweep_failed");
    return stats;
  } catch (error) {
    await bump(env, { sweeps: 1 });
    await alertAdmin(env, "sweep_failed", `Sweep threw: ${String(error).slice(0, 300)}`);
    throw error;
  }
}

async function warnExpiring(env: Env, tg: Telegram, budget: Budget, now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const rows = await env.DB.prepare(
    `SELECT w.id, w.chat_id, w.title, w.host FROM watches w
     WHERE w.status = 'active' AND w.expires_at <= ? AND w.expires_at > ?
       AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.watch_id = w.id AND a.kind = 'expiring')
     LIMIT ?`,
  )
    .bind(soon, now.toISOString(), EXPIRY_WARNING_LIMIT)
    .all<{ id: number; chat_id: number; title: string | null; host: string }>();

  let sent = 0;
  for (const row of rows.results ?? []) {
    if (!spend(budget, 1)) break;

    const keyboard: InlineButton[][] = [
      [
        { text: `↻ Extend ${env.WATCH_TTL_DAYS} days`, callback_data: `w:${row.id}:ext` },
        { text: "Let it go", callback_data: `w:${row.id}:del` },
      ],
    ];

    const result = await tg.sendMessage(
      row.chat_id,
      `Your watch on <b>${escapeHtml(row.title ?? row.host)}</b> expires tomorrow.`,
      keyboard,
    );
    if (result === null) continue;

    await env.DB.prepare(
      "INSERT INTO alerts (watch_id, sent_at, kind, price) VALUES (?,?,'expiring',NULL)",
    )
      .bind(row.id, new Date().toISOString())
      .run();
    sent += 1;
  }
  return sent;
}
async function sweepInner(env: Env, tg: Telegram): Promise<SweepStats> {
  const now = new Date();
  const nowIso = now.toISOString();
  const budget: Budget = { remaining: SUBREQUEST_BUDGET };

  await env.DB.batch([
    env.DB.prepare("DELETE FROM watches WHERE status = 'pending' AND expires_at <= ?").bind(nowIso),
    env.DB.prepare(
      "UPDATE watches SET status = 'expired' WHERE status IN ('active','failing') AND expires_at <= ?",
    ).bind(nowIso),
    env.DB.prepare("DELETE FROM watches WHERE status = 'expired' AND expires_at <= ?").bind(
      new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString(),
    ),
  ]);

  const warned = await warnExpiring(env, tg, budget, now);

  const due = await env.DB.prepare(
    `SELECT id, chat_id, url, host, title, currency, last_price, target_price, notify_mode,
            selector, interval_minutes, fail_count, last_in_stock
     FROM watches WHERE status IN ('active','failing') AND next_check_at <= ?
     ORDER BY next_check_at LIMIT ?`,
  )
    .bind(nowIso, BATCH_SIZE)
    .all<WatchRow>();

  const watches = due.results ?? [];
  for (let i = 0; i < watches.length; i += CONCURRENCY) {
    const slice = watches.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((watch) => checkWatch(watch, env, tg, budget)));

    if (budget.remaining <= 2) {
      await bump(env, { budget_exhausted: 1 });
      break;
    }
  }

  return { checked: watches.length, expired: 0, warned };
}
