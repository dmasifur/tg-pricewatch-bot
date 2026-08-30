import type { Env } from "../types";
import { getState, type StatsSnapshot, snapshot } from "./ops";

export const STALE_SWEEP_MS = 15 * 60 * 1000;

export interface HealthReport {
  ok: boolean;
  reasons: string[];
  stats: StatsSnapshot;
}

export function evaluate(stats: StatsSnapshot, hasWork: boolean): HealthReport {
  const reasons: string[] = [];

  if (stats.lastSweepAgoMs === null) {
    reasons.push("sweep has never run");
  } else if (stats.lastSweepAgoMs > STALE_SWEEP_MS) {
    reasons.push(`last sweep ${Math.round(stats.lastSweepAgoMs / 60_000)}m ago`);
  }

  const attempted = stats.checksToday + stats.failuresToday;
  if (hasWork && attempted >= 10 && stats.failuresToday / attempted > 0.5) {
    reasons.push(`${stats.failuresToday}/${attempted} checks failing today`);
  }

  return { ok: reasons.length === 0, reasons, stats };
}

export async function report(env: Env): Promise<HealthReport> {
  const stats = await snapshot(env);
  const sweep = await getState(env, "last_sweep");
  return evaluate(stats, sweep !== null && stats.activeWatches > 0);
}
