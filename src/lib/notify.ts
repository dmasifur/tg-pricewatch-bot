export type AlertKind = "drop" | "target" | "restock";

export interface LastAlert {
  kind: string;
  price: number | null;
  sentAt: number;
}

export interface DecisionInput {
  notifyMode: string;
  targetPrice: number | null;
  previousPrice: number | null;
  newPrice: number;
  previousInStock: boolean | null;
  newInStock: boolean | null;
  lastAlert: LastAlert | null;
  now: number;
}

export interface Decision {
  kind: AlertKind;
  previousPrice: number | null;
  newPrice: number;
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_DROP_RATIO = 0.01; // ignore sub-1% noise (rounding, currency wobble)
const MIN_DROP_ABSOLUTE = 0.01;

export function decideAlert(input: DecisionInput): Decision | null {
  const { newPrice, previousPrice, lastAlert, now } = input;

  if (!Number.isFinite(newPrice) || newPrice <= 0) return null;

  if (input.previousInStock === false && input.newInStock === true) {
    if (!suppressed(lastAlert, "restock", newPrice, now)) {
      return { kind: "restock", previousPrice, newPrice };
    }
  }

  if (input.newInStock === false) return null;

  if (input.notifyMode === "target") {
    const target = input.targetPrice;
    if (target === null || newPrice > target) return null;
    if (suppressed(lastAlert, "target", newPrice, now)) return null;
    return { kind: "target", previousPrice, newPrice };
  }

  if (previousPrice === null) return null;
  const drop = previousPrice - newPrice;
  if (drop < MIN_DROP_ABSOLUTE || drop / previousPrice < MIN_DROP_RATIO) return null;
  if (suppressed(lastAlert, "drop", newPrice, now)) return null;

  return { kind: "drop", previousPrice, newPrice };
}

function suppressed(
  last: LastAlert | null,
  kind: AlertKind,
  newPrice: number,
  now: number,
): boolean {
  if (last === null) return false;

  if (last.price !== null && newPrice < last.price) return false;
  if (last.kind !== kind) return false;
  return now - last.sentAt < COOLDOWN_MS;
}
