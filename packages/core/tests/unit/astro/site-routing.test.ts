import { describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (fn: unknown) => fn,
}));

import { siteWriteFenceScope } from "../../../src/astro/middleware/media-usage-write-fence.js";
import {
	isSiteScopedApiPath,
	normalizeSiteApiPathname,
	parseAdminSitePath,
	parseSiteApiPath,
	resolveSiteForRequest,
} from "../../../src/astro/site-routing.js";
import { sqlite } from "../../../src/db/adapters.js";

const multiSiteConfig = {
	database: sqlite({ url: "file:./admin.db" }),
	sites: [
		{ id: "orange", name: "Orange site", database: sqlite({ url: "file:./orange.db" }) },
		{ id: "purple", name: "Purple site", database: sqlite({ url: "file:./purple.db" }) },
	],
};

describe("site-routing helpers", () => {
	it("parses admin site paths and leaves root admin paths un-scoped", () => {
		expect(parseAdminSitePath("/_emdash/admin/sites/orange")).toEqual({
			siteId: "orange",
			restPathname: "/_emdash/admin",
		});
		expect(parseAdminSitePath("/_emdash/admin/sites/orange/content/pages")).toEqual({
			siteId: "orange",
			restPathname: "/_emdash/admin/content/pages",
		});
		expect(parseAdminSitePath("/_emdash/admin")).toBeNull();
		expect(parseAdminSitePath("/_emdash/admin/settings")).toBeNull();
	});

	it("parses and normalizes site-prefixed API paths without misparsing domain-proof", () => {
		expect(parseSiteApiPath("/_emdash/api/sites/orange/manifest")).toEqual({
			siteId: "orange",
			normalizedPathname: "/_emdash/api/manifest",
		});
		expect(parseSiteApiPath("/_emdash/api/sites/orange/content/pages/123")).toEqual({
			siteId: "orange",
			normalizedPathname: "/_emdash/api/content/pages/123",
		});
		expect(parseSiteApiPath("/_emdash/api/site/domain-proof")).toBeNull();
		expect(normalizeSiteApiPathname("/_emdash/api/sites/purple/settings")).toBe(
			"/_emdash/api/settings",
		);
		expect(normalizeSiteApiPathname("/_emdash/api/site/domain-proof")).toBe(
			"/_emdash/api/site/domain-proof",
		);
	});

	it("classifies site-scoped vs root API routes", () => {
		expect(isSiteScopedApiPath("/_emdash/api/content/pages")).toBe(true);
		expect(isSiteScopedApiPath("/_emdash/api/settings")).toBe(true);
		expect(isSiteScopedApiPath("/_emdash/api/site/domain-proof")).toBe(true);
		expect(isSiteScopedApiPath("/_emdash/api/manifest")).toBe(false);
		expect(isSiteScopedApiPath("/_emdash/api/admin/multisite-info")).toBe(false);
		expect(isSiteScopedApiPath("/_emdash/api/auth/me")).toBe(false);
		expect(isSiteScopedApiPath("/_emdash/api/setup/status")).toBe(false);
	});

	it("resolves site from URL prefix or X-EmDash-Site header and rejects conflicts/unknowns/missing site", () => {
		const fromPath = resolveSiteForRequest(
			"/_emdash/api/sites/orange/manifest",
			null,
			multiSiteConfig,
		);
		expect(fromPath).toMatchObject({
			ok: true,
			site: { id: "orange", name: "Orange site" },
			rewrittenApiPathname: "/_emdash/api/manifest",
		});

		const fromHeader = resolveSiteForRequest("/_emdash/api/manifest", "purple", multiSiteConfig);
		expect(fromHeader).toMatchObject({
			ok: true,
			site: { id: "purple", name: "Purple site" },
		});
		expect("rewrittenApiPathname" in fromHeader && fromHeader.rewrittenApiPathname).toBeFalsy();

		const matchingBoth = resolveSiteForRequest(
			"/_emdash/api/sites/orange/content/pages",
			"orange",
			multiSiteConfig,
		);
		expect(matchingBoth).toMatchObject({
			ok: true,
			site: { id: "orange" },
			rewrittenApiPathname: "/_emdash/api/content/pages",
		});

		const conflict = resolveSiteForRequest(
			"/_emdash/api/sites/pink/content/pages",
			"orange",
			multiSiteConfig,
		);
		expect(conflict).toMatchObject({ ok: false, status: 400, code: "SITE_CONFLICT" });

		const unknownApi = resolveSiteForRequest(
			"/_emdash/api/sites/nope/manifest",
			null,
			multiSiteConfig,
		);
		expect(unknownApi).toMatchObject({ ok: false, status: 404, code: "SITE_NOT_FOUND" });

		const unknownAdmin = resolveSiteForRequest("/_emdash/admin/sites/nope", null, multiSiteConfig);
		expect(unknownAdmin).toMatchObject({ ok: false, status: 404, code: "SITE_NOT_FOUND" });

		const missingSite = resolveSiteForRequest("/_emdash/api/content/pages", null, multiSiteConfig);
		expect(missingSite).toMatchObject({ ok: false, status: 400, code: "SITE_REQUIRED" });

		const rootManifest = resolveSiteForRequest("/_emdash/api/manifest", null, multiSiteConfig);
		expect(rootManifest).toEqual({ ok: true });
	});

	it("resolves site from image href siteId", () => {
		const valid = resolveSiteForRequest("/_image", null, multiSiteConfig, "orange");
		expect(valid).toMatchObject({ ok: true, site: { id: "orange" } });

		const unknown = resolveSiteForRequest("/_image", null, multiSiteConfig, "nope");
		expect(unknown).toMatchObject({ ok: false, status: 404, code: "SITE_NOT_FOUND" });
	});

	it("applies write fence scope identically for site-prefixed API paths", () => {
		expect(siteWriteFenceScope("POST", "/_emdash/api/sites/orange/content/pages")).toEqual({
			transfer: true,
			mediaUsage: true,
			recordWrite: true,
		});
		expect(siteWriteFenceScope("POST", "/_emdash/api/sites/orange/admin/users")).toBeNull();
	});
});
