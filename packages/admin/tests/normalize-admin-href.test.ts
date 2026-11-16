import { afterEach, describe, expect, it } from "vitest";

import { getAnchorHref, getSiteRouterEntry, normalizeAdminHref } from "../src/App";
import { getActiveAdminSiteId, getAdminBasepath, parseAdminSiteId } from "../src/lib/site-path";

describe("site-path helpers", () => {
	const originalPath = window.location.pathname + window.location.search + window.location.hash;

	afterEach(() => {
		window.history.replaceState(null, "", originalPath);
	});

	it("parses siteId from /_emdash/admin/sites/{siteId} paths", () => {
		expect(parseAdminSiteId("/_emdash/admin")).toBeNull();
		expect(parseAdminSiteId("/_emdash/admin/settings")).toBeNull();
		expect(parseAdminSiteId("/_emdash/admin/sites/")).toBeNull();
		expect(parseAdminSiteId("/_emdash/admin/sites/orange")).toBe("orange");
		expect(parseAdminSiteId("/_emdash/admin/sites/orange/content/pages")).toBe("orange");
	});

	it("reads active siteId from window.location.pathname and computes basepath", () => {
		expect(getActiveAdminSiteId()).toBeNull();
		expect(getAdminBasepath(null)).toBe("/_emdash/admin");

		window.history.replaceState(null, "", "/_emdash/admin/sites/purple/settings");
		expect(getActiveAdminSiteId()).toBe("purple");
		expect(getAdminBasepath("purple")).toBe("/_emdash/admin/sites/purple");
	});

	it("isolates QueryClient and Router basepath per siteId", () => {
		const rootEntry = getSiteRouterEntry(null);
		const orangeEntry = getSiteRouterEntry("orange");
		const purpleEntry = getSiteRouterEntry("purple");

		expect(orangeEntry).not.toBe(rootEntry);
		expect(purpleEntry).not.toBe(orangeEntry);
		expect(orangeEntry.queryClient).not.toBe(rootEntry.queryClient);
		expect(purpleEntry.queryClient).not.toBe(orangeEntry.queryClient);
		expect(rootEntry.router.basepath).toBe("/_emdash/admin");
		expect(orangeEntry.router.basepath).toBe("/_emdash/admin/sites/orange");
		expect(purpleEntry.router.basepath).toBe("/_emdash/admin/sites/purple");
		expect(getSiteRouterEntry("orange")).toBe(orangeEntry);
	});
});

describe("normalizeAdminHref", () => {
	it("strips admin basepath for admin SPA routes", () => {
		expect(normalizeAdminHref("/_emdash/admin", null)).toBe("/");
		expect(normalizeAdminHref("/_emdash/admin/settings", null)).toBe("/settings");
		expect(normalizeAdminHref("/_emdash/admin/content/posts", null)).toBe("/content/posts");
	});

	it("handles admin basepath with query string", () => {
		expect(normalizeAdminHref("/_emdash/admin?tab=settings", null)).toBe("/?tab=settings");
	});

	it("handles admin basepath with hash", () => {
		expect(normalizeAdminHref("/_emdash/admin#section", null)).toBe("/#section");
	});

	it("returns empty string for non-admin /_emdash/ paths and cross-basepath site links", () => {
		expect(normalizeAdminHref("/_emdash/api/auth/oauth/google", null)).toBe("");
		expect(normalizeAdminHref("/_emdash/api/auth/oauth/github", null)).toBe("");
		expect(normalizeAdminHref("/_emdash/api/auth/mode", null)).toBe("");
		expect(normalizeAdminHref("/_emdash/api/auth/passkey/options", null)).toBe("");
		expect(normalizeAdminHref("/_emdash/admin/sites/orange", null)).toBe("");
		expect(normalizeAdminHref("/_emdash/admin/sites/orange/settings", null)).toBe("");
	});

	it("handles site-scoped basepaths and leaves root/other-site links as full anchors", () => {
		expect(normalizeAdminHref("/_emdash/admin/sites/orange", "orange")).toBe("/");
		expect(normalizeAdminHref("/_emdash/admin/sites/orange/content/pages", "orange")).toBe(
			"/content/pages",
		);
		expect(normalizeAdminHref("/_emdash/admin/sites/orange?tab=general", "orange")).toBe(
			"/?tab=general",
		);
		expect(normalizeAdminHref("/_emdash/admin/sites/orange#top", "orange")).toBe("/#top");

		// Root admin and other sites must force full anchor navigation out of the site basepath
		expect(normalizeAdminHref("/_emdash/admin", "orange")).toBe("");
		expect(normalizeAdminHref("/_emdash/admin/sites/purple", "orange")).toBe("");
		expect(normalizeAdminHref("/_emdash/admin/sites/orange-2", "orange")).toBe("");
	});

	it("preserves admin-relative paths for TanStack Router", () => {
		// These paths do NOT start with /_emdash/ and should be passed through
		// unchanged so TanStack Router prepends the admin basepath.
		expect(normalizeAdminHref("/media", null)).toBe("/media");
		expect(normalizeAdminHref("/settings", null)).toBe("/settings");
		expect(normalizeAdminHref("/content/posts", "orange")).toBe("/content/posts");
		expect(normalizeAdminHref("/content/$collection", "orange")).toBe("/content/$collection");
	});

	it("preserves external URLs", () => {
		expect(normalizeAdminHref("https://example.com", null)).toBe("https://example.com");
	});

	it("preserves protocol-relative URLs", () => {
		expect(normalizeAdminHref("//example.com", null)).toBe("//example.com");
	});

	it("preserves mailto links", () => {
		expect(normalizeAdminHref("mailto:test@example.com", null)).toBe("mailto:test@example.com");
	});
});

describe("getAnchorHref", () => {
	it("prepends the active site basepath for router-relative anchor destinations", () => {
		expect(getAnchorHref("/media?folder=abc", "/media?folder=abc", null)).toBe(
			"/_emdash/admin/media?folder=abc",
		);
		expect(getAnchorHref("/media?folder=abc", "/media?folder=abc", "orange")).toBe(
			"/_emdash/admin/sites/orange/media?folder=abc",
		);
		expect(getAnchorHref("/?tab=general", "/?tab=general", "orange")).toBe(
			"/_emdash/admin/sites/orange?tab=general",
		);
		expect(getAnchorHref("/_emdash/admin?from=site", "", "orange")).toBe(
			"/_emdash/admin?from=site",
		);
		expect(getAnchorHref("/_emdash/admin/sites/purple?tab=seo", "", "orange")).toBe(
			"/_emdash/admin/sites/purple?tab=seo",
		);
	});
});
