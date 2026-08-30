import { describe, expect, it } from "vitest";
import { today } from "../src/lib/ops";

describe("today", () => {
  it("returns a UTC date key", () => {
    expect(today(new Date("2026-08-30T23:59:59Z"))).toBe("2026-08-30");
  });

  it("rolls over at UTC midnight, not local", () => {
    expect(today(new Date("2026-08-31T00:00:01Z"))).toBe("2026-08-31");
  });
});
