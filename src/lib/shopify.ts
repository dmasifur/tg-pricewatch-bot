import { fetchJson } from "./fetcher";
import { type ParsedPrice, parsePrice } from "./price";

// Fails silently on anything but a clean 200 — some Shopify stores sit
// behind Cloudflare and block the .json endpoint even though the page loads fine.
const SHOPIFY_MARKERS = ["Shopify.theme", "ShopifyAnalytics", "cdn.shopify.com/s/files"];
const PRODUCT_PATH_RE = /^\/products\/[a-z0-9-]+\/?$/i;

export interface ShopifyProductResult {
  price: ParsedPrice;
  title: string;
  inStock?: boolean;
}

interface ShopifyVariant {
  price?: string;
  price_currency?: string;
  available?: boolean;
}

interface ShopifyProductJson {
  product?: {
    title?: string;
    variants?: ShopifyVariant[];
  };
}

export function looksLikeShopifyProductPage(html: string, pathname: string): boolean {
  return PRODUCT_PATH_RE.test(pathname) && SHOPIFY_MARKERS.some((marker) => html.includes(marker));
}

export async function fetchShopifyProduct(
  origin: string,
  pathname: string,
  opts: { maxBytes: number; timeoutMs?: number },
): Promise<ShopifyProductResult | null> {
  const jsonUrl = `${origin}${pathname.replace(/\/$/, "")}.json`;
  const data = await fetchJson<ShopifyProductJson>(jsonUrl, opts);

  const variants = data?.product?.variants;
  if (!variants?.length) return null;

  const inStockVariants = variants.filter((v) => v.available !== false);
  const pool = inStockVariants.length ? inStockVariants : variants;
  const cheapest = pool.reduce((lowest, current) =>
    priceOf(current) < priceOf(lowest) ? current : lowest,
  );

  const price = parsePrice(cheapest.price, cheapest.price_currency ?? null);
  if (!price) return null;

  return {
    price,
    title: data?.product?.title ?? "",
    inStock: inStockVariants.length > 0,
  };
}

function priceOf(variant: ShopifyVariant): number {
  const n = Number(variant.price);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}
