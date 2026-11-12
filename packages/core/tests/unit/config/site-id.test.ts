import { describe, expect, it } from "vitest";

import { isBlacklistedSiteId, isValidSiteId, siteIdSchema } from "../../../src/config/site-id.js";

describe("site-id validation", () => {
	it("accepts non-blacklisted URL slugs", () => {
		expect(isValidSiteId("orange")).toBe(true);
		expect(isValidSiteId("pink-client-2")).toBe(true);
		expect(siteIdSchema.safeParse("orange").success).toBe(true);
	});

	it.each(["admin", "setup", "api", "auth", "login", "default", "sites", "well-known"])(
		"marks %j as blacklisted and invalid",
		(id) => {
			expect(isBlacklistedSiteId(id)).toBe(true);
			expect(isValidSiteId(id)).toBe(false);
			const result = siteIdSchema.safeParse(id);
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.message).toBe(`Site ID "${id}" is reserved`);
		},
	);

	it.each(["", "Orange", "orange_site", "-orange", "orange--site", "../admin"])(
		"rejects non-slug %j before reserved-word check",
		(id) => {
			expect(isValidSiteId(id)).toBe(false);
			const result = siteIdSchema.safeParse(id);
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.message).toContain("Site ID must be a URL-safe slug");
		},
	);
});
