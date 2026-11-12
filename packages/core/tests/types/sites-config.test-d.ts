import { describe, expectTypeOf, it } from "vitest";

import type {
	EmDashConfig,
	EmDashSiteConfig,
	EmDashSiteOptions,
} from "../../src/astro/integration/runtime.js";
import { memoryCache } from "../../src/astro/object-cache/adapters.js";
import { local } from "../../src/astro/storage/adapters.js";
import { sqlite } from "../../src/db/adapters.js";

describe("EmDashConfig sites", () => {
	it("accepts optional per-site configurations alongside root admin database and storage", () => {
		const singleSite: EmDashConfig = {
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
		};

		const multiSite: EmDashConfig = {
			database: sqlite({ url: "file:./admin.db" }),
			storage: local({ directory: "./admin-uploads", baseUrl: "/_emdash/api/media/file" }),
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: sqlite({ url: "file:./orange.db" }),
					storage: local({ directory: "./orange-uploads", baseUrl: "/_emdash/api/media/file" }),
					objectCache: memoryCache(),
					mcp: false,
					migrations: { runtime: "auto" },
					images: true,
					maxUploadSize: 50 * 1024 * 1024,
					imagePlaceholders: true,
					siteUrl: "https://orange.example.com",
					mediaProviders: [],
				},
				{
					id: "purple",
					name: "Purple",
					database: sqlite({ url: "file:./purple.db" }),
				},
			],
		};

		expectTypeOf(singleSite.sites).toEqualTypeOf<EmDashSiteConfig[] | undefined>();
		expectTypeOf(multiSite.sites).toEqualTypeOf<EmDashSiteConfig[] | undefined>();
	});

	it("limits site entries to id, name, plus site-specific EmDashSiteOptions", () => {
		expectTypeOf<Exclude<keyof EmDashSiteConfig, "id" | "name">>().toEqualTypeOf<
			keyof EmDashSiteOptions
		>();

		// @ts-expect-error -- site entries must configure a database
		const missingDatabase: EmDashSiteConfig = {
			id: "orange",
			name: "Orange",
		};

		// @ts-expect-error -- site entries must configure a display name
		const missingName: EmDashSiteConfig = {
			id: "orange",
			database: sqlite({ url: "file:./orange.db" }),
		};

		const withRootOnlyProp: EmDashSiteConfig = {
			id: "orange",
			name: "Orange",
			database: sqlite({ url: "file:./orange.db" }),
			// @ts-expect-error -- root-only options are not valid on a site entry
			admin: { siteName: "Not per-site" },
		};

		expectTypeOf(missingDatabase).not.toBeNever();
		expectTypeOf(missingName).not.toBeNever();
		expectTypeOf(withRootOnlyProp).not.toBeNever();
	});
});
