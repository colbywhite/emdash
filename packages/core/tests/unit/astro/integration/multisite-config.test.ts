import { describe, expect, it } from "vitest";

import { memoryCache, s3 } from "../../../../src/astro/index.js";
import {
	buildAllImageRemotePatterns,
	buildSerializableConfig,
	resolveEmDashConfig,
	resolveSiteConfig,
} from "../../../../src/astro/integration/index.js";
import { DEFAULT_STORAGE } from "../../../../src/astro/integration/runtime.js";
import { sqlite } from "../../../../src/db/adapters.js";

describe("multi-site config inheritance and integration helpers", () => {
	it("resolveSiteConfig inherits defaults and sets DEFAULT_STORAGE only when omitted", () => {
		const sharedCache = memoryCache();
		const customStorage = s3({ publicUrl: "https://cdn.orange.example.com/media" });
		const baseConfig = {
			database: sqlite({ url: "file:./admin.db" }),
			migrations: { runtime: "check" as const },
			objectCache: sharedCache,
			images: false,
			mcp: false,
			maxUploadSize: 12_345,
			imagePlaceholders: false,
			mediaProviders: [
				{
					id: "custom",
					name: "Custom",
					entrypoint: "custom-provider",
					config: {},
				},
			],
		};

		const orange = resolveSiteConfig(baseConfig, {
			id: "orange",
			name: "Orange",
			database: sqlite({ url: "file:./orange.db" }),
			storage: customStorage,
			mcp: true,
		});
		expect(orange.storage).toBe(customStorage);
		expect(orange.mcp).toBe(true);
		expect(orange.images).toBe(false);
		expect(orange.maxUploadSize).toBe(12_345);
		expect(orange.imagePlaceholders).toBe(false);
		expect(orange.objectCache).toBe(sharedCache);
		expect(orange.migrations).toEqual({ runtime: "check" });
		expect(orange.mediaProviders).toHaveLength(1);

		const purple = resolveSiteConfig(baseConfig, {
			id: "purple",
			name: "Purple",
			database: sqlite({ url: "file:./purple.db" }),
		});
		expect(purple.storage).toEqual(DEFAULT_STORAGE);
		expect(purple.mcp).toBe(false);
	});

	it("preserves site-level config and marks objectCacheEnabled when only a site sets objectCache", () => {
		const siteCache = memoryCache({ keyPrefix: "custom:" });
		const resolved = resolveEmDashConfig({
			database: sqlite({ url: "file:./admin.db" }),
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: sqlite({ url: "file:./orange.db" }),
					objectCache: siteCache,
					migrations: { runtime: "manual" },
					maxUploadSize: 1024,
					imagePlaceholders: false,
					siteUrl: "https://orange.example.com/path",
				},
			],
		});

		const serialized = buildSerializableConfig(resolved);
		expect(serialized.storage).toBeUndefined();
		expect(serialized.objectCacheEnabled).toBe(true);
		const sites = serialized.sites as Array<Record<string, unknown>>;
		expect(sites[0]).toMatchObject({
			id: "orange",
			objectCache: siteCache,
			migrations: { runtime: "manual" },
			maxUploadSize: 1024,
			imagePlaceholders: false,
			siteUrl: "https://orange.example.com",
		});
	});

	it("buildAllImageRemotePatterns includes per-site storage publicUrl and siteUrl patterns", () => {
		const patterns = buildAllImageRemotePatterns(
			{
				siteUrl: "https://admin.example.com",
				sites: [
					{
						id: "orange",
						name: "Orange",
						database: sqlite({ url: "file:./orange.db" }),
						storage: s3({ publicUrl: "https://cdn.orange.example.com/assets" }),
						siteUrl: "https://orange.example.com",
					},
					{
						id: "purple",
						name: "Purple",
						database: sqlite({ url: "file:./purple.db" }),
					},
				],
			},
			"build",
		);

		expect(patterns).toEqual(
			expect.arrayContaining([
				{ protocol: "https", hostname: "cdn.orange.example.com", pathname: "/assets/**" },
				{ hostname: "orange.example.com", pathname: "/_emdash/api/media/file/**" },
				{ hostname: "orange.example.com", pathname: "/_emdash/api/site/orange/media/file/**" },
				{ hostname: "admin.example.com", pathname: "/_emdash/api/media/file/**" },
				{ hostname: "admin.example.com", pathname: "/_emdash/api/site/purple/media/file/**" },
			]),
		);
	});
});
