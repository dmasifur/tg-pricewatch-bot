import type { Env, InlineButton } from "../types";
import { USER_AGENT } from "./check";
import { resolve, scanPage } from "./extract";
import { fetchPage } from "./fetcher";
import { sparkline } from "./history";
import { formatPrice } from "./price";
import { escapeHtml, type Telegram } from "./telegram";

export interface DemoProduct {
  label: string;
  url: string;

  fallbackPrice: number;
  fallbackCurrency: string;
}

export const DEMO_CATALOGUE: readonly DemoProduct[] = [
  {
    label: "Example Headphones",
    url: "https://example.com/product/headphones",
    fallbackPrice: 149.99,
    fallbackCurrency: "USD",
  },
  {
    label: "Example Mechanical Keyboard",
    url: "https://example.com/product/keyboard",
    fallbackPrice: 89.0,
    fallbackCurrency: "USD",
  },
] as const;

const STAGE_CONFIRMED = 1;
const STAGE_ALERTED = 2;
const ALERT_DELAY_MS = 70_000;
const SEEDED_UPLIFT = 1.18; // staged "was" price, 18% above the live one

export function pickDemoProduct(seed: number): DemoProduct {
  const first = DEMO_CATALOGUE[0];
  if (first === undefined) throw new Error("DEMO_CATALOGUE is empty");
  return DEMO_CATALOGUE[seed % DEMO_CATALOGUE.length] ?? first;
}

export async function startDemo(chatId: number, env: Env, tg: Telegram): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT id FROM watches WHERE chat_id = ? AND is_demo = 1 AND demo_stage IS NOT NULL",
  )
    .bind(chatId)
    .first<{ id: number }>();

  if (existing !== null) {
    await tg.sendMessage(chatId, "Your demo is already running — the alert lands in a moment.");
    return;
  }

  const product = pickDemoProduct(Math.abs(chatId));
  const progress = await tg.sendMessage(chatId, `Reading <b>${escapeHtml(product.label)}</b>…`);
  const messageId = (progress as { message_id?: number } | null)?.message_id ?? null;

  const live = await livePrice(product, env);
  const seededPrior = Math.round(live.amount * SEEDED_UPLIFT * 100) / 100;
  const now = Date.now();

  const inserted = await env.DB.prepare(
    `INSERT INTO watches (chat_id, url, host, title, currency, last_price, notify_mode,
       selector_source, interval_minutes, next_check_at, expires_at, status, is_demo,
       demo_stage, demo_next_at, created_at)
     VALUES (?,?,?,?,?,?,'any_drop','demo',?,?,?,'active',1,?,?,?) RETURNING id`,
  )
    .bind(
      chatId,
      product.url,
      new URL(product.url).hostname,
      product.label,
      live.currency,
      seededPrior,
      Number(env.MIN_INTERVAL_MINUTES),
      new Date(now + 6 * 60 * 60 * 1000).toISOString(),
      new Date(now + Number(env.WATCH_TTL_DAYS) * 86_400_000).toISOString(),
      STAGE_CONFIRMED,
      new Date(now + ALERT_DELAY_MS).toISOString(),
      new Date(now).toISOString(),
    )
    .first<{ id: number }>();

  if (inserted === null) return;

  await seedHistory(inserted.id, seededPrior, live.amount, env);

  const text =
    `<b>${escapeHtml(product.label)}</b>\n` +
    `Current price: <b>${escapeHtml(formatPrice(seededPrior, live.currency))}</b>\n\n` +
    "Watching it now. I'll message you the moment it drops — for this demo, that's about a minute.";

  const keyboard: InlineButton[][] = [
    [{ text: "🗑 Cancel demo", callback_data: `w:${inserted.id}:del` }],
  ];

  if (messageId === null) {
    await tg.sendMessage(chatId, text, keyboard);
  } else {
    await tg.editMessageText(chatId, messageId, text, keyboard);
  }
}

export async function advanceDemos(env: Env, tg: Telegram): Promise<number> {
  const nowIso = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT id, chat_id, url, title, host, currency, last_price
     FROM watches WHERE demo_stage = ? AND demo_next_at <= ? LIMIT 10`,
  )
    .bind(STAGE_CONFIRMED, nowIso)
    .all<{
      id: number;
      chat_id: number;
      url: string;
      title: string | null;
      host: string;
      currency: string | null;
      last_price: number | null;
    }>();

  const rows = due.results ?? [];
  for (const row of rows) {
    const points = await env.DB.prepare(
      "SELECT price FROM price_points WHERE watch_id = ? AND price IS NOT NULL ORDER BY checked_at LIMIT 24",
    )
      .bind(row.id)
      .all<{ price: number }>();

    const series = (points.results ?? []).map((point) => point.price);
    const current = series.at(-1) ?? row.last_price ?? 0;
    const prior = row.last_price ?? current;
    const pct = prior > 0 ? Math.round(((prior - current) / prior) * 1000) / 10 : 0;
    const spark = sparkline(series);

    const body =
      `<b>${escapeHtml(row.title ?? row.host)}</b>\n` +
      `<s>${escapeHtml(formatPrice(prior, row.currency))}</s> → ` +
      `<b>${escapeHtml(formatPrice(current, row.currency))}</b>  (−${pct}%)\n` +
      (spark.length > 0 ? `<code>${spark}</code>\n` : "") +
      "\n<i>Demo: the current price is real, the price history is staged so you can see the whole loop without waiting days. Real watches only alert on real drops.</i>";

    const keyboard: InlineButton[][] = [
      [
        { text: "🛒 Open product", url: row.url },
        { text: "🔕 End demo", callback_data: `w:${row.id}:del` },
      ],
    ];

    await tg.sendMessage(row.chat_id, body, keyboard);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO alerts (watch_id, sent_at, kind, price) VALUES (?,?,'drop',?)",
      ).bind(row.id, new Date().toISOString(), current),
      env.DB.prepare(
        "UPDATE watches SET demo_stage = ?, demo_next_at = NULL, last_price = ? WHERE id = ?",
      ).bind(STAGE_ALERTED, current, row.id),
    ]);

    await pitchOnce(row.chat_id, env, tg);
  }

  return rows.length;
}

/** ADR-004: one offer per user, only after the payoff has landed. */
export async function pitchOnce(chatId: number, env: Env, tg: Telegram): Promise<void> {
  const user = await env.DB.prepare("SELECT pitch_shown_at FROM users WHERE chat_id = ?")
    .bind(chatId)
    .first<{ pitch_shown_at: string | null }>();

  if (user === null || user.pitch_shown_at !== null) return;

  await env.DB.prepare("UPDATE users SET pitch_shown_at = ? WHERE chat_id = ?")
    .bind(new Date().toISOString(), chatId)
    .run();

  await tg.sendMessage(chatId, "Want something like this built for your own use case? /hire");
}

async function livePrice(
  product: DemoProduct,
  env: Env,
): Promise<{ amount: number; currency: string | null }> {
  try {
    const page = await fetchPage(product.url, {
      maxBytes: Number(env.MAX_BODY_BYTES),
      userAgent: USER_AGENT,
    });
    if (page.status < 400 && page.html.length > 0) {
      const result = resolve(await scanPage(page.html));
      if (result.price !== null) return result.price;
    }
  } catch (error) {
    console.warn("demo live fetch failed", String(error));
  }
  return { amount: product.fallbackPrice, currency: product.fallbackCurrency };
}

async function seedHistory(watchId: number, from: number, to: number, env: Env): Promise<void> {
  const steps = 12;
  const start = Date.now() - steps * 6 * 60 * 60 * 1000;
  const statements = [];

  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const eased = from + (to - from) * progress ** 2;
    const jitter = 1 + (((i * 37) % 7) - 3) / 400;
    statements.push(
      env.DB.prepare(
        "INSERT INTO price_points (watch_id, checked_at, price, in_stock, http_status) VALUES (?,?,?,1,200)",
      ).bind(
        watchId,
        new Date(start + i * 6 * 60 * 60 * 1000).toISOString(),
        Math.round(eased * jitter * 100) / 100,
      ),
    );
  }
  await env.DB.batch(statements);
}
