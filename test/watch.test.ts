import { describe, expect, it } from "bun:test";
import { summaryText } from "../src/handlers/watch";

describe("summaryText", () => {
  it("shows an any-drop alert line by default", () => {
    const text = summaryText({
      title: "Widget",
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "any_drop",
      intervalMinutes: 360,
    });
    expect(text).toContain("<b>Widget</b>");
    expect(text).toContain("24.99 USD");
    expect(text).toContain("🔔 Alert on any price drop");
    expect(text).toContain("Checking every 6h");
  });

  it("shows the target price when in target mode", () => {
    const text = summaryText({
      title: "Widget",
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "target",
      targetPrice: "19.99 USD",
      intervalMinutes: 60,
    });
    expect(text).toContain("🎯 Alert when it hits <b>19.99 USD</b>");
    expect(text).toContain("Checking every 1h");
  });

  it("falls back to any-drop copy if target mode is set but no target price is known yet", () => {
    const text = summaryText({
      title: "Widget",
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "target",
      intervalMinutes: 360,
    });
    expect(text).toContain("🔔 Alert on any price drop");
  });

  it("falls back to the hostname when there's no title", () => {
    const text = summaryText({
      title: undefined,
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "any_drop",
      intervalMinutes: 360,
    });
    expect(text).toContain("<b>example.com</b>");
  });

  it("formats sub-hour intervals in minutes", () => {
    const text = summaryText({
      title: "Widget",
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "any_drop",
      intervalMinutes: 30,
    });
    expect(text).toContain("Checking every 30m");
  });

  it("escapes HTML in the title and price", () => {
    const text = summaryText({
      title: "<script>alert(1)</script>",
      host: "example.com",
      price: "24.99 USD",
      notifyMode: "any_drop",
      intervalMinutes: 360,
    });
    expect(text).not.toContain("<script>");
  });
});
