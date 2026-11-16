import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"astro:content",
	() => ({
		getLiveEntry: vi.fn(async () => ({ entry: undefined })),
		getLiveCollection: vi.fn(async () => ({ entries: [] })),
	}),
	{ virtual: true },
);

import { GET as getOpenApi } from "../../src/astro/routes/api/openapi.json.js";
import {
	getBylineFieldDefs,
	resetBylineFieldDefsCacheForTests,
} from "../../src/bylines/field-defs-cache.js";
import { _clearSecretsCacheForTesting, resolveSecretsCached } from "../../src/config/secrets.js";
import { OptionsRepository } from "../../src/database/repositories/options.js";
import { RedirectRepository } from "../../src/database/repositories/redirect.js";
import { markRequestScopedDb } from "../../src/database/request-scoped.js";
import type { Database } from "../../src/database/types.js";
import {
	__setObjectCacheBackendForTests,
	cachedQuery,
	getLastContentWriteAt,
	invalidateCollectionCache,
} from "../../src/object-cache/index.js";
import { createObjectCache as createMemoryCache } from "../../src/object-cache/memory.js";
import { invalidateUrlPatternCache, resolveEmDashPath } from "../../src/query.js";
import { createRedirectSource } from "../../src/redirects/artifacts.js";
import { invalidateRedirectCache, loadCachedRedirects } from "../../src/redirects/cache.js";
import { createRequestMetrics, runWithContext } from "../../src/request-context.js";
import { BylineSchemaRegistry } from "../../src/schema/byline-registry.js";
import {
	filterToRegisteredCollections,
	primeRegisteredCollections,
	resetRegisteredCollectionsCache,
	resetRegisteredCollectionsCacheForTests,
} from "../../src/schema/collection-slugs-cache.js";
import { SchemaRegistry } from "../../src/schema/registry.js";
import {
	getSiteSettings,
	invalidateSiteSettingsCache,
	invalidateSiteSettingsSnapshot,
} from "../../src/settings/index.js";
import { getActiveSiteKey, getSiteScopedHolder } from "../../src/site-cache-key.js";
import {
	getTaxonomyDefs,
	invalidateTaxonomyDefsCache,
	resetTaxonomyDefsCacheForTests,
} from "../../src/taxonomies/index.js";
import { setupTestDatabase, teardownTestDatabase } from "../utils/test-db.js";

function siteCtx(id: string, db?: Kysely<Database>) {
	return {
		editMode: false,
		...(db ? { db } : {}),
		metrics: createRequestMetrics(0),
		site: {
			id,
			name: id,
			config: {
				id,
				name: id,
				database: { type: "sqlite" as const, entrypoint: "@test/db", config: {} },
				storage: { entrypoint: "@test/storage", config: {} },
			},
		},
	};
}

describe("site-scoped globalThis cache isolation", () => {
	let orangeDb: Kysely<Database>;
	let purpleDb: Kysely<Database>;

	beforeEach(async () => {
		orangeDb = await setupTestDatabase();
		purpleDb = await setupTestDatabase();
		_clearSecretsCacheForTesting();
		resetRegisteredCollectionsCacheForTests();
		resetTaxonomyDefsCacheForTests();
		resetBylineFieldDefsCacheForTests();
		__setObjectCacheBackendForTests(null);
		invalidateSiteSettingsSnapshot();
		runWithContext(siteCtx("orange", orangeDb), () => {
			invalidateSiteSettingsSnapshot();
			invalidateRedirectCache();
			invalidateUrlPatternCache();
		});
		runWithContext(siteCtx("purple", purpleDb), () => {
			invalidateSiteSettingsSnapshot();
			invalidateRedirectCache();
			invalidateUrlPatternCache();
		});
	});

	afterEach(async () => {
		_clearSecretsCacheForTesting();
		resetRegisteredCollectionsCacheForTests();
		resetTaxonomyDefsCacheForTests();
		resetBylineFieldDefsCacheForTests();
		__setObjectCacheBackendForTests(null);
		await teardownTestDatabase(orangeDb);
		await teardownTestDatabase(purpleDb);
	});

	it("getActiveSiteKey and getSiteScopedHolder partition values by site", () => {
		const sym = Symbol("test:site-holder");
		expect(getActiveSiteKey()).toBe("default");

		const orangeHolder = runWithContext(siteCtx("orange"), () =>
			getSiteScopedHolder(sym, () => ({ count: 0 })),
		);
		orangeHolder.count = 42;

		const purpleHolder = runWithContext(siteCtx("purple"), () =>
			getSiteScopedHolder(sym, () => ({ count: 0 })),
		);
		expect(purpleHolder.count).toBe(0);
		expect(
			runWithContext(siteCtx("orange"), () => getSiteScopedHolder(sym, () => ({ count: 0 }))).count,
		).toBe(42);
	});

	it("partitions request-scoped secrets cache per site so previewSecret never leaks", async () => {
		await new OptionsRepository(orangeDb).set(
			"emdash:preview_secret",
			"orange-secret-value-123456",
		);
		await new OptionsRepository(purpleDb).set(
			"emdash:preview_secret",
			"purple-secret-value-789012",
		);

		// Simulate D1 session handles where each request creates a new Kysely wrapper
		markRequestScopedDb(orangeDb);
		markRequestScopedDb(purpleDb);

		const orangeSecrets = await runWithContext(siteCtx("orange", orangeDb), () =>
			resolveSecretsCached(orangeDb),
		);
		const purpleSecrets = await runWithContext(siteCtx("purple", purpleDb), () =>
			resolveSecretsCached(purpleDb),
		);

		expect(orangeSecrets.previewSecret).toBe("orange-secret-value-123456");
		expect(purpleSecrets.previewSecret).toBe("purple-secret-value-789012");

		const holder = (globalThis as Record<symbol, unknown>)[
			Symbol.for("@emdash-cms/core/secrets-cache@2")
		] as { requestScopedBySite?: Map<string, unknown> };
		expect([...(holder.requestScopedBySite?.keys() ?? [])].toSorted()).toEqual([
			"orange",
			"purple",
		]);
	});

	it("partitions site settings SWR cache and invalidation per site", async () => {
		await new OptionsRepository(orangeDb).set("site:title", "Orange Title");
		await new OptionsRepository(purpleDb).set("site:title", "Purple Title");

		const orangeFirst = await runWithContext(siteCtx("orange", orangeDb), () => getSiteSettings());
		const purpleFirst = await runWithContext(siteCtx("purple", purpleDb), () => getSiteSettings());
		expect(orangeFirst.title).toBe("Orange Title");
		expect(purpleFirst.title).toBe("Purple Title");

		await new OptionsRepository(orangeDb).set("site:title", "Orange Updated");
		runWithContext(siteCtx("orange", orangeDb), () => invalidateSiteSettingsCache());

		const orangeSecond = await runWithContext(siteCtx("orange", orangeDb), () => getSiteSettings());
		const purpleSecond = await runWithContext(siteCtx("purple", purpleDb), () => getSiteSettings());
		expect(orangeSecond.title).toBe("Orange Updated");
		expect(purpleSecond.title).toBe("Purple Title");
	});

	it("partitions collection slugs cache per site", async () => {
		await new SchemaRegistry(orangeDb).createCollection({
			slug: "orange_only",
			label: "Orange",
			labelSingular: "Orange",
		});
		await new SchemaRegistry(purpleDb).createCollection({
			slug: "purple_only",
			label: "Purple",
			labelSingular: "Purple",
		});

		runWithContext(siteCtx("orange", orangeDb), () => {
			resetRegisteredCollectionsCache();
			primeRegisteredCollections(["orange_only"]);
		});
		const purpleFiltered = await runWithContext(siteCtx("purple", purpleDb), () =>
			filterToRegisteredCollections(purpleDb, ["orange_only", "purple_only"]),
		);
		expect(purpleFiltered).toEqual(["purple_only"]);
	});

	it("partitions taxonomy definitions cache per site", async () => {
		await orangeDb
			.insertInto("_emdash_taxonomy_defs")
			.values({
				id: "orange_cat",
				name: "orange_cat",
				label: "Orange Cat",
				hierarchical: 1,
				collections: "[]",
				locale: "en",
				translation_group: "orange_cat",
			})
			.execute();
		await purpleDb
			.insertInto("_emdash_taxonomy_defs")
			.values({
				id: "purple_tag",
				name: "purple_tag",
				label: "Purple Tag",
				hierarchical: 0,
				collections: "[]",
				locale: "en",
				translation_group: "purple_tag",
			})
			.execute();

		const orangeDefs = await runWithContext(siteCtx("orange", orangeDb), () => getTaxonomyDefs());
		const purpleDefs = await runWithContext(siteCtx("purple", purpleDb), () => getTaxonomyDefs());
		expect(orangeDefs.map((d) => d.name)).toContain("orange_cat");
		expect(orangeDefs.map((d) => d.name)).not.toContain("purple_tag");
		expect(purpleDefs.map((d) => d.name)).toContain("purple_tag");
		expect(purpleDefs.map((d) => d.name)).not.toContain("orange_cat");

		runWithContext(siteCtx("orange", orangeDb), () => invalidateTaxonomyDefsCache());
	});

	it("partitions byline field defs cache per site", async () => {
		await new BylineSchemaRegistry(orangeDb).createField({
			slug: "orange_bio",
			label: "Orange Bio",
			type: "string",
		});
		await new BylineSchemaRegistry(purpleDb).createField({
			slug: "purple_handle",
			label: "Purple Handle",
			type: "string",
		});

		const orangeFields = await runWithContext(siteCtx("orange", orangeDb), () =>
			getBylineFieldDefs(orangeDb),
		);
		const purpleFields = await runWithContext(siteCtx("purple", purpleDb), () =>
			getBylineFieldDefs(purpleDb),
		);
		expect(orangeFields.map((f) => f.slug)).toEqual(["orange_bio"]);
		expect(purpleFields.map((f) => f.slug)).toEqual(["purple_handle"]);
	});

	it("partitions URL pattern cache per site", async () => {
		await new SchemaRegistry(orangeDb).createCollection({
			slug: "orange_docs",
			label: "Orange Docs",
			labelSingular: "Orange Doc",
			urlPattern: "/docs/{slug}",
		});
		await new SchemaRegistry(purpleDb).createCollection({
			slug: "purple_notes",
			label: "Purple Notes",
			labelSingular: "Purple Note",
			urlPattern: "/notes/{slug}",
		});

		// Warm orange URL patterns (will return null for /notes/x and cache orange_docs)
		await runWithContext(siteCtx("orange", orangeDb), () => resolveEmDashPath("/notes/hello"));

		// Purple must still compile its own /notes/{slug} pattern rather than reusing orange's
		await runWithContext(siteCtx("purple", purpleDb), () => resolveEmDashPath("/notes/hello"));

		const map = (globalThis as Record<symbol, unknown>)[
			Symbol.for("emdash:url-pattern-cache")
		] as Map<string, { patterns: Array<{ slug: string }> | null }>;
		expect(map.get("orange")?.patterns?.map((p) => p.slug)).toEqual(["orange_docs"]);
		expect(map.get("purple")?.patterns?.map((p) => p.slug)).toEqual(["purple_notes"]);
	});

	it("partitions redirect cache per site", async () => {
		await new RedirectRepository(orangeDb).create({
			source: "/old-orange",
			destination: "/new-orange",
			type: 301,
		});
		await new RedirectRepository(purpleDb).create({
			source: "/old-purple",
			destination: "/new-purple",
			type: 302,
		});

		const orangeRules = await runWithContext(siteCtx("orange", orangeDb), () =>
			loadCachedRedirects(createRedirectSource(orangeDb)),
		);
		const purpleRules = await runWithContext(siteCtx("purple", purpleDb), () =>
			loadCachedRedirects(createRedirectSource(purpleDb)),
		);

		expect([...orangeRules.exact.keys()]).toEqual(["/old-orange"]);
		expect([...purpleRules.exact.keys()]).toEqual(["/old-purple"]);
	});

	it("partitions OpenAPI cached spec per site", async () => {
		const orangeRes = await runWithContext(siteCtx("orange", orangeDb), () =>
			getOpenApi({
				locals: { emdash: { config: { maxUploadSize: 1024 } } },
			} as unknown as APIContext),
		);
		const purpleRes = await runWithContext(siteCtx("purple", purpleDb), () =>
			getOpenApi({
				locals: { emdash: { config: { maxUploadSize: 2048 } } },
			} as unknown as APIContext),
		);

		const orangeDoc = await orangeRes.text();
		const purpleDoc = await purpleRes.text();
		expect(orangeDoc).toContain("1024");
		expect(purpleDoc).toContain("2048");
		expect(orangeDoc).not.toBe(purpleDoc);
	});

	it("partitions object-cache epochs, queries, and lastContentWriteAt per site", async () => {
		const sharedMemory = createMemoryCache({ maxEntries: 100 });
		runWithContext(siteCtx("orange", orangeDb), () => {
			__setObjectCacheBackendForTests(sharedMemory, {
				keyPrefix: "site:orange:em",
				revalidate: 60_000,
				defaultTtl: 3600,
			});
		});
		runWithContext(siteCtx("purple", purpleDb), () => {
			__setObjectCacheBackendForTests(sharedMemory, {
				keyPrefix: "site:purple:em",
				revalidate: 60_000,
				defaultTtl: 3600,
			});
		});

		const orangeVal = await runWithContext(siteCtx("orange", orangeDb), () =>
			cachedQuery({
				namespace: "content:v2:pages",
				key: "home",
				load: async () => "orange-home",
			}),
		);
		const purpleVal = await runWithContext(siteCtx("purple", purpleDb), () =>
			cachedQuery({
				namespace: "content:v2:pages",
				key: "home",
				load: async () => "purple-home",
			}),
		);
		expect(orangeVal).toBe("orange-home");
		expect(purpleVal).toBe("purple-home");

		// Invalidating orange must bump orange's lastContentWriteAt without affecting purple
		runWithContext(siteCtx("orange", orangeDb), () => {
			invalidateCollectionCache("pages");
		});
		const orangeWriteAt = await runWithContext(siteCtx("orange", orangeDb), () =>
			getLastContentWriteAt(),
		);
		const purpleWriteAt = await runWithContext(siteCtx("purple", purpleDb), () =>
			getLastContentWriteAt(),
		);
		expect(orangeWriteAt).toBeGreaterThan(0);
		expect(purpleWriteAt).toBe(0);
	});
});
