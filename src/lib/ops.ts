import type { Env } from "../types";

export type Counter = "checks_ok" | "checks_failed" | "alerts_sent" | "sweeps" | "budget_exhausted";

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function bump(env: Env, counters: Partial<Record<Counter, number>>): Promise<void> {
  const entries = Object.entries(counters).filter(
    (entry): entry is [Counter, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  if (entries.length === 0) return;

  const columns = entries.map(([name]) => name);
  const setClause = columns.map((name) => `${name} = ${name} + ?`).join(", ");
  const insertColumns = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const values = entries.map(([, count]) => count);

  await env.DB.prepare(
    `INSERT INTO ops_daily (day, ${insertColumns}) VALUES (?, ${placeholders})
     ON CONFLICT(day) DO UPDATE SET ${setClause}`,
  )
    .bind(today(), ...values, ...values)
    .run();
}

export async function setState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ops_state (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, new Date().toISOString())
    .run();
}

export async function getState(
  env: Env,
  key: string,
): Promise<{ value: string; updatedAt: number } | null> {
  const row = await env.DB.prepare("SELECT value, updated_at FROM ops_state WHERE key = ?")
    .bind(key)
    .first<{ value: string; updated_at: string }>();

  if (row === null) return null;
  return { value: row.value, updatedAt: Date.parse(row.updated_at) };
}

export async function alertAdmin(
  env: Env,
  key: string,
  message: string,
  cooldownMs = 6 * 60 * 60 * 1000,
): Promise<void> {
  const adminId = Number(env.ADMIN_CHAT_ID);
  if (!Number.isFinite(adminId) || adminId === 0) return;

  const last = await getState(env, `alert:${key}`);
  if (last !== null && Date.now() - last.updatedAt < cooldownMs) return;

  await setState(env, `alert:${key}`, message.slice(0, 200));

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: adminId,
      text: `⚠️ ${message}`,
      disable_web_page_preview: true,
    }),
  });
}

export async function clearAlert(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM ops_state WHERE key = ?").bind(`alert:${key}`).run();
}

export interface StatsSnapshot {
  activeWatches: number;
  totalUsers: number;
  alertsAllTime: number;
  resolutionRate: number | null;
  checksToday: number;
  failuresToday: number;
  lastSweepAgoMs: number | null;
  uptimeDays: number | null;
}

export async function snapshot(env: Env): Promise<StatsSnapshot> {
  const [watches, users, alerts, sources, daily] = await env.DB.batch<
    Record<string, number | string | null>
  >([
    env.DB.prepare("SELECT COUNT(*) AS n FROM watches WHERE status IN ('active','failing')"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind != 'expiring'"),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN selector_source IN ('jsonld','meta','microdata') THEN 1 ELSE 0 END) AS auto,
         COUNT(*) AS total
       FROM watches WHERE selector_source IS NOT NULL AND selector_source != 'demo'`,
    ),
    env.DB.prepare("SELECT checks_ok, checks_failed FROM ops_daily WHERE day = ?").bind(today()),
  ]);

  const auto = num(sources?.results?.[0]?.auto);
  const total = num(sources?.results?.[0]?.total);
  const lastSweep = await getState(env, "last_sweep");
  const firstSeen = await env.DB.prepare("SELECT MIN(first_seen) AS d FROM users").first<{
    d: string | null;
  }>();

  return {
    activeWatches: num(watches?.results?.[0]?.n),
    totalUsers: num(users?.results?.[0]?.n),
    alertsAllTime: num(alerts?.results?.[0]?.n),
    resolutionRate: total > 0 ? Math.round((auto / total) * 100) : null,
    checksToday: num(daily?.results?.[0]?.checks_ok),
    failuresToday: num(daily?.results?.[0]?.checks_failed),
    lastSweepAgoMs: lastSweep === null ? null : Date.now() - lastSweep.updatedAt,
    uptimeDays:
      firstSeen?.d == null ? null : Math.floor((Date.now() - Date.parse(firstSeen.d)) / 86_400_000),
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
