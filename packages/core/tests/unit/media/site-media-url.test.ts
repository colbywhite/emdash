import { describe, expect, it } from "vitest";

import { sqlite } from "../../../src/db/adapters.js";
import { matchInternalMediaKey, matchInternalMediaRef } from "../../../src/media/image-endpoint.js";
import {
	buildRenderMediaUrl,
	localMediaFileUrl,
	resolvePublicMediaUrl,
	storageKeyFromLocalMediaFileUrl,
} from "../../../src/media/url.js";
import { getActiveSiteKey, runWithContext } from "../../../src/request-context.js";

const siteCtx = {
	editMode: false,
	site: {
		id: "orange",
		name: "Orange",
		config: {
			id: "orange",
			name: "Orange",
			database: sqlite({ url: "file:./orange.db" }),
		},
	},
};

describe("site-scoped media URLs and active site key", () => {
	it("returns 'default' when no site is active and site.id when active", () => {
		expect(getActiveSiteKey()).toBe("default");
		runWithContext(siteCtx, () => {
			expect(getActiveSiteKey()).toBe("orange");
		});
	});

	it("parses site-scoped internal media URLs in matchInternalMediaRef and matchInternalMediaKey", () => {
		expect(matchInternalMediaRef("/_emdash/api/sites/orange/media/file/abc123.png")).toEqual({
			siteId: "orange",
			key: "abc123.png",
		});
		expect(
			matchInternalMediaKey("https://example.com/_emdash/api/sites/purple/media/file/img.webp"),
		).toBe("img.webp");
		expect(matchInternalMediaRef("/_emdash/api/sites/orange/media/file/../secret")).toBeNull();
	});

	it("emits site-scoped media URLs when siteId is set without CDN publicUrl, and preserves CDN publicUrl", () => {
		expect(localMediaFileUrl("hero.png", "orange")).toBe(
			"/_emdash/api/sites/orange/media/file/hero.png",
		);
		expect(storageKeyFromLocalMediaFileUrl("/_emdash/api/sites/orange/media/file/hero.png")).toBe(
			"hero.png",
		);
		expect(
			resolvePublicMediaUrl(
				{ getPublicUrl: (k: string) => `/_emdash/api/media/file/${k}` } as never,
				"hero.png",
				"orange",
			),
		).toBe("/_emdash/api/sites/orange/media/file/hero.png");
		expect(
			resolvePublicMediaUrl(
				{ getPublicUrl: (k: string) => `https://cdn.orange.example.com/${k}` } as never,
				"hero.png",
				"orange",
			),
		).toBe("https://cdn.orange.example.com/hero.png");
		expect(
			buildRenderMediaUrl(
				(key) => `/_emdash/api/sites/orange/media/file/${key}`,
				{
					url: "/_emdash/api/sites/orange/media/file/hero.png",
				},
				"orange",
			),
		).toBe("/_emdash/api/sites/orange/media/file/hero.png");
	});
});
