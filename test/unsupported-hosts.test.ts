import { describe, expect, it } from "bun:test";
import { findUnsupportedHost } from "../src/lib/unsupported-hosts";

describe("findUnsupportedHost", () => {
  it("flags Walmart and its subdomains", () => {
    expect(findUnsupportedHost("walmart.com")?.name).toBe("Walmart");
    expect(findUnsupportedHost("www.walmart.com")?.name).toBe("Walmart");
  });

  it("flags Taobao", () => {
    expect(findUnsupportedHost("item.taobao.com")?.name).toBe("Taobao");
  });

  it("doesn't flag supported sites or a lookalike domain", () => {
    expect(findUnsupportedHost("amazon.com")).toBeNull();
    expect(findUnsupportedHost("bikroy.com")).toBeNull();
    // must not match "notwalmart.com" via a naive substring check
    expect(findUnsupportedHost("notwalmart.com")).toBeNull();
  });
});
