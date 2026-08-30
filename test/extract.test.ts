import { describe, expect, it } from "vitest";
import { resolve, scanCandidates, scanPage } from "../src/lib/extract";

const load = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

describe("scanPage + resolve — JSON-LD", () => {
  it("reads a plain Product offer", async () => {
    const result = resolve(await scanPage(await load("jsonld-basic.html")));
    expect(result.source).toBe("jsonld");
    expect(result.price?.amount).toBe(24.99);
    expect(result.price?.currency).toBe("USD");
    expect(result.title).toBe("Acme Widget");
    expect(result.inStock).toBe(true);
  });

  it("skips a malformed block, descends @graph, and takes the cheapest offer", async () => {
    const result = resolve(await scanPage(await load("jsonld-graph-broken.html")));
    expect(result.source).toBe("jsonld");
    expect(result.price?.amount).toBe(19.5);
    expect(result.price?.currency).toBe("EUR");
  });
});

describe("scanPage + resolve — meta fallback", () => {
  it("falls back to product: meta tags with European separators", async () => {
    const result = resolve(await scanPage(await load("meta-only.html")));
    expect(result.source).toBe("meta");
    expect(result.price?.amount).toBe(1299);
    expect(result.price?.currency).toBe("EUR");
    expect(result.inStock).toBe(true);
  });
});

describe("scanPage + resolve — no structured data", () => {
  it("returns none but still recovers a title", async () => {
    const result = resolve(await scanPage(await load("no-structured-data.html")));
    expect(result.source).toBe("none");
    expect(result.price).toBeNull();
    expect(result.title).toBe("Bare Store");
  });

  it("prefers a stored selector over everything else", async () => {
    const signals = await scanPage(
      await load("no-structured-data.html"),
      "#product-price .price-current",
    );
    const result = resolve(signals);
    expect(result.source).toBe("selector");
    expect(result.price?.amount).toBe(89.95);
  });

  it("ignores a stale selector that matches nothing", async () => {
    const signals = await scanPage(await load("jsonld-basic.html"), ".gone-in-a-redesign");
    expect(resolve(signals).source).toBe("jsonld");
  });
});

describe("scanCandidates", () => {
  it("ranks a price-classed node above cart and shipping noise", async () => {
    const candidates = await scanCandidates(await load("no-structured-data.html"));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.text).toContain("89.95");
    expect(candidates[0]?.selector).toContain("price");
  });

  it("caps the list at five", async () => {
    expect(
      (await scanCandidates(await load("no-structured-data.html"))).length,
    ).toBeLessThanOrEqual(5);
  });

  it("survives a page with no prices at all", async () => {
    expect(await scanCandidates("<html><body><p>nothing here</p></body></html>")).toEqual([]);
  });
});
