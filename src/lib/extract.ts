import { availabilityToBool, findProduct } from "./jsonld";
import { type ParsedPrice, parsePrice } from "./price";

const MAX_LD_BLOCK = 256 * 1024;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface PageSignals {
  jsonLd: string[];
  metaPrice?: string;
  metaCurrency?: string;
  metaAvailability?: string;
  itempropPrice?: string;
  itempropCurrency?: string;
  ogTitle?: string;
  titleTag?: string;
  selectorText?: string;
}

export interface ExtractResult {
  price: ParsedPrice | null;
  title?: string;
  inStock?: boolean;
  source: "selector" | "jsonld" | "meta" | "microdata" | "none";
}

export async function scanPage(html: string, selector?: string): Promise<PageSignals> {
  const signals: PageSignals = { jsonLd: [] };
  let ldBuffer = "";
  let titleBuffer = "";
  let selectorBuffer = "";

  const flushLd = () => {
    const block = ldBuffer.trim();
    if (block && block.length <= MAX_LD_BLOCK && signals.jsonLd.length < 12)
      signals.jsonLd.push(block);
    ldBuffer = "";
  };

  let rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element() {
        flushLd();
      },
      text(chunk) {
        if (ldBuffer.length < MAX_LD_BLOCK) ldBuffer += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const content = el.getAttribute("content");
        if (!key || !content) return;
        if (key === "product:price:amount" || key === "og:price:amount")
          signals.metaPrice ??= content;
        if (key === "product:price:currency" || key === "og:price:currency")
          signals.metaCurrency ??= content;
        if (key === "product:availability" || key === "og:availability")
          signals.metaAvailability ??= content;
        if (key === "og:title") signals.ogTitle ??= content;
      },
    })
    .on('[itemprop="price"]', {
      element(el) {
        signals.itempropPrice ??= el.getAttribute("content") ?? undefined;
      },
    })
    .on('[itemprop="priceCurrency"]', {
      element(el) {
        signals.itempropCurrency ??= el.getAttribute("content") ?? undefined;
      },
    })
    .on("title", {
      text(chunk) {
        if (titleBuffer.length < 400) titleBuffer += chunk.text;
      },
    });

  if (selector) {
    try {
      rewriter = rewriter.on(selector, {
        text(chunk) {
          if (selectorBuffer.length < 200) selectorBuffer += chunk.text;
        },
      });
    } catch {
      // Stored selector is no longer valid HTMLRewriter syntax; fall through
      // to the automatic chain rather than failing the whole check.
    }
  }

  await rewriter.transform(new Response(html)).arrayBuffer();

  flushLd();
  if (titleBuffer.trim()) signals.titleTag = titleBuffer.trim();
  if (selectorBuffer.trim()) signals.selectorText = selectorBuffer.trim();
  return signals;
}

export function resolve(signals: PageSignals): ExtractResult {
  const title = signals.ogTitle ?? signals.titleTag;

  if (signals.selectorText) {
    const price = parsePrice(signals.selectorText);
    if (price) return { price, title, source: "selector" };
  }

  for (const block of signals.jsonLd) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const product = findProduct(parsed);
    if (product) {
      const price = parsePrice(product.price, product.currency ?? null);
      if (price) {
        return {
          price,
          title: product.name ?? title,
          inStock: product.inStock,
          source: "jsonld",
        };
      }
    }
  }

  if (signals.metaPrice) {
    const price = parsePrice(signals.metaPrice, signals.metaCurrency ?? null);
    if (price) {
      return {
        price,
        title,
        inStock: availabilityToBool(signals.metaAvailability),
        source: "meta",
      };
    }
  }

  if (signals.itempropPrice) {
    const price = parsePrice(signals.itempropPrice, signals.itempropCurrency ?? null);
    if (price) return { price, title, source: "microdata" };
  }

  return { price: null, title, source: "none" };
}

export interface PriceCandidate {
  text: string;
  selector: string;
  score: number;
}

const CURRENCY_TEXT =
  /(?:[$€£¥₹₽₺₩৳]|\b(?:USD|EUR|GBP|JPY|INR|AUD|CAD|BRL|PLN|SEK|BDT)\b)\s*\d[\d.,\s]{0,14}|\d[\d.,]{0,14}\s*(?:€|£|zł|kr|₹|৳)/i;
const PRICEY_ATTR = /price|amount|cost|offer|money/i;
// Ancestor markers scanCandidates uses to boost the real price / penalise cross-sell widgets.
const PRIMARY_PRICE_CONTAINER =
  /coreprice|priceblock|apexpricetopay|a-price|price-current|saleprice/i;
const CROSS_SELL_CONTAINER =
  /\bsims\b|p13n|similar|related|also-?bought|you-?may-?also|value-?pick|recommend|bundle/i;

export async function scanCandidates(html: string): Promise<PriceCandidate[]> {
  const stack: Array<{ tag: string; id?: string; cls?: string }> = [];
  const found = new Map<string, PriceCandidate>();
  let current = "";

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    current = "";
    if (!text || text.length > 40 || !CURRENCY_TEXT.test(text)) return;
    if (found.has(text) || found.size >= 24) return;

    const selector = buildSelector(stack);
    if (!selector) return;
    found.set(text, { text, selector, score: scoreOf(stack, found.size) });
  };

  // SVG/MathML self-closing tags make HTMLRewriter's onEndTag() throw ("No end tag."); skip them.
  const FOREIGN_ROOTS = new Set(["svg", "math"]);
  let foreignDepth = 0;

  await new HTMLRewriter()
    .on("*", {
      element(el) {
        if (el.tagName === "script" || el.tagName === "style") return;

        if (foreignDepth > 0 || FOREIGN_ROOTS.has(el.tagName)) {
          foreignDepth++;
          if (!VOID_TAGS.has(el.tagName)) {
            try {
              el.onEndTag(() => {
                foreignDepth--;
              });
            } catch {
              foreignDepth--;
            }
          } else {
            foreignDepth--;
          }
          return;
        }

        const frame = {
          tag: el.tagName,
          id: el.getAttribute("id") ?? undefined,
          cls: el.getAttribute("class")?.split(/\s+/)[0] || undefined,
        };
        stack.push(frame);
        if (!VOID_TAGS.has(el.tagName)) {
          try {
            el.onEndTag(() => {
              flush();
              stack.pop();
            });
          } catch {
            // Malformed/self-closing tags can reject onEndTag outright; treat as closed.
            flush();
            stack.pop();
          }
        } else {
          stack.pop();
        }
      },
      text(chunk) {
        if (current.length < 200) current += chunk.text;
        if (chunk.lastInTextNode) flush();
      },
    })
    .transform(new Response(html))
    .arrayBuffer();

  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildSelector(stack: Array<{ tag: string; id?: string; cls?: string }>): string | null {
  if (!stack.length) return null;
  const tail = stack.slice(-4);

  const anchored = tail.findIndex((f) => f.id);
  const parts = (anchored >= 0 ? tail.slice(anchored) : tail).map((frame, i, arr) => {
    if (frame.id) return `#${cssEscape(frame.id)}`;
    const isLast = i === arr.length - 1;
    if (frame.cls && (isLast || PRICEY_ATTR.test(frame.cls)))
      return `${frame.tag}.${cssEscape(frame.cls)}`;
    return frame.tag;
  });

  const selector = parts.join(" ");
  return selector.length <= 180 ? selector : null;
}

function scoreOf(stack: Array<{ tag: string; id?: string; cls?: string }>, order: number): number {
  let score = 100 - order;
  for (const frame of stack.slice(-3)) {
    if (frame.id && PRICEY_ATTR.test(frame.id)) score += 40;
    if (frame.cls && PRICEY_ATTR.test(frame.cls)) score += 30;
  }
  const leaf = stack[stack.length - 1];
  if (leaf && (leaf.id || leaf.cls)) score += 10;

  // Checks the full ancestor chain, not just the nearest 3 frames.
  for (const frame of stack) {
    const marker = `${frame.id ?? ""} ${frame.cls ?? ""}`;
    if (CROSS_SELL_CONTAINER.test(marker)) score -= 60;
    if (PRIMARY_PRICE_CONTAINER.test(marker)) score += 50;
  }
  return score;
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}
