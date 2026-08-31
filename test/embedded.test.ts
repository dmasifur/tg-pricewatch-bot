import { describe, expect, it } from "bun:test";
import { findEmbeddedPrice } from "../src/lib/embedded";

const load = (name: string) => Bun.file(`${import.meta.dir}/fixtures/live/${name}`).text();

describe("findEmbeddedPrice — generic key-pattern scan", () => {
  it("reads Amazon's priceAmount from a hidden data-island div (not a <script>)", () => {
    const html =
      '<div class="a-section aok-hidden twister-plus-buying-options-price-data">' +
      '{"desktop_buybox_group_1":[{"displayPrice":"$39.99","priceAmount":39.99,"currencySymbol":"$"}]}' +
      "</div>";
    const result = findEmbeddedPrice([html]);
    expect(result?.price.amount).toBe(39.99);
    expect(result?.price.currency).toBe("USD");
    expect(result?.source).toBe("embedded");
  });

  it("reads Daraz's pdt_price through backslash-escaped quotes", () => {
    const script = 'var pdpTrackingData = "{\\"pdt_price\\":\\"৳ 1,000\\",\\"other\\":\\"x\\"}";';
    const result = findEmbeddedPrice([script]);
    expect(result?.price.amount).toBe(1000);
    expect(result?.price.currency).toBe("BDT");
  });

  it("ignores a bare 'price' key (too generic, reserved for jsonld/meta stages)", () => {
    const script = '<script>var x = {"price": 12.5};</script>';
    expect(findEmbeddedPrice([script])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findEmbeddedPrice(["var x = 1;", "<div>hello</div>"])).toBeNull();
  });

  it("tries earlier scripts before falling through to a whole-page scan", () => {
    const result = findEmbeddedPrice(["no price here", 'x = {"salePrice": "24.00"};']);
    expect(result?.price.amount).toBe(24);
  });
});

describe("findEmbeddedPrice — framework state blobs", () => {
  it("walks a __NEXT_DATA__ blob for a schema.org Product", () => {
    const script =
      'window.__NEXT_DATA__ = {"props":{"product":{"@type":"Product","name":"Widget",' +
      '"offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD"}}}};';
    const result = findEmbeddedPrice([script]);
    expect(result?.price.amount).toBe(19.99);
    expect(result?.price.currency).toBe("USD");
  });

  it("doesn't let an unrelated earlier '=' in the page break the state-blob scan", () => {
    const html =
      '<script>var unrelated = "foo=bar";</script>' +
      '<script>window.__NEXT_DATA__ = {"@type":"Product","offers":{"price":5,"priceCurrency":"EUR"}};</script>';
    const result = findEmbeddedPrice([html]);
    expect(result?.price.amount).toBe(5);
    expect(result?.price.currency).toBe("EUR");
  });
});

describe("findEmbeddedPrice — real captured pages", () => {
  it("resolves Amazon's live price from the full page HTML", async () => {
    const html = await load("amazon-B0H2VN7622.html");
    const result = findEmbeddedPrice([html]);
    expect(result?.price.amount).toBe(39.99);
    expect(result?.price.currency).toBe("USD");
  });

  it("resolves Daraz's live price from the full page HTML", async () => {
    const html = await load("www-daraz-com-bd-1788200683959.html");
    const result = findEmbeddedPrice([html]);
    expect(result?.price.amount).toBe(1000);
    expect(result?.price.currency).toBe("BDT");
  });
});
