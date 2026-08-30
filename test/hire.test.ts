import { describe, expect, it } from "bun:test";
import { nextStep, promptFor, sanitise } from "../src/handlers/hire";

describe("hire flow", () => {
  it("runs exactly two questions", () => {
    expect(nextStep("use_case")).toBe("contact");
    expect(nextStep("contact")).toBe("done");
  });

  it("offers an exit in the first prompt", () => {
    expect(promptFor("use_case")).toContain("/cancel");
  });
});

describe("sanitise", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitise("  a\n\n  b  ", 50)).toBe("a b");
  });

  it("truncates to the cap", () => {
    expect(sanitise("x".repeat(200), 20).length).toBe(20);
  });

  it("yields an empty string for whitespace only", () => {
    expect(sanitise("   \n ", 50)).toBe("");
  });
});
