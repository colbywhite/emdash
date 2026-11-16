import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));

const {
	CONFIG,
	mockCreateRuntime,
	mockGetOrInitDatabase,
	mockGetStorage,
	mockCreateRequestScopedDb,
	seenContexts,
} = vi.hoisted(() => {
	return {
		CONFIG: {
			database: {
				type: "sqlite",
				entrypoint: "@test/admin-dialect",
				config: { binding: "ADMIN_DB" },
			},
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: {
						type: "sqlite",
						entrypoint: "@test/site-dialect",
						config: { binding: "ORANGE_DB" },
					},
					storage: {
						entrypoint: "@test/site-storage",
						config: { binding: "ORANGE_MEDIA" },
					},
				},
				{
					id: "purple",
					name: "Purple",
					database: {
						type: "sqlite",
						entrypoint: "@test/site-dialect",
						config: { binding: "PURPLE_DB" },
					},
					storage: {
						entrypoint: "@test/site-storage",
						config: { binding: "PURPLE_MEDIA" },
					},
				},
				{
					id: "pink",
					name: "Pink",
					database: {
						type: "sqlite",
						entrypoint: "@test/site-dialect",
						config: { binding: "PINK_DB" },
					},
					storage: {
						entrypoint: "@test/site-storage",
						config: { binding: "PINK_MEDIA" },
					},
				},
			],
		},
		mockCreateRuntime: vi.fn(),
		mockGetOrInitDatabase: vi.fn(),
		mockGetStorage: vi.fn(),
		mockCreateRequestScopedDb: vi.fn(),
		seenContexts: [] as Array<{ siteId?: string; db?: unknown; storage?: unknown }>,
	};
});

vi.mock("virtual:emdash/config", () => ({ default: CONFIG }), { virtual: true });
vi.mock(
	"virtual:emdash/dialect",
	() => ({
		createDialect: vi.fn(),
		createCoalescingDialect: undefined,
		createRequestScopedDb: mockCreateRequestScopedDb,
		dialectsByEntrypoint: {
			"@test/admin-dialect": {
				createDialect: vi.fn(),
				createCoalescingDialect: undefined,
				createRequestScopedDb: vi.fn().mockReturnValue(null),
			},
			"@test/site-dialect": {
				createDialect: vi.fn(),
				createCoalescingDialect: undefined,
				createRequestScopedDb: mockCreateRequestScopedDb,
			},
		},
	}),
	{ virtual: true },
);
vi.mock("virtual:emdash/media-providers", () => ({ mediaProviders: [] }), { virtual: true });
vi.mock("virtual:emdash/plugins", () => ({ plugins: [] }), { virtual: true });
vi.mock(
	"virtual:emdash/sandbox-runner",
	() => ({ createSandboxRunner: null, sandboxBypassed: false, sandboxEnabled: false }),
	{ virtual: true },
);
vi.mock("virtual:emdash/sandboxed-plugins", () => ({ sandboxedPlugins: [] }), { virtual: true });
vi.mock(
	"virtual:emdash/storage",
	() => ({
		createStorage: undefined,
		storagesByEntrypoint: {
			"@test/site-storage": vi.fn((cfg: Record<string, unknown>) => ({
				_binding: cfg.binding,
				getPublicUrl: (k: string) => `/cdn/${String(cfg.binding)}/${k}`,
			})),
		},
	}),
	{ virtual: true },
);

vi.mock("../../../src/emdash-runtime.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/emdash-runtime.js")>();
	return {
		DB_INIT_DEADLINE_MS: actual.DB_INIT_DEADLINE_MS,
		EmDashRuntime: {
			create: mockCreateRuntime,
			getOrInitDatabase: mockGetOrInitDatabase,
			getStorage: mockGetStorage,
		},
	};
});

import { runScheduledTasks, withEmDashRuntime } from "../../../src/astro/middleware.js";
import { shutdownRuntime } from "../../../src/astro/runtime-holder.js";
import { createDialect } from "../../../src/db/sqlite.js";
import { EmDashRuntime } from "../../../src/emdash-runtime.js";
import { getRequestContext } from "../../../src/request-context.js";

describe("multi-site runScheduledTasks and withEmDashRuntime", () => {
	const adminDbSentinel = { _name: "adminDb", destroy: vi.fn(async () => {}) };

	beforeEach(async () => {
		await shutdownRuntime();
		vi.clearAllMocks();
		seenContexts.length = 0;
		mockGetOrInitDatabase.mockResolvedValue(adminDbSentinel);
		mockGetStorage.mockImplementation(
			(deps: {
				config: { storage?: { config: Record<string, unknown> } };
				createStorage?: (cfg: Record<string, unknown>) => unknown;
			}) =>
				deps.createStorage && deps.config.storage
					? deps.createStorage(deps.config.storage.config)
					: null,
		);
		mockCreateRequestScopedDb.mockImplementation((opts: { siteId?: string }) => ({
			db: { _scopedFor: opts.siteId },
			commit: vi.fn(),
			close: vi.fn(),
		}));
	});

	afterEach(async () => {
		await shutdownRuntime();
	});

	it("iterates sites sequentially in runScheduledTasks, isolates errors per site, and forwards siteId", async () => {
		mockCreateRuntime.mockImplementation(async (deps: { siteId: string }) => {
			if (deps.siteId === "purple") {
				throw new Error("purple migration failed");
			}
			const storage = mockGetStorage(deps as never);
			return {
				siteId: deps.siteId,
				db: { _siteDb: deps.siteId },
				storage,
				shutdown: vi.fn(async () => {}),
				stopCron: vi.fn(async () => {}),
				runScheduledTasks: vi.fn(
					async (opts: {
						onPublished?: (refs: Array<{ collection: string; id: string }>) => Promise<void>;
						invalidateContentCache?: (tags: string[]) => Promise<void>;
					}) => {
						const ctx = getRequestContext();
						seenContexts.push({ siteId: ctx?.site?.id, db: ctx?.db, storage: ctx?.storage });
						const refs = [{ collection: "pages", id: `${deps.siteId}-1` }];
						await opts.onPublished?.(refs);
						await opts.invalidateContentCache?.([`${deps.siteId}-tag`]);
						return { published: refs };
					},
				),
			};
		});

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const onPublished = vi.fn(async () => {});
		const invalidateContentCache = vi.fn(async () => {});

		const result = await runScheduledTasks({ onPublished, invalidateContentCache });

		expect(errorSpy).toHaveBeenCalledWith(
			'[scheduled] runScheduledTasks failed for site "purple":',
			expect.any(Error),
		);
		errorSpy.mockRestore();

		expect(result.published).toEqual([
			{ collection: "pages", id: "orange-1" },
			{ collection: "pages", id: "pink-1" },
		]);
		expect(onPublished).toHaveBeenNthCalledWith(
			1,
			[{ collection: "pages", id: "orange-1" }],
			"orange",
		);
		expect(onPublished).toHaveBeenNthCalledWith(2, [{ collection: "pages", id: "pink-1" }], "pink");
		expect(invalidateContentCache).toHaveBeenNthCalledWith(1, ["orange-tag"], "orange");
		expect(invalidateContentCache).toHaveBeenNthCalledWith(2, ["pink-tag"], "pink");
		expect(seenContexts.map((c) => c.siteId)).toEqual(["orange", "pink"]);
		expect(seenContexts[0]?.db).toEqual({ _scopedFor: "orange" });
		expect(seenContexts[1]?.db).toEqual({ _scopedFor: "pink" });
	});

	it("requires { siteId } in multi-site withEmDashRuntime and rejects unknown siteId", async () => {
		await expect(withEmDashRuntime(() => "ok")).rejects.toThrow(
			"withEmDashRuntime() requires { siteId } when multi-site mode is enabled.",
		);
		await expect(withEmDashRuntime(() => "ok", { siteId: "nope" })).rejects.toThrow(
			'Unknown site "nope" in withEmDashRuntime().',
		);

		mockCreateRuntime.mockImplementation(async (deps: { siteId: string }) => ({
			siteId: deps.siteId,
			db: { _siteDb: deps.siteId },
			storage: mockGetStorage(deps as never),
			shutdown: vi.fn(async () => {}),
			stopCron: vi.fn(async () => {}),
		}));

		const siteSeen = await withEmDashRuntime(
			(runtime) => ({
				runtimeSiteId: runtime.siteId,
				ctxSiteId: getRequestContext()?.site?.id,
				ctxDb: getRequestContext()?.db,
			}),
			{ siteId: "purple" },
		);
		expect(siteSeen).toEqual({
			runtimeSiteId: "purple",
			ctxSiteId: "purple",
			ctxDb: { _scopedFor: "purple" },
		});
	});
});

describe("Node CronScheduler site context wrapping", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "emdash-cron-site-"));
	});

	afterEach(async () => {
		await shutdownRuntime();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("wraps Node CronScheduler setSystemCleanup and cron ticks in site ALS context", async () => {
		const actualCreate = (
			await vi.importActual<typeof import("../../../src/emdash-runtime.js")>(
				"../../../src/emdash-runtime.js",
			)
		).EmDashRuntime.create;
		void EmDashRuntime;

		let capturedCleanup: (() => Promise<void>) | null = null;
		let seenSiteIdInCleanup: string | undefined;
		let seenSiteIdInHook: string | undefined;

		const runtime = await actualCreate({
			siteId: "orange",
			dbCacheKey: "site:orange",
			config: {
				database: {
					type: "sqlite",
					entrypoint: "@emdash-cms/core/db/sqlite",
					config: { url: join(tempDir, "orange.db") },
				},
			},
			migrationMode: "auto",
			plugins: [
				{
					id: "cron-plugin",
					version: "1.0.0",
					capabilities: ["hooks.content:beforePublish"],
					hooks: {
						"content:beforePublish": () => {
							seenSiteIdInHook = getRequestContext()?.site?.id;
						},
					},
					routes: {},
					admin: {},
				} as never,
			],
			sandboxedPluginEntries: [],
			sandboxEnabled: false,
			createSandboxRunner: null,
			createDialect: (cfg) => createDialect(cfg as { url: string }),
			createScheduler: () => ({
				setSystemCleanup: (fn) => {
					capturedCleanup = fn;
				},
				start: () => {},
				stop: () => {},
				reschedule: () => {},
			}),
		});

		expect(capturedCleanup).not.toBeNull();
		const spy = vi.spyOn(runtime, "publishScheduled").mockImplementation(async () => {
			seenSiteIdInCleanup = getRequestContext()?.site?.id;
			return [];
		});
		const runSpy = vi
			.spyOn(
				runtime as unknown as {
					runScheduledMaintenanceTick: () => Promise<{ published: unknown[] }>;
				},
				"runScheduledMaintenanceTick",
			)
			.mockImplementation(async () => {
				seenSiteIdInCleanup = getRequestContext()?.site?.id;
				return { published: [] };
			});

		await capturedCleanup!();
		expect(seenSiteIdInCleanup).toBe("orange");
		expect(seenSiteIdInHook).toBeUndefined();
		spy.mockRestore();
		runSpy.mockRestore();
		await runtime.shutdown();
	});
});
