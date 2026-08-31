import { type PriceCandidate, resolve, scanCandidates, scanPage } from "../lib/extract";
import { assertSafeUrl, type FetchedPage, fetchPage, UnsafeUrlError } from "../lib/fetcher";
import { checkWatchLimits, clampInterval, isoIn, recordRegistration } from "../lib/limits";
import { formatPrice, parsePrice } from "../lib/price";
import { fetchShopifyProduct, looksLikeShopifyProductPage } from "../lib/shopify";
import { escapeHtml, type Telegram } from "../lib/telegram";
import { findUnsupportedHost } from "../lib/unsupported-hosts";
import type { Env, InlineButton } from "../types";

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

  const unsupported = findUnsupportedHost(url.hostname);
  if (unsupported) {
    await tg.sendMessage(
      chatId,
      `${unsupported.name} ${unsupported.reason}, so I can't watch this one.\n\n` +
        `These work well: Amazon, Daraz, Bikroy, and most Shopify or WooCommerce stores.`,
      [[{ text: "❓ How do I add a link?", callback_data: "guide:open" }]],
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
    });
  } catch (err) {
    console.warn("fetch failed", url.hostname, String(err));
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    await edit(
      timedOut
        ? `${escapeHtml(url.hostname)} took too long to respond. It might be slow right now — try again in a moment, or send a different link.`
        : `I couldn't reach ${escapeHtml(url.hostname)} — it may be blocking automated requests, or the link may be broken. Double-check the link, or try a different product page.`,
      helpKeyboard(),
    );
    return;
  }

  if (page.status === 404) {
    await edit(
      `That page doesn't exist (404) — the link may be broken or the product may have been removed.`,
      helpKeyboard(),
    );
    return;
  }
  if (page.status === 403 || page.status === 429) {
    await edit(
      `${escapeHtml(url.hostname)} is blocking automated requests to this page right now. Try again later, or send a different product link.`,
      helpKeyboard(),
    );
    return;
  }
  if (page.status >= 400 || !page.html) {
    await edit(
      `That page returned an error (status ${page.status || "unknown"}). Try another link, or check the page loads in your own browser first.`,
      helpKeyboard(),
    );
    return;
  }

  const result = resolve(await scanPage(page.html));
  await recordRegistration(chatId, env);

  let price = result.price;
  let title = result.title;
  let source: string = result.source;

  // Fast path: generic extraction found nothing, but this looks like Shopify.
  if (!price && looksLikeShopifyProductPage(page.html, url.pathname)) {
    const shopify = await fetchShopifyProduct(url.origin, url.pathname, {
      maxBytes: Number(env.MAX_BODY_BYTES),
      timeoutMs: 6_000,
    });
    if (shopify) {
      price = shopify.price;
      title = shopify.title || title;
      source = "shopify_json";
    }
  }

  if (price) {
    const inserted = await insertWatch(
      chatId,
      url,
      page.finalUrl,
      title,
      price,
      resultSource(source),
      env,
    );
    if (!inserted) throw new Error("Id is undefined or not found");

    await edit(
      summaryText({
        title,
        host: url.hostname,
        price: formatPrice(price.amount, price.currency),
        notifyMode: "any_drop",
        intervalMinutes: inserted.intervalMinutes,
      }),
      confirmationKeyboard(inserted.id, env),
    );
    return;
  }

  // Automatic chain failed — ask the user to point at the price.
  const candidates = await scanCandidates(page.html);
  if (!candidates.length) {
    await edit(
      "I couldn't find a price on that page — some sites only show it after running JavaScript in a full browser, which I can't do. " +
        "Try a different product page on the same site, or see /guide for which sites work best.",
      helpKeyboard(),
    );
    return;
  }

  const id = await insertPending(chatId, url, page.finalUrl, result.title, candidates, env);
  const titleLine = result.title ? `<b>${escapeHtml(result.title)}</b>\n` : "";
  await edit(
    `${titleLine}I couldn't identify the price automatically — I found a few numbers on the page. Which one is it?`,
    candidates
      .map((c, i) => [{ text: c.text, callback_data: `w:${id}:c:${i}` }])
      .concat([[{ text: "None of these", callback_data: `w:${id}:x` }]]),
  );
}

function helpKeyboard(): InlineButton[][] {
  return [
    [{ text: "❓ How do I add a link?", callback_data: "guide:open" }],
    [{ text: "📋 My watches", callback_data: "list:1" }],
  ];
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
): Promise<{ id: number; intervalMinutes: number } | undefined> {
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
  return result?.id === undefined ? undefined : { id: result.id, intervalMinutes: interval };
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

export interface WatchSummaryParams {
  title: string | undefined;
  host: string;
  price: string;
  notifyMode: string;
  targetPrice?: string;
  intervalMinutes: number;
}

// Also used to re-render the message in place after a mode/interval tap.
export function summaryText(params: WatchSummaryParams): string {
  const alertLine =
    params.notifyMode === "target" && params.targetPrice
      ? `🎯 Alert when it hits <b>${escapeHtml(params.targetPrice)}</b>`
      : "🔔 Alert on any price drop";
  const interval =
    params.intervalMinutes >= 60 ? `${params.intervalMinutes / 60}h` : `${params.intervalMinutes}m`;
  return (
    `<b>${escapeHtml(params.title ?? params.host)}</b>\n` +
    `Current price: <b>${escapeHtml(params.price)}</b>\n` +
    `${alertLine}\n` +
    `Checking every ${interval}`
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
