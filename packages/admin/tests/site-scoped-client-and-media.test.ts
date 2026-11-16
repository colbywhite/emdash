import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "../src/lib/api/client.js";
import {
	getMediaPreviewUrl,
	getMediaThumbnailUrl,
	localMediaFileUrl,
} from "../src/lib/media-utils.js";

describe("site-scoped apiFetch and media URL helpers", () => {
	const originalPath = window.location.pathname + window.location.search + window.location.hash;

	afterEach(() => {
		window.history.replaceState(null, "", originalPath);
		vi.unstubAllGlobals();
	});

	it("does not attach X-EmDash-Site when at root /_emdash/admin", async () => {
		window.history.replaceState(null, "", "/_emdash/admin");
		const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await apiFetch("/_emdash/api/manifest");

		const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
		expect(headers.get("X-EmDash-Request")).toBe("1");
		expect(headers.get("X-EmDash-Site")).toBeNull();
	});

	it("attaches X-EmDash-Site on site-scoped endpoints and omits it on root/auth endpoints", async () => {
		window.history.replaceState(null, "", "/_emdash/admin/sites/orange/content/pages");
		const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const siteScopedUrls = [
			"/_emdash/api/manifest",
			"/_emdash/api/content/pages",
			"/_emdash/api/media?limit=20",
			"/_emdash/api/settings",
			"/_emdash/api/admin/multisite-info",
			"/_emdash/api/plugins/my-plugin/options",
		];

		for (const url of siteScopedUrls) {
			await apiFetch(url);
			const headers = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers);
			expect(headers.get("X-EmDash-Site"), url).toBe("orange");
		}

		const nonSiteScopedUrls = [
			"/_emdash/api/auth/me",
			"/_emdash/api/auth/mode",
			"/_emdash/api/setup/status",
			"/_emdash/api/oauth/token",
			"/_emdash/api/admin/users",
			"/_emdash/api/admin/api-tokens",
			"/_emdash/api/admin/oauth-clients",
			"/_emdash/api/admin/allowed-domains",
			"/_emdash/api/admin/themes/marketplace",
			"/_emdash/api/admin/core-update",
			"/_emdash/api/sites/purple/content/pages",
			"https://other.example.com/_emdash/api/content/pages",
		];

		for (const url of nonSiteScopedUrls) {
			await apiFetch(url);
			const headers = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers);
			expect(headers.get("X-EmDash-Site"), url).toBeNull();
		}

		await apiFetch("/_emdash/api/content/pages", {
			headers: { "X-EmDash-Site": "purple" },
		});
		const explicitHeaders = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers);
		expect(explicitHeaders.get("X-EmDash-Site")).toBe("purple");
	});

	it("emits site-scoped local media URLs and preserves preview/thumbnail rewriting when a site is active", () => {
		expect(localMediaFileUrl("hero.png")).toBe("/_emdash/api/media/file/hero.png");

		window.history.replaceState(null, "", "/_emdash/admin/sites/orange/media");
		expect(localMediaFileUrl("hero.png")).toBe("/_emdash/api/sites/orange/media/file/hero.png");
		expect(localMediaFileUrl("2026/08/photo?.jpg")).toBe(
			"/_emdash/api/sites/orange/media/file/2026/08/photo%3F.jpg",
		);
		expect(localMediaFileUrl("hero.png", "purple")).toBe(
			"/_emdash/api/sites/purple/media/file/hero.png",
		);
		expect(localMediaFileUrl("hero.png", null)).toBe("/_emdash/api/media/file/hero.png");

		const siteMediaUrl = "/_emdash/api/sites/orange/media/file/hero.png";
		expect(getMediaPreviewUrl(siteMediaUrl, "hash123")).toBe(
			"/_emdash/api/sites/orange/media/file/hero.png?_emdash_media=hash123",
		);
		const thumbUrl = getMediaThumbnailUrl(siteMediaUrl, "image/png", 400, "hash123");
		expect(thumbUrl).toMatch(/^\/_image\?/);
		const params = new URLSearchParams(thumbUrl.slice("/_image?".length));
		expect(params.get("href")).toBe(
			`${window.location.origin}/_emdash/api/sites/orange/media/file/hero.png?_emdash_media=hash123`,
		);
	});
});
