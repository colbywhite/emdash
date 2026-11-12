import { describe, expect, it } from "vitest";

import { isValidUrlSlug } from "../../../src/utils/url-slug.js";

describe("isValidUrlSlug", () => {
	it.each(["a", "1", "orange", "pink-client", "us-east-1", "2026-news"])("accepts %j", (slug) => {
		expect(isValidUrlSlug(slug)).toBe(true);
	});

	it.each([
		"",
		"Orange",
		"orange_site",
		"orange site",
		"-orange",
		"orange-",
		"orange--site",
		"orange/site",
		"orange.com",
	])("rejects %j", (slug) => {
		expect(isValidUrlSlug(slug)).toBe(false);
	});

	it("rejects non-strings", () => {
		expect(isValidUrlSlug(undefined)).toBe(false);
		expect(isValidUrlSlug(null)).toBe(false);
		expect(isValidUrlSlug(42)).toBe(false);
	});
});
