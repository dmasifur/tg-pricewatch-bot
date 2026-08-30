import { describe, expect, it } from "vitest";
import { DEMO_CATALOGUE, pickDemoProduct } from "../src/lib/demo";

describe("pickDemoProduct", () => {
  it("returns a catalogue entry for any chat id", () => {
    for (const seed of [0, 1, 7, 99_999]) {
      expect(DEMO_CATALOGUE).toContain(pickDemoProduct(seed));
    }
  });

  it("is stable for the same seed", () => {
    expect(pickDemoProduct(42)).toBe(pickDemoProduct(42));
  });

  it("ships only https urls", () => {
    for (const product of DEMO_CATALOGUE) {
      expect(new URL(product.url).protocol).toBe("https:");
    }
  });
});
