import { describe, expect, it } from "bun:test";
import { availabilityToBool, findProduct } from "../src/lib/jsonld";

const bare = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Widget",
  offers: {
    "@type": "Offer",
    price: "24.99",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
};

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BreadcrumbList" },
    {
      "@type": ["Product", "Thing"],
      name: "Graph Widget",
      offers: { price: 10, priceCurrency: "EUR" },
    },
  ],
};

const aggregate = {
  "@type": "Product",
  name: "Sized Widget",
  offers: {
    "@type": "AggregateOffer",
    lowPrice: "15.00",
    highPrice: "40.00",
    priceCurrency: "GBP",
  },
};

const multiOffer = {
  "@type": "Product",
  name: "Multi",
  offers: [
    { price: "30.00", priceCurrency: "USD" },
    { price: "19.50", priceCurrency: "USD" },
  ],
};

describe("findProduct", () => {
  it("reads a bare Product", () => {
    expect(findProduct(bare)).toMatchObject({
      name: "Widget",
      price: "24.99",
      currency: "USD",
      inStock: true,
    });
  });

  it("descends into @graph and array @type", () => {
    expect(findProduct(graph)).toMatchObject({
      name: "Graph Widget",
      price: 10,
      currency: "EUR",
    });
  });

  it("falls back to lowPrice on AggregateOffer", () => {
    expect(findProduct(aggregate)?.price).toBe("15.00");
  });

  it("picks the cheapest of several offers", () => {
    expect(findProduct(multiOffer)?.price).toBe("19.50");
  });

  it("handles a top-level array", () => {
    expect(findProduct([{ "@type": "Organization" }, bare])?.name).toBe("Widget");
  });

  it("skips a Product with no price and keeps searching", () => {
    const doc = [{ "@type": "Product", name: "No price" }, bare];
    expect(findProduct(doc)?.name).toBe("Widget");
  });

  it("returns null for non-product documents", () => {
    expect(findProduct({ "@type": "Article", headline: "hi" })).toBeNull();
  });

  it("survives deeply nested junk without blowing the node budget", () => {
    let deep: unknown = bare;
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => findProduct(deep)).not.toThrow();
  });
});

describe("availabilityToBool", () => {
  it.each([
    ["https://schema.org/InStock", true],
    ["OutOfStock", false],
    ["http://schema.org/SoldOut", false],
    ["BackOrder", undefined],
  ])("maps %s", (input, expected) => {
    expect(availabilityToBool(input as string)).toBe(expected);
  });
});
