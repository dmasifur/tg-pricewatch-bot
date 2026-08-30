import { describe, expect, it } from "bun:test";
import { evaluate, STALE_SWEEP_MS } from "../src/lib/health";
import type { StatsSnapshot } from "../src/lib/ops";

function stats(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    activeWatches: 12,
    totalUsers: 30,
    alertsAllTime: 40,
    resolutionRate: 84,
    checksToday: 100,
    failuresToday: 2,
    lastSweepAgoMs: 60_000,
    uptimeDays: 9,
    ...overrides,
  };
}

describe("evaluate", () => {
  it("is healthy on a recent sweep and a low failure rate", () => {
    expect(evaluate(stats(), true).ok).toBe(true);
  });

  it("fails when the sweep has gone stale", () => {
    const result = evaluate(stats({ lastSweepAgoMs: STALE_SWEEP_MS + 1 }), true);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("last sweep");
  });

  it("fails when the sweep has never run", () => {
    expect(evaluate(stats({ lastSweepAgoMs: null }), true).ok).toBe(false);
  });

  it("flags a majority failure rate", () => {
    expect(evaluate(stats({ checksToday: 4, failuresToday: 20 }), true).ok).toBe(false);
  });

  it("ignores the failure rate below the sample floor", () => {
    expect(evaluate(stats({ checksToday: 1, failuresToday: 3 }), true).ok).toBe(true);
  });

  it("ignores the failure rate on a bot with no work to do", () => {
    expect(evaluate(stats({ checksToday: 0, failuresToday: 40 }), false).ok).toBe(true);
  });
});
