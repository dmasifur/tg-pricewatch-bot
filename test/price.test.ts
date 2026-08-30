import { describe, expect, it } from "vitest";
import { detectCurrency, formatPrice, parsePrice } from "../src/lib/price";

describe("parsePrice", () => {
	const cases: Array<[string, number | null, string | null]> = [
		["$1,299.00", 1299, "USD"],
		["1.299,00 €", 1299, "EUR"],
		["USD 1299", 1299, "USD"],
		["£49.99", 49.99, "GBP"],
		["1 299,00 zł", 1299, "PLN"],
		["R$ 1.234,56", 1234.56, "BRL"],
		["¥12,800", 12800, "JPY"],
		["₹1,49,900", 149900, "INR"],
		["1.500", 1500, null],
		["1,5", 1.5, null],
		["0.99", 0.99, null],
		["  49,99  EUR ", 49.99, "EUR"],
		["Price: 79.00 USD", 79, "USD"],
		["A$ 2,199.95", 2199.95, "AUD"],
		["12,345,678.90", 12345678.9, null],
		["free", null, null],
		["", null, null],
		["--", null, null],
	];

	for (const [input, expected, currency] of cases) {
		it(`parses ${JSON.stringify(input)}`, () => {
			const result = parsePrice(input);
			if (expected === null) {
				expect(result).toBeNull();
			} else {
				expect(result?.amount).toBe(expected);
				expect(result?.currency).toBe(currency);
			}
		});
	}

	it("accepts numeric JSON-LD values", () => {
		expect(parsePrice(24.5, "usd")).toEqual({ amount: 24.5, currency: "USD" });
	});

	it("prefers an explicit priceCurrency hint", () => {
		expect(parsePrice("$100", "CAD")?.currency).toBe("CAD");
	});

	it("rejects absurd magnitudes and negatives", () => {
		expect(parsePrice("-5.00")).toEqual({ amount: 5, currency: null }); // sign stripped by design
		expect(parsePrice("9".repeat(20))).toBeNull();
	});
});

describe("detectCurrency", () => {
	it("prefers ISO codes over symbols", () => {
		expect(detectCurrency("$50 USD")).toBe("USD");
	});
	it("returns null when nothing is present", () => {
		expect(detectCurrency("1299")).toBeNull();
	});
});

describe("formatPrice", () => {
	it("groups thousands", () => {
		expect(formatPrice(1299, "USD")).toBe("1,299.00 USD");
	});
});
