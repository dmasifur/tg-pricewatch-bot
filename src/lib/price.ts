export interface ParsedPrice {
  amount: number;
  currency: string | null;
}

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  R$: "BRL",
  A$: "AUD",
  C$: "CAD",
  zł: "PLN",
  kr: "SEK",
  "₺": "TRY",
  "₩": "KRW",
  "৳": "BDT",
};

const ISO_RE =
  /\b(USD|EUR|GBP|JPY|INR|AUD|CAD|BRL|PLN|SEK|CHF|CNY|RUB|TRY|KRW|BDT|AED|SGD|NZD|MXN|ZAR)\b/i;

export function detectCurrency(raw: string, hint?: string | null): string | null {
  if (hint && /^[A-Z]{3}$/i.test(hint)) return hint.toUpperCase();

  const iso = raw.match(ISO_RE);
  const isoCode = iso?.[1];
  if (isoCode) return isoCode.toUpperCase();

  for (const sym of Object.keys(SYMBOL_TO_CURRENCY).sort((a, b) => b.length - a.length)) {
    if (raw.includes(sym)) {
      const mapped = SYMBOL_TO_CURRENCY[sym];
      if (mapped) return mapped;
    }
  }

  return null;
}

export function parsePrice(raw: unknown, currencyHint?: string | null): ParsedPrice | null {
  if (raw === null || raw === undefined) return null;

  // schema.org often gives a clean number already
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0
      ? { amount: round2(raw), currency: currencyHint?.toUpperCase() ?? null }
      : null;
  }
  if (typeof raw !== "string") return null;

  const text = raw.replace(/\u00a0|\u202f/g, " ").trim();
  if (!text) return null;

  const currency = detectCurrency(text, currencyHint);

  const numeric = text
    .replace(/[^\d.,\s]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!numeric || !/\d/.test(numeric)) return null;

  const hasComma = numeric.includes(",");
  const hasDot = numeric.includes(".");
  let normalised: string;

  if (hasComma && hasDot) {
    const decimalSep = numeric.lastIndexOf(",") > numeric.lastIndexOf(".") ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    normalised = numeric.split(groupSep).join("").replace(decimalSep, ".");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = numeric.split(sep);
    const [left, right] = parts;

    if (
      parts.length === 2 &&
      left !== undefined &&
      right !== undefined &&
      right.length >= 1 &&
      right.length <= 2
    ) {
      normalised = `${left}.${right}`;
    } else {
      normalised = parts.join("");
    }
  } else {
    normalised = numeric;
  }

  const amount = Number.parseFloat(normalised);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return null;
  return { amount: round2(amount), currency };
}

export function formatPrice(amount: number, currency: string | null): string {
  const body = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return currency ? `${body} ${currency}` : body;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
