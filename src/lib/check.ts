import type { Env, InlineButton } from "../types";
import { resolve, scanPage } from "./extract";
import { fetchPage } from "./fetcher";
import { percentChange, sparkline } from "./history";
import { type Decision, decideAlert, type LastAlert } from "./notify";
import { bump } from "./ops";
import { formatPrice } from "./price";
import { escapeHtml, type Telegram } from "./telegram";

const FAILING_AFTER = 3;
const PAUSE_AFTER = 6;
const MAX_BACKOFF_MINUTES = 24 * 60;

export interface WatchRow {
  id: number;
  chat_id: number;
  url: string;
  host: string;
  title: string | null;
  currency: string | null;
  last_price: number | null;
  target_price: number | null;
  notify_mode: string;
  selector: string | null;
  interval_minutes: number;
  fail_count: number;
  last_in_stock: number | null;
}

export interface Budget {
  remaining: number;
}

export function spend(budget: Budget, cost: number): boolean {
  if (budget.remaining < cost) return false;
  budget.remaining -= cost;
  return true;
}

export async function checkWatch(
  watch: WatchRow,
  env: Env,
  tg: Telegram,
  budget: Budget,
): Promise<void> {
  if (!spend(budget, 1)) return;

  const now = Date.now();
  let price: number | null = null;
  let inStock: boolean | null = null;
  let status = 0;

  try {
    const page = await fetchPage(watch.url, {
      maxBytes: Number(env.MAX_BODY_BYTES),
    });
    status = page.status;

    if (page.status < 400 && page.html.length > 0) {
      const signals = await scanPage(page.html, watch.selector ?? undefined);
      const result = resolve(signals);
      if (result.price !== null) {
        price = result.price.amount;
        inStock = result.inStock ?? null;
      }
    }
  } catch (error) {
    console.warn(`check failed watch=${watch.id} host=${watch.host}`, String(error));
  }

  await env.DB.prepare(
    "INSERT INTO price_points (watch_id, checked_at, price, in_stock, http_status) VALUES (?,?,?,?,?)",
  )
    .bind(watch.id, new Date(now).toISOString(), price, boolToInt(inStock), status)
    .run();

  await bump(env, price === null ? { checks_failed: 1 } : { checks_ok: 1 });

  if (price === null) {
    await recordFailure(watch, env, tg, budget);
    return;
  }

  const lastAlert = await loadLastAlert(watch.id, env);
  const decision = decideAlert({
    notifyMode: watch.notify_mode,
    targetPrice: watch.target_price,
    previousPrice: watch.last_price,
    newPrice: price,
    previousInStock: intToBool(watch.last_in_stock),
    newInStock: inStock,
    lastAlert,
    now,
  });

  await env.DB.prepare(
    `UPDATE watches SET last_price = ?, last_in_stock = ?, last_checked_at = ?, next_check_at = ?,
       fail_count = 0, status = 'active', paused_reason = NULL WHERE id = ?`,
  )
    .bind(
      price,
      boolToInt(inStock),
      new Date(now).toISOString(),
      new Date(now + watch.interval_minutes * 60_000).toISOString(),
      watch.id,
    )
    .run();

  if (decision === null) return;
  await sendAlert(watch, decision, env, tg, budget);
}

async function sendAlert(
  watch: WatchRow,
  decision: Decision,
  env: Env,
  tg: Telegram,
  budget: Budget,
): Promise<void> {
  if (!spend(budget, 1)) return;

  const points = await env.DB.prepare(
    "SELECT price FROM price_points WHERE watch_id = ? AND price IS NOT NULL ORDER BY checked_at DESC LIMIT 24",
  )
    .bind(watch.id)
    .all<{ price: number }>();

  const series = (points.results ?? []).map((row) => row.price).reverse();
  const spark = sparkline(series);
  const label = escapeHtml(watch.title ?? watch.host);
  const priceNow = escapeHtml(formatPrice(decision.newPrice, watch.currency));

  let body: string;
  if (decision.kind === "restock") {
    body = `<b>${label}</b>\nBack in stock at <b>${priceNow}</b>`;
  } else if (decision.previousPrice === null) {
    body = `<b>${label}</b>\nNow <b>${priceNow}</b>`;
  } else {
    const before = escapeHtml(formatPrice(decision.previousPrice, watch.currency));
    const pct = percentChange(decision.previousPrice, decision.newPrice);
    body = `<b>${label}</b>\n<s>${before}</s> → <b>${priceNow}</b>  (−${pct}%)`;
  }

  if (spark.length > 0) body += `\n<code>${spark}</code>`;

  const keyboard: InlineButton[][] = [
    [
      { text: "🛒 Open product", url: watch.url },
      { text: "🔕 Stop watching", callback_data: `w:${watch.id}:del` },
    ],
  ];

  const sent = await tg.sendMessage(watch.chat_id, body, keyboard);
  if (sent === null) return;

  await env.DB.prepare("INSERT INTO alerts (watch_id, sent_at, kind, price) VALUES (?,?,?,?)")
    .bind(watch.id, new Date().toISOString(), decision.kind, decision.newPrice)
    .run();
  await bump(env, { alerts_sent: 1 });
  await maybePitch(watch.chat_id, env, tg, budget);
}

async function maybePitch(chatId: number, env: Env, tg: Telegram, budget: Budget): Promise<void> {
  const user = await env.DB.prepare("SELECT pitch_shown_at FROM users WHERE chat_id = ?")
    .bind(chatId)
    .first<{ pitch_shown_at: string | null }>();

  if (user === null || user.pitch_shown_at !== null) return;
  if (!spend(budget, 1)) return;

  await env.DB.prepare("UPDATE users SET pitch_shown_at = ? WHERE chat_id = ?")
    .bind(new Date().toISOString(), chatId)
    .run();

  await tg.sendMessage(chatId, "Want something like this built for your own use case? /hire");
}

async function recordFailure(
  watch: WatchRow,
  env: Env,
  tg: Telegram,
  budget: Budget,
): Promise<void> {
  const fails = watch.fail_count + 1;
  const backoff = Math.min(watch.interval_minutes * 2 ** fails, MAX_BACKOFF_MINUTES);
  const nextStatus =
    fails >= PAUSE_AFTER ? "paused" : fails >= FAILING_AFTER ? "failing" : "active";

  await env.DB.prepare(
    "UPDATE watches SET fail_count = ?, status = ?, paused_reason = ?, last_checked_at = ?, next_check_at = ? WHERE id = ?",
  )
    .bind(
      fails,
      nextStatus,
      nextStatus === "paused" ? "unreadable" : null,
      new Date().toISOString(),
      new Date(Date.now() + backoff * 60_000).toISOString(),
      watch.id,
    )
    .run();

  if (nextStatus === "paused" && spend(budget, 1)) {
    await tg.sendMessage(
      watch.chat_id,
      `I've stopped watching <b>${escapeHtml(watch.title ?? watch.host)}</b> — the page stopped returning a price I can read.`,
    );
  }
}

async function loadLastAlert(watchId: number, env: Env): Promise<LastAlert | null> {
  const row = await env.DB.prepare(
    "SELECT kind, price, sent_at FROM alerts WHERE watch_id = ? ORDER BY sent_at DESC LIMIT 1",
  )
    .bind(watchId)
    .first<{ kind: string; price: number | null; sent_at: string }>();

  if (row === null) return null;
  return { kind: row.kind, price: row.price, sentAt: Date.parse(row.sent_at) };
}

function boolToInt(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function intToBool(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}
