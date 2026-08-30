import { describe, expect, it } from "bun:test";
import { type DecisionInput, decideAlert } from "../src/lib/notify";

const NOW = Date.parse("2026-08-30T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    notifyMode: "any_drop",
    targetPrice: null,
    previousPrice: 100,
    newPrice: 90,
    previousInStock: true,
    newInStock: true,
    lastAlert: null,
    now: NOW,
    ...overrides,
  };
}

describe("decideAlert — any_drop", () => {
  it("alerts on a meaningful drop", () => {
    expect(decideAlert(input())?.kind).toBe("drop");
  });

  it("ignores sub-1% noise", () => {
    expect(decideAlert(input({ newPrice: 99.5 }))).toBeNull();
  });

  it("ignores a price increase", () => {
    expect(decideAlert(input({ newPrice: 120 }))).toBeNull();
  });

  it("stays silent on the first ever check", () => {
    expect(decideAlert(input({ previousPrice: null }))).toBeNull();
  });
});

describe("decideAlert — target mode", () => {
  const target = input({ notifyMode: "target", targetPrice: 80 });

  it("stays silent above the target", () => {
    expect(decideAlert({ ...target, newPrice: 85 })).toBeNull();
  });

  it("alerts at or below the target", () => {
    expect(decideAlert({ ...target, newPrice: 80 })?.kind).toBe("target");
  });

  it("alerts even when the price rose, if still under target", () => {
    expect(decideAlert({ ...target, previousPrice: 70, newPrice: 79 })?.kind).toBe("target");
  });
});

describe("decideAlert — cooldown and stock", () => {
  it("suppresses a repeat at the same price inside the window", () => {
    const result = decideAlert(
      input({
        previousPrice: 90,
        newPrice: 90,
        lastAlert: { kind: "drop", price: 90, sentAt: NOW - HOUR },
      }),
    );
    expect(result).toBeNull();
  });

  it("always alerts on a new low, cooldown or not", () => {
    const result = decideAlert(
      input({ newPrice: 85, lastAlert: { kind: "drop", price: 90, sentAt: NOW - HOUR } }),
    );
    expect(result?.kind).toBe("drop");
  });

  it("alerts again once the cooldown has passed", () => {
    const result = decideAlert(
      input({
        previousPrice: 95,
        newPrice: 90,
        lastAlert: { kind: "drop", price: 90, sentAt: NOW - 25 * HOUR },
      }),
    );
    expect(result?.kind).toBe("drop");
  });

  it("fires a restock alert on the false → true transition", () => {
    const result = decideAlert(input({ previousInStock: false, newInStock: true, newPrice: 100 }));
    expect(result?.kind).toBe("restock");
  });

  it("never alerts on a price while out of stock", () => {
    expect(decideAlert(input({ newInStock: false }))).toBeNull();
  });

  it("rejects nonsense prices", () => {
    expect(decideAlert(input({ newPrice: 0 }))).toBeNull();
    expect(decideAlert(input({ newPrice: Number.NaN }))).toBeNull();
  });
});
