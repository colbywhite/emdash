import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getRuntimeHolder,
	getRuntimeSlot,
	shutdownRuntime,
} from "../../../src/astro/runtime-holder.js";
import { createDialect } from "../../../src/db/sqlite.js";
import { EmDashRuntime, getStorageCacheKeys } from "../../../src/emdash-runtime.js";
import { createRequestMetrics, runWithContext } from "../../../src/request-context.js";
import { createStorage } from "../../../src/storage/local.js";

const DB_HOLDER_KEY = Symbol.for("emdash:db-cache");
const STORAGE_CACHE_KEY = Symbol.for("emdash:storage-cache");
const SEED_HOLDER_KEY = Symbol.for("emdash:seed-state");

describe("multi-site runtime isolation", () => {
	const store = globalThis as Record<symbol, unknown>;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "emdash-multisite-rt-"));
		await shutdownRuntime();
		delete store[DB_HOLDER_KEY];
		delete store[STORAGE_CACHE_KEY];
		delete store[SEED_HOLDER_KEY];
	});

	afterEach(async () => {
		await shutdownRuntime();
		const dbHolder = store[DB_HOLDER_KEY] as
			| { cache?: Map<string, { destroy: () => Promise<void> }> }
			| undefined;
		if (dbHolder?.cache instanceof Map) {
			for (const db of dbHolder.cache.values()) {
				await db.destroy().catch(() => {});
			}
		}
		delete store[DB_HOLDER_KEY];
		delete store[STORAGE_CACHE_KEY];
		delete store[SEED_HOLDER_KEY];
		await rm(tempDir, { recursive: true, force: true });
	});

	it("isolates DbHolder, storageCache, manifest cache, and shutdown per siteId even with shared entrypoints", async () => {
		const sharedDbEntrypoint = "@emdash-cms/core/db/sqlite";
		const sharedStorageEntrypoint = "@emdash-cms/core/storage/local";

		const adminDb = await EmDashRuntime.getOrInitDatabase({
			config: {
				database: {
					type: "sqlite",
					entrypoint: sharedDbEntrypoint,
					config: { url: join(tempDir, "admin.db") },
				},
			},
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			migrationMode: "auto",
			dbCacheKey: "admin",
		});

		const orangeRuntime = await EmDashRuntime.create({
			siteId: "orange",
			dbCacheKey: "site:orange",
			adminDb,
			config: {
				database: {
					type: "sqlite",
					entrypoint: sharedDbEntrypoint,
					config: { url: join(tempDir, "orange.db") },
				},
				storage: {
					entrypoint: sharedStorageEntrypoint,
					config: { directory: join(tempDir, "orange-media"), baseUrl: "/media" },
				},
			},
			migrationMode: "auto",
			plugins: [],
			sandboxedPluginEntries: [],
			sandboxEnabled: false,
			createSandboxRunner: null,
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			createStorage: (cfg) => createStorage(cfg as { directory: string; baseUrl?: string }),
		});

		const purpleRuntime = await EmDashRuntime.create({
			siteId: "purple",
			dbCacheKey: "site:purple",
			adminDb,
			config: {
				database: {
					type: "sqlite",
					entrypoint: sharedDbEntrypoint,
					config: { url: join(tempDir, "purple.db") },
				},
				storage: {
					entrypoint: sharedStorageEntrypoint,
					config: { directory: join(tempDir, "purple-media"), baseUrl: "/media" },
				},
			},
			migrationMode: "auto",
			plugins: [],
			sandboxedPluginEntries: [],
			sandboxEnabled: false,
			createSandboxRunner: null,
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			createStorage: (cfg) => createStorage(cfg as { directory: string; baseUrl?: string }),
		});

		expect(orangeRuntime.siteId).toBe("orange");
		expect(purpleRuntime.siteId).toBe("purple");
		expect(orangeRuntime.adminDb).toBe(adminDb);
		expect(purpleRuntime.adminDb).toBe(adminDb);
		expect(orangeRuntime.db).not.toBe(purpleRuntime.db);
		expect(orangeRuntime.db).not.toBe(adminDb);
		expect(orangeRuntime.storage).not.toBe(purpleRuntime.storage);
		expect(getStorageCacheKeys()).toEqual(["site:orange", "site:purple"]);

		const dbHolder = store[DB_HOLDER_KEY] as { cache: Map<string, unknown> };
		expect([...dbHolder.cache.keys()].toSorted()).toEqual(["admin", "site:orange", "site:purple"]);

		// Writes in orange stay isolated from purple
		await orangeRuntime.schemaRegistry.createCollection({
			slug: "orange_notes",
			label: "Orange Notes",
			labelSingular: "Orange Note",
		});

		const [orangeManifest, purpleManifest] = await runWithContext(
			{ editMode: false, metrics: createRequestMetrics(0) },
			async () => {
				return [await orangeRuntime.getManifest(), await purpleRuntime.getManifest()];
			},
		);
		expect(orangeManifest.collections).toHaveProperty("orange_notes");
		expect(purpleManifest.collections).not.toHaveProperty("orange_notes");

		// Register in RuntimeHolder and verify shutting down one runtime does not tear down the other
		const holder = getRuntimeHolder();
		holder.adminDb = adminDb;
		getRuntimeSlot(holder, "site:orange").instance = orangeRuntime;
		getRuntimeSlot(holder, "site:purple").instance = purpleRuntime;

		const purpleTerminate = vi.fn(async () => {});
		(
			purpleRuntime as unknown as { sandboxState: { sandboxRunner: unknown } }
		).sandboxState.sandboxRunner = { terminateAll: purpleTerminate };

		await orangeRuntime.shutdown();
		expect(purpleTerminate).not.toHaveBeenCalled();

		// Shutdown runtime tears down all slots and adminDb
		await shutdownRuntime();
		expect(purpleTerminate).toHaveBeenCalledOnce();
		expect(holder.slots.size).toBe(0);
		expect(holder.adminDb).toBeNull();
		expect(dbHolder.cache.has("admin")).toBe(false);
	});

	it("evicts destroyed adminDb from DbHolder so re-initializing after shutdownRuntime returns a live driver", async () => {
		const dbPath = join(tempDir, "admin-reinit.db");
		const adminDeps = {
			config: {
				database: {
					type: "sqlite" as const,
					entrypoint: "@emdash-cms/core/db/sqlite",
					config: { url: dbPath },
				},
			},
			createDialect: (cfg: Record<string, unknown>) => createDialect(cfg as { url: string }),
			migrationMode: "auto" as const,
			dbCacheKey: "admin",
		};

		const firstAdminDb = await EmDashRuntime.getOrInitDatabase(adminDeps);
		getRuntimeHolder().adminDb = firstAdminDb;

		await shutdownRuntime();

		const nextAdminDb = await EmDashRuntime.getOrInitDatabase(adminDeps);
		expect(nextAdminDb).not.toBe(firstAdminDb);

		const siteRuntime = await EmDashRuntime.create({
			siteId: "orange",
			dbCacheKey: "site:orange",
			adminDb: nextAdminDb,
			config: {
				database: {
					type: "sqlite",
					entrypoint: "@emdash-cms/core/db/sqlite",
					config: { url: join(tempDir, "orange-reinit.db") },
				},
			},
			migrationMode: "auto",
			plugins: [],
			sandboxedPluginEntries: [],
			sandboxEnabled: false,
			createSandboxRunner: null,
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			createStorage: null,
		});

		await expect(siteRuntime.adminDb.selectFrom("users").select("id").execute()).resolves.toEqual(
			[],
		);
		await nextAdminDb.destroy().catch(() => {});
	});

	it("prefers ALS ctx.storage over instance _storage when ctx.storage is set", async () => {
		const db = await EmDashRuntime.getOrInitDatabase({
			config: {
				database: {
					type: "sqlite",
					entrypoint: "@emdash-cms/core/db/sqlite",
					config: { url: join(tempDir, "als.db") },
				},
			},
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			migrationMode: "auto",
			dbCacheKey: "site:als",
		});

		const baseStorage = createStorage({ directory: join(tempDir, "base") });
		const overrideStorage = createStorage({ directory: join(tempDir, "override") });
		const runtime = await EmDashRuntime.create({
			siteId: "als",
			dbCacheKey: "site:als",
			config: {
				database: {
					type: "sqlite",
					entrypoint: "@emdash-cms/core/db/sqlite",
					config: { url: join(tempDir, "als.db") },
				},
				storage: {
					entrypoint: "@emdash-cms/core/storage/local",
					config: { directory: join(tempDir, "base") },
				},
			},
			migrationMode: "auto",
			plugins: [],
			sandboxedPluginEntries: [],
			sandboxEnabled: false,
			createSandboxRunner: null,
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			createStorage: () => baseStorage,
		});
		expect(runtime.storage).toBe(baseStorage);

		await runWithContext(
			{ editMode: false, storage: overrideStorage, metrics: createRequestMetrics(0) },
			async () => {
				expect(runtime.storage).toBe(overrideStorage);
			},
		);
		await db.destroy().catch(() => {});
	});
});
