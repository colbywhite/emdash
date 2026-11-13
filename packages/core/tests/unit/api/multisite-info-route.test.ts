import { Role } from "@emdash-cms/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { injectCoreRoutes } from "../../../src/astro/integration/routes.js";
import { GET as getMultisiteInfo } from "../../../src/astro/routes/api/admin/multisite-info.js";
import { getRuntimeHolder, shutdownRuntime } from "../../../src/astro/runtime-holder.js";

const DB_HOLDER_KEY = Symbol.for("emdash:db-cache");
const STORAGE_CACHE_KEY = Symbol.for("emdash:storage-cache");
const SETUP_VERIFIED_KEY = Symbol.for("emdash:setup-verified");

describe("multisite-info route", () => {
	const store = globalThis as Record<symbol, unknown>;
	const originalDbHolder = store[DB_HOLDER_KEY];
	const originalStorageCache = store[STORAGE_CACHE_KEY];
	const originalSetupVerified = store[SETUP_VERIFIED_KEY];

	afterEach(async () => {
		await shutdownRuntime();
		if (originalDbHolder === undefined) delete store[DB_HOLDER_KEY];
		else store[DB_HOLDER_KEY] = originalDbHolder;
		if (originalStorageCache === undefined) delete store[STORAGE_CACHE_KEY];
		else store[STORAGE_CACHE_KEY] = originalStorageCache;
		if (originalSetupVerified === undefined) delete store[SETUP_VERIFIED_KEY];
		else store[SETUP_VERIFIED_KEY] = originalSetupVerified;
	});

	it("registers /_emdash/api/admin/multisite-info", () => {
		const injectRoute = vi.fn();
		injectCoreRoutes(injectRoute);
		const patterns = injectRoute.mock.calls.map((call) => (call[0] as { pattern: string }).pattern);
		expect(patterns).toContain("/_emdash/api/admin/multisite-info");
	});

	it("enforces admin role authorization", async () => {
		const baseLocals = {
			emdash: { config: {} },
		};

		const unauthed = await getMultisiteInfo({
			locals: baseLocals,
		} as unknown as Parameters<typeof getMultisiteInfo>[0]);
		expect(unauthed.status).toBe(401);

		const editor = await getMultisiteInfo({
			locals: { ...baseLocals, user: { id: "u1", role: Role.EDITOR } },
		} as unknown as Parameters<typeof getMultisiteInfo>[0]);
		expect(editor.status).toBe(403);
	});

	it("returns sanitized per-site bindings and runtime state in multi-site mode", async () => {
		store[DB_HOLDER_KEY] = {
			cache: new Map([
				["admin", {}],
				["site:orange", {}],
			]),
			failures: new Map([["site:pink", { at: Date.now(), message: "migration failed" }]]),
		};
		store[STORAGE_CACHE_KEY] = new Map([["site:orange", {}]]);
		store[SETUP_VERIFIED_KEY] = new Set(["admin", "site:orange"]);
		const holder = getRuntimeHolder() as unknown as {
			slots?: Map<
				string,
				{ instance: { configuredPlugins: unknown[]; sandboxedPluginEntries: unknown[] } }
			>;
		};
		holder.slots = new Map([
			[
				"site:orange",
				{ instance: { configuredPlugins: [{ id: "p1" }], sandboxedPluginEntries: [] } },
			],
		]);

		const response = await getMultisiteInfo({
			locals: {
				user: { id: "u1", role: Role.ADMIN },
				emdash: {
					config: {
						database: {
							type: "sqlite",
							entrypoint: "@emdash-cms/cloudflare/db/d1",
							config: { binding: "DB", authToken: "super-secret" },
						},
						sites: [
							{
								id: "orange",
								name: "Orange site",
								database: {
									type: "sqlite",
									entrypoint: "@emdash-cms/cloudflare/db/d1",
									config: { binding: "ORANGE_DB", authToken: "secret-1" },
								},
								storage: {
									entrypoint: "@emdash-cms/cloudflare/storage/r2",
									config: { binding: "ORANGE_MEDIA", secretAccessKey: "secret-2" },
								},
							},
							{
								id: "pink",
								name: "Pink site",
								database: {
									type: "sqlite",
									entrypoint: "@emdash-cms/cloudflare/db/d1",
									config: { binding: "PINK_DB" },
								},
							},
						],
					},
				},
			},
		} as unknown as Parameters<typeof getMultisiteInfo>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			success: boolean;
			data: {
				mode: string;
				activeSiteId: string | null;
				adminDb: { initialized: boolean; cacheKey: string };
				sites: Array<Record<string, unknown>>;
			};
		};
		expect(body.success).toBe(true);
		expect(body.data.mode).toBe("multi-site");
		expect(body.data.activeSiteId).toBeNull();
		expect(body.data.adminDb).toEqual({ initialized: true, cacheKey: "admin" });
		expect(body.data.sites).toEqual([
			{
				id: "orange",
				name: "Orange site",
				dbEntrypoint: "@emdash-cms/cloudflare/db/d1",
				dbBinding: "ORANGE_DB",
				storageEntrypoint: "@emdash-cms/cloudflare/storage/r2",
				storageBinding: "ORANGE_MEDIA",
				runtimeInitialized: true,
				dbInitialized: true,
				storageInitialized: true,
				setupVerified: true,
				loadedPlugins: 1,
			},
			{
				id: "pink",
				name: "Pink site",
				dbEntrypoint: "@emdash-cms/cloudflare/db/d1",
				dbBinding: "PINK_DB",
				runtimeInitialized: false,
				dbInitialized: false,
				storageInitialized: false,
				setupVerified: false,
				loadedPlugins: 0,
				initFailure: "migration failed",
			},
		]);
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("super-secret");
		expect(serialized).not.toContain("secret-1");
		expect(serialized).not.toContain("secret-2");
	});

	it("returns single-site mode when sites is omitted", async () => {
		const response = await getMultisiteInfo({
			locals: {
				user: { id: "u1", role: Role.ADMIN },
				emdash: { config: {} },
			},
		} as unknown as Parameters<typeof getMultisiteInfo>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { mode: string; sites: unknown[]; adminDb: { cacheKey: string } };
		};
		expect(body.data.mode).toBe("single-site");
		expect(body.data.sites).toEqual([]);
		expect(body.data.adminDb.cacheKey).toBe("default");
	});
});
