export interface ProductInfo {
  name?: string;
  price?: unknown;
  currency?: string;
  inStock?: boolean;
}

const MAX_DEPTH = 8;
const MAX_NODES = 600;

export function findProduct(root: unknown): ProductInfo | null {
  let budget = MAX_NODES;

  const walk = (node: unknown, depth: number): ProductInfo | null => {
    if (budget-- <= 0 || depth > MAX_DEPTH || node === null || typeof node !== "object")
      return null;

    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }

    const obj = node as Record<string, unknown>;

    if (isType(obj["@type"], "Product")) {
      const offer = pickOffer(obj.offers, depth);
      const info: ProductInfo = {
        name: asString(obj.name),
        price: offer?.price,
        currency: offer?.currency,
        inStock: offer?.inStock,
      };

      if (info.price !== undefined && info.price !== null && info.price !== "") return info;
    }

    for (const key of ["@graph", "mainEntity", "itemListElement", "hasPart"]) {
      if (key in obj) {
        const hit = walk(obj[key], depth + 1);
        if (hit) return hit;
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        const hit = walk(value, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };

  return walk(root, 0);
}

interface OfferInfo {
  price?: unknown;
  currency?: string;
  inStock?: boolean;
}

function pickOffer(offers: unknown, depth: number): OfferInfo | null {
  if (!offers || typeof offers !== "object" || depth > MAX_DEPTH) return null;

  if (Array.isArray(offers)) {
    // Multiple offers (sizes, sellers): take the lowest priced one.
    const parsed = offers
      .map((o) => pickOffer(o, depth + 1))
      .filter((o): o is OfferInfo => !!o && o.price !== undefined && o.price !== null);
    if (!parsed.length) return null;
    return parsed.reduce((lo, cur) => (numeric(cur.price) < numeric(lo.price) ? cur : lo));
  }

  const obj = offers as Record<string, unknown>;
  const price =
    obj.price ??
    obj.lowPrice ??
    (obj.priceSpecification && typeof obj.priceSpecification === "object"
      ? (obj.priceSpecification as Record<string, unknown>).price
      : undefined);

  if (price === undefined || price === null || price === "") return null;

  return {
    price,
    currency: asString(obj.priceCurrency)?.toUpperCase(),
    inStock: availabilityToBool(asString(obj.availability)),
  };
}

export function availabilityToBool(availability?: string): boolean | undefined {
  if (!availability) return undefined;
  const value = availability.toLowerCase();
  if (value.includes("outofstock") || value.includes("soldout") || value.includes("discontinued"))
    return false;
  if (
    value.includes("instock") ||
    value.includes("instoreonly") ||
    value.includes("limitedavailability")
  )
    return true;
  return undefined;
}

function isType(type: unknown, wanted: string): boolean {
  if (typeof type === "string") return type.toLowerCase().includes(wanted.toLowerCase());
  if (Array.isArray(type)) return type.some((t) => isType(t, wanted));
  return false;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

function numeric(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}
