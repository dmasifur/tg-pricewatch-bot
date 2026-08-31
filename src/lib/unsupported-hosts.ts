// Sites confirmed to return a bot-wall with no recoverable price at all —
// named up front instead of dead-ending in the generic failure message.
export interface UnsupportedHost {
  name: string;
  reason: string;
}

const UNSUPPORTED_HOSTS: Record<string, UnsupportedHost> = {
  "walmart.com": { name: "Walmart", reason: "blocks automated price checks" },
  "taobao.com": { name: "Taobao", reason: "requires a logged-in browser session" },
};

export function findUnsupportedHost(hostname: string): UnsupportedHost | null {
  const host = hostname.toLowerCase();
  for (const [domain, info] of Object.entries(UNSUPPORTED_HOSTS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return info;
  }
  return null;
}
