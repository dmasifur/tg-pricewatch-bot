import { type PriceCandidate, resolve, scanCandidates, scanPage } from "../lib/extract";
import { assertSafeUrl, type FetchedPage, fetchPage, UnsafeUrlError } from "../lib/fetcher";
import { checkWatchLimits, clampInterval, isoIn, recordRegistration } from "../lib/limits";
import { formatPrice, parsePrice } from "../lib/price";
import { escapeHtml, type Telegram } from "../lib/telegram";
import type { Env, InlineButton } from "../types";

const USER_AGENT =
  "PriceWatchBot/1.0 (+https://asifur.dev; this bot is for demo purpose; contact via Telegram)";

export async function startWatch(
  chatId: number,
  rawUrl: string,
  env: Env,
  tg: Telegram,
): Promise<void> {
  const limits = await checkWatchLimits(chatId, env);
  if (!limits.ok) {
    if (!limits.reason) return;
    await tg.sendMessage(chatId, limits.reason);
    return;
  }

  let url: URL;
  try {
    url = assertSafeUrl(rawUrl);
  } catch (err) {
    await tg.sendMessage(
      chatId,
      err instanceof UnsafeUrlError ? err.message : "I couldn't read that link.",
    );
    return;
  }

  const progress = await tg.sendMessage(chatId, `Reading <b>${escapeHtml(url.hostname)}</b>…`);
  const messageId = (progress as { message_id?: number } | null)?.message_id;
  const edit = (text: string, kb?: InlineButton[][]) =>
    messageId ? tg.editMessageText(chatId, messageId, text, kb) : tg.sendMessage(chatId, text, kb);

  let page: FetchedPage;
  try {
    page = await fetchPage(url.toString(), {
      maxBytes: Number(env.MAX_BODY_BYTES),
      userAgent: USER_AGENT,
    });
  } catch (err) {
    console.warn("fetch failed", url.hostname, String(err));
    await edit(
      "That page didn't load — it may be blocking me or temporarily down. Try another link, or /demo to see how this works.",
    );
    return;
  }

  if (page.status >= 400 || !page.html) {
    await edit(
      `That page returned ${page.status || "no readable content"}. Try another link, or /demo.`,
    );
    return;
  }

  const result = resolve(await scanPage(page.html));
  await recordRegistration(chatId, env);

  if (result.price) {
    const id = await insertWatch(
      chatId,
      url,
      page.finalUrl,
      result.title,
      result.price,
      resultSource(result.source),
      env,
    );
    if (!id) throw new Error("Id is undefined or not found");

    await edit(
      confirmationText(
        result.title,
        url.hostname,
        formatPrice(result.price.amount, result.price.currency),
      ),
      confirmationKeyboard(id, env),
    );
    return;
  }

  // Automatic chain failed — ask the user to point at the price.
  const candidates = await scanCandidates(page.html);
  if (!candidates.length) {
    await edit(
      "I couldn't find a price on that page. Some sites render prices only in the browser, which I can't see. Try a different product page, or /demo.",
    );
    return;
  }

  const id = await insertPending(chatId, url, page.finalUrl, result.title, candidates, env);
  await edit(
    `I couldn't identify the price automatically. I found these numbers on the page — which one is it?`,
    candidates
      .map((c, i) => [{ text: c.text, callback_data: `w:${id}:c:${i}` }])
      .concat([[{ text: "None of these", callback_data: `w:${id}:x` }]]),
  );
}

export async function confirmCandidate(
  watchId: number,
  index: number,
  env: Env,
): Promise<{ ok: boolean; label?: string }> {
  const row = await env.DB.prepare(
    "SELECT candidates FROM watches WHERE id = ? AND status = 'pending'",
  )
    .bind(watchId)
    .first<{ candidates: string }>();
  if (!row) return { ok: false };

  const candidates = JSON.parse(row.candidates) as PriceCandidate[];
  const picked = candidates[index];
  if (!picked) return { ok: false };

  const price = parsePrice(picked.text);
  if (!price) return { ok: false };

  await env.DB.prepare(
    `UPDATE watches SET status='active', selector=?, selector_source='user_tap', candidates=NULL,
       last_price=?, currency=?, next_check_at=? WHERE id = ?`,
  )
    .bind(
      picked.selector,
      price.amount,
      price.currency,
      isoIn(Number(env.MIN_INTERVAL_MINUTES)),
      watchId,
    )
    .run();

  return { ok: true, label: formatPrice(price.amount, price.currency) };
}

function resultSource(source: string): string {
  return source === "none" ? "user_tap" : source;
}

async function insertWatch(
  chatId: number,
  url: URL,
  finalUrl: string,
  title: string | undefined,
  price: { amount: number; currency: string | null },
  source: string,
  env: Env,
): Promise<number | undefined> {
  const now = new Date().toISOString();
  const interval = clampInterval(360, env);
  const result = await env.DB.prepare(
    `INSERT INTO watches (chat_id, url, host, title, currency, last_price, selector_source,
       interval_minutes, next_check_at, expires_at, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'active',?) RETURNING id`,
  )
    .bind(
      chatId,
      finalUrl,
      url.hostname,
      title?.slice(0, 160) ?? null,
      price.currency,
      price.amount,
      source,
      interval,
      isoIn(interval),
      isoIn(Number(env.WATCH_TTL_DAYS) * 24 * 60),
      now,
    )
    .first<{ id: number }>();
  return result?.id;
}

async function insertPending(
  chatId: number,
  url: URL,
  finalUrl: string,
  title: string | undefined,
  candidates: PriceCandidate[],
  env: Env,
): Promise<number | undefined> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO watches (chat_id, url, host, title, interval_minutes, next_check_at, expires_at,
       status, candidates, created_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?) RETURNING id`,
  )
    .bind(
      chatId,
      finalUrl,
      url.hostname,
      title?.slice(0, 160) ?? null,
      clampInterval(360, env),
      isoIn(60),
      isoIn(60), // pending rows expire in an hour if never confirmed
      JSON.stringify(candidates),
      now,
    )
    .first<{ id: number }>();
  return result?.id;
}

function confirmationText(title: string | undefined, host: string, price: string): string {
  return (
    `<b>${escapeHtml(title ?? host)}</b>\n` +
    `Current price: <b>${escapeHtml(price)}</b>\n\n` +
    `I'll check every 6 hours and message you when it drops.`
  );
}

export function confirmationKeyboard(id: number, _env: Env): InlineButton[][] {
  return [
    [
      { text: "🔔 Any drop", callback_data: `w:${id}:m:any` },
      { text: "🎯 Set target", callback_data: `w:${id}:m:tgt` },
    ],
    [
      { text: "1h", callback_data: `w:${id}:i:60` },
      { text: "6h", callback_data: `w:${id}:i:360` },
      { text: "24h", callback_data: `w:${id}:i:1440` },
    ],
    [{ text: "🗑 Cancel watch", callback_data: `w:${id}:del` }],
  ];
}
