// Must be an exact browser UA — Amazon serves a stripped, price-free page to
// anything else, even a browser string with a contact suffix appended.
// Self-identification goes in the X-Bot-Contact header instead.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const BOT_CONTACT_HEADER = "https://asifur.dev (PriceWatchBot; contact via Telegram)";

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /^metadata\.google\.internal$/i,
];

const ALLOWED_PORTS = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {}

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6
  if (/^\d+$/.test(host)) return true; // decimal, e.g. 2130706433
  if (/^0x[0-9a-f]+$/i.test(host)) return true; // hex
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true; // dotted quad
  if (/^0\d+(\.\d+)*$/.test(host)) return true; // octal-ish
  return false;
}

export function assertSafeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https links are supported.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError("Only standard web ports are supported.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || isIpLiteral(host)) {
    throw new UnsafeUrlError("Direct IP addresses aren't supported.");
  }
  if (!host.includes(".")) {
    throw new UnsafeUrlError("That hostname doesn't look public.");
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new UnsafeUrlError("That hostname isn't allowed.");
  }
  return url;
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  html: string;
  truncated: boolean;
}

interface RawFetch {
  finalUrl: URL;
  response: Response;
}

async function fetchWithRedirects(
  rawUrl: string,
  opts: { timeoutMs?: number; userAgent?: string; accept?: string },
): Promise<RawFetch> {
  let current = assertSafeUrl(rawUrl);
  let response: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        "user-agent": opts.userAgent ?? USER_AGENT,
        "x-bot-contact": BOT_CONTACT_HEADER,
        accept: opts.accept ?? "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;

      current = assertSafeUrl(new URL(location, current).toString());
      continue;
    }
    break;
  }

  if (!response) throw new UnsafeUrlError("Too many redirects.");
  return { finalUrl: current, response };
}

export async function fetchPage(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; userAgent?: string },
): Promise<FetchedPage> {
  const { finalUrl, response } = await fetchWithRedirects(rawUrl, opts);

  const type = response.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
    return {
      finalUrl: finalUrl.toString(),
      status: response.status,
      html: "",
      truncated: false,
    };
  }

  const { text, truncated } = await readCapped(response, opts.maxBytes);
  return {
    finalUrl: finalUrl.toString(),
    status: response.status,
    html: text,
    truncated,
  };
}

// Same SSRF guard/redirect handling as fetchPage, but allows JSON responses
// fetchPage's HTML-only gate would reject. Returns null rather than throwing.
export async function fetchJson<T>(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number },
): Promise<T | null> {
  let response: Response;
  try {
    ({ response } = await fetchWithRedirects(rawUrl, { ...opts, accept: "application/json" }));
  } catch {
    return null;
  }
  if (response.status !== 200) return null;

  const type = response.headers.get("content-type") ?? "";
  if (type && !/application\/json/i.test(type)) return null;

  const { text, truncated } = await readCapped(response, opts.maxBytes);
  if (truncated || !text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function readCapped(res: Response, maxBytes: number) {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { text: chunks.join(""), truncated };
}
