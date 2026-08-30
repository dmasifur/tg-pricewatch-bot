import { describe, expect, it } from "vitest";
import { percentChange, sparkline } from "../src/lib/history";

describe("sparkline", () => {
  it("returns an empty string for no data", () => {
    expect(sparkline([])).toBe("");
  });

  it("renders one glyph per point", () => {
    expect([...sparkline([1, 2, 3, 4])].length).toBe(4);
  });

  it("renders a flat line when every value is equal", () => {
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
  });

  it("puts the minimum at the bottom and the maximum at the top", () => {
    const rendered = sparkline([10, 20]);
    expect(rendered.startsWith("▁")).toBe(true);
    expect(rendered.endsWith("█")).toBe(true);
  });
});

describe("percentChange", () => {
  it("reports a fall as positive", () => {
    expect(percentChange(100, 75)).toBe(25);
  });

  it("reports a rise as negative", () => {
    expect(percentChange(100, 125)).toBe(-25);
  });

  it("guards against a zero baseline", () => {
    expect(percentChange(0, 10)).toBe(0);
  });
});
