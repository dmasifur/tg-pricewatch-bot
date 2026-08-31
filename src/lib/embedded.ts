import { findProduct } from "./jsonld";
import { type ParsedPrice, parsePrice } from "./price";

const MAX_STATE_BLOB = 512 * 1024;

const STATE_BLOB_MARKERS = ["window.__NEXT_DATA__", "window.__NUXT__", "window.__INITIAL_STATE__"];

// "price" alone is excluded: too generic, already covered by jsonld/meta/microdata.
const PRICE_KEY_RE =
  /"(?:pdt_price|priceAmount|displayPrice|salePrice)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/g;
const CURRENCY_NEARBY_RE = /"(?:currencySymbol|priceCurrency|currency)"\s*:\s*"([^"]{1,8})"/;

export interface EmbeddedResult {
  price: ParsedPrice;
  source: "embedded";
}

export function findEmbeddedPrice(scripts: string[]): EmbeddedResult | null {
  for (const script of scripts) {
    const markerIndex = STATE_BLOB_MARKERS.map((marker) => script.indexOf(marker)).find(
      (i) => i >= 0,
    );
    if (markerIndex === undefined) continue;
    const json = extractJsonLiteral(script, markerIndex);
    if (json === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const product = findProduct(parsed);
    if (product) {
      const price = parsePrice(product.price, product.currency ?? null);
      if (price) return { price, source: "embedded" };
    }
  }

  // Daraz's payload is a JSON string embedded in another JS string, so its
  // quotes arrive backslash-escaped; un-escape first so the regex matches.
  for (const script of scripts) {
    const normalized = script.includes('\\"') ? script.replace(/\\"/g, '"') : script;
    PRICE_KEY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((match = PRICE_KEY_RE.exec(normalized))) {
      const raw = match[1];
      if (raw === undefined) continue;
      const value = raw.startsWith('"') ? safeJsonString(raw) : Number(raw);
      if (value === null || value === undefined) continue;

      const start = Math.max(0, match.index - 80);
      const nearby = normalized.slice(start, match.index + 80);
      const currencyHint = nearby.match(CURRENCY_NEARBY_RE)?.[1] ?? null;

      const price = parsePrice(value, currencyHint);
      if (price) return { price, source: "embedded" };
    }
  }

  return null;
}

function safeJsonString(raw: string): string | null {
  try {
    const value = JSON.parse(raw);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// Balanced-brace scan starting after fromIndex, not the first "=" in the
// string — a whole-page scan could have an unrelated "=" earlier.
function extractJsonLiteral(script: string, fromIndex: number): string | null {
  const eq = script.indexOf("=", fromIndex);
  if (eq < 0) return null;

  let i = eq + 1;
  while (i < script.length && /\s/.test(script[i] as string)) i++;

  const openChar = script[i];
  if (openChar !== "{" && openChar !== "[") return null;
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  const limit = Math.min(script.length, i + MAX_STATE_BLOB);

  for (let j = i; j < limit; j++) {
    const ch = script[j] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return script.slice(i, j + 1);
    }
  }
  return null;
}
