import { describe, expect, it } from "bun:test";
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

describe("scanPage + resolve — real captured pages", () => {
  const loadLive = (name: string) => Bun.file(`${import.meta.dir}/fixtures/live/${name}`).text();

  it("Daraz: resolves via the embedded stage (price lives only in an inline tracking script)", async () => {
    const result = resolve(await scanPage(await loadLive("www-daraz-com-bd-1788200683959.html")));
    expect(result.source).toBe("embedded");
    expect(result.price?.amount).toBe(1000);
    expect(result.price?.currency).toBe("BDT");
  });

  it("Amazon: resolves via the embedded stage (price lives in a hidden data-island div, not JSON-LD/microdata)", async () => {
    const result = resolve(await scanPage(await loadLive("amazon-B0H2VN7622.html")));
    expect(result.source).toBe("embedded");
    expect(result.price?.amount).toBe(39.99);
    expect(result.price?.currency).toBe("USD");
  });

  it("Bikroy: resolves via microdata", async () => {
    const result = resolve(await scanPage(await loadLive("bikroy-com-1788200684592.html")));
    expect(result.source).toBe("microdata");
    expect(result.price?.amount).toBe(15500);
    expect(result.price?.currency).toBe("BDT");
  });

  it("Shopify (Allbirds): resolves via JSON-LD", async () => {
    const result = resolve(await scanPage(await loadLive("shopify-allbirds-flip-flop.html")));
    expect(result.source).toBe("jsonld");
    expect(result.price?.amount).toBe(50);
    expect(result.price?.currency).toBe("USD");
  });

  it("WooCommerce: resolves via og:price meta tags", async () => {
    const result = resolve(await scanPage(await loadLive("woocommerce-com-1788200689619.html")));
    expect(result.source).toBe("meta");
    expect(result.price?.amount).toBe(279);
    expect(result.price?.currency).toBe("USD");
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

  it("doesn't crash on inline SVG (self-closing foreign-content tags reject onEndTag)", async () => {
    const html =
      '<html><body><svg><path d="M0 0"/><circle r="1"/></svg><p id="price">$9.99</p></body></html>';
    const candidates = await scanCandidates(html);
    expect(candidates[0]?.text).toBe("$9.99");
  });

  it("still ranks correctly around a mix of nested and malformed markup", async () => {
    const html =
      '<div><svg><path/></svg><span class="price">$12.00</span><br><p>Shipping $2</p></div>';
    const candidates = await scanCandidates(html);
    expect(candidates[0]?.text).toBe("$12.00");
  });
});

describe("scanCandidates — ranking against real cross-sell noise", () => {
  const loadLive = (name: string) => Bun.file(`${import.meta.dir}/fixtures/live/${name}`).text();

  it("ranks Amazon's real buy-box price above a 'value pick' bundle upsell and a cross-sell carousel", async () => {
    const candidates = await scanCandidates(await loadLive("amazon-B0H2VN7622.html"));
    expect(candidates[0]?.text).toBe("$39.99");
    expect(candidates[0]?.selector).not.toContain("value-pick");
  });
});
