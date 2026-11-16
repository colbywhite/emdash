import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));

const {
	CONFIG,
	mockCreateRuntime,
	mockGetOrInitDatabase,
	mockGetStorage,
	mockDialects,
	mockStorages,
	mockMediaProvidersBySite,
} = vi.hoisted(() => {
	return {
		CONFIG: {
			database: {
				type: "sqlite",
				entrypoint: "@test/admin-dialect",
				config: { binding: "DB" },
			},
			sites: [
				{
					id: "orange",
					name: "Orange Site",
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
					name: "Purple Site",
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
					name: "Pink Site",
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
		mockDialects: {
			adminCreateDialect: vi.fn(() => ({ kind: "admin-dialect" })),
			siteCreateDialect: vi.fn((cfg: Record<string, unknown>) => ({
				kind: "site-dialect",
				binding: cfg.binding,
			})),
		},
		mockStorages: {
			siteCreateStorage: vi.fn((cfg: Record<string, unknown>) => ({
				kind: "site-storage",
				binding: cfg.binding,
				getPublicUrl: (key: string) => `/cdn/${String(cfg.binding)}/${key}`,
			})),
		},
		mockMediaProvidersBySite: {
			orange: [
				{
					id: "orange-provider",
					name: "Orange",
					icon: "image",
					capabilities: {},
					createProvider: vi.fn(),
				},
			],
			purple: [
				{
					id: "purple-provider",
					name: "Purple",
					icon: "image",
					capabilities: {},
					createProvider: vi.fn(),
				},
			],
		},
	};
});

vi.mock("virtual:emdash/config", () => ({ default: CONFIG }), { virtual: true });
vi.mock(
	"virtual:emdash/dialect",
	() => ({
		createDialect: mockDialects.adminCreateDialect,
		createRequestScopedDb: vi.fn().mockReturnValue(null),
		createCoalescingDialect: undefined,
		dialectsByEntrypoint: {
			"@test/admin-dialect": {
				createDialect: mockDialects.adminCreateDialect,
				createRequestScopedDb: vi.fn().mockReturnValue(null),
			},
			"@test/site-dialect": {
				createDialect: mockDialects.siteCreateDialect,
				createRequestScopedDb: vi.fn().mockReturnValue(null),
			},
		},
	}),
	{ virtual: true },
);
vi.mock(
	"virtual:emdash/media-providers",
	() => ({
		mediaProviders: [],
		mediaProvidersBySite: mockMediaProvidersBySite,
	}),
	{ virtual: true },
);
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
			"@test/site-storage": mockStorages.siteCreateStorage,
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

import onRequest from "../../../src/astro/middleware.js";
import { getRuntimeHolder, shutdownRuntime } from "../../../src/astro/runtime-holder.js";

function makeContext(pathname: string) {
	const locals: Record<string, unknown> = {};
	const cookies = new Map<string, string>();
	return {
		request: new Request(`http://localhost:4321${pathname}`),
		url: new URL(`http://localhost:4321${pathname}`),
		locals,
		isPrerendered: false,
		routePattern: pathname,
		cookies: {
			get: (name: string) => (cookies.has(name) ? { value: cookies.get(name)! } : undefined),
			set: (name: string, value: string) => cookies.set(name, value),
			delete: (name: string) => cookies.delete(name),
		},
	};
}

describe("multi-site middleware runtime routing", () => {
	const adminDbSentinel = { _name: "adminDb", destroy: vi.fn(async () => {}) };

	beforeEach(async () => {
		await shutdownRuntime();
		vi.clearAllMocks();
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
		mockCreateRuntime.mockImplementation(async (deps: Record<string, unknown>) => {
			const storage = mockGetStorage(deps as never);
			return {
				siteId: deps.siteId,
				db: { _siteDb: deps.siteId },
				adminDb: deps.adminDb,
				storage,
				hooks: {},
				email: null,
				configuredPlugins: [],
				sandboxedPluginEntries: [],
				shutdown: vi.fn(async () => {}),
				stopCron: vi.fn(async () => {}),
				getManifest: vi.fn(async () => ({ hash: `manifest-${String(deps.siteId)}` })),
				handleContentList: vi.fn(),
				handleContentGet: vi.fn(),
				handleContentAuthors: vi.fn(),
				handleContentCreate: vi.fn(),
				handleContentUpdate: vi.fn(),
				handleContentDelete: vi.fn(),
				handleContentListTrashed: vi.fn(),
				handleContentRestore: vi.fn(),
				handleContentPermanentDelete: vi.fn(),
				handleContentCountTrashed: vi.fn(),
				handleContentGetIncludingTrashed: vi.fn(),
				handleContentDuplicate: vi.fn(),
				handleContentPublish: vi.fn(),
				handleContentUnpublish: vi.fn(),
				handleContentSchedule: vi.fn(),
				handleContentUnschedule: vi.fn(),
				handleContentCountScheduled: vi.fn(),
				handleContentDiscardDraft: vi.fn(),
				handleContentCompare: vi.fn(),
				handleContentTranslations: vi.fn(),
				handleMediaList: vi.fn(),
				handleMediaGet: vi.fn(),
				handleMediaUpload: vi.fn(),
				handleMediaCreate: vi.fn(),
				handleMediaRegisterUpload: vi.fn(),
				handleMediaUpdate: vi.fn(),
				handleMediaDelete: vi.fn(),
				handleRevisionList: vi.fn(),
				handleRevisionGet: vi.fn(),
				handleRevisionRestore: vi.fn(),
				handlePluginApiRoute: vi.fn(),
				getPluginEditorExtension: vi.fn(),
				getPluginEditorDraftSchema: vi.fn(),
				getPluginRouteMeta: vi.fn(),
				getPluginMcpTools: vi.fn(),
				getEnabledPluginMcpTools: vi.fn(),
				serializePluginMcpConsent: vi.fn(),
				handlePluginMcpTool: vi.fn(),
				handlePluginMcpDenied: vi.fn(),
				getMediaProvider: vi.fn(),
				getMediaProviderList: vi.fn(),
				collectPageMetadata: vi.fn(),
				collectPageFragments: vi.fn(),
				ensureSearchHealthy: vi.fn(),
				getSandboxRunner: vi.fn(),
				isSandboxBypassed: vi.fn(() => false),
				syncMarketplacePlugins: vi.fn(),
				syncRegistryPlugins: vi.fn(),
				runPluginInstallLifecycle: vi.fn(),
				runPluginActivateLifecycle: vi.fn(),
				runPluginUninstallLifecycle: vi.fn(),
				getRuntimePluginSettingsSchema: vi.fn(),
				setPluginStatus: vi.fn(),
			};
		});
	});

	afterEach(async () => {
		await shutdownRuntime();
	});

	it("opens only adminDb for root multi-site admin requests without booting any site runtime", async () => {
		const ctx = makeContext("/_emdash/admin/settings");
		const next = vi.fn(async () => new Response("ok"));

		const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(
			ctx,
			next,
		);
		expect(response.status).toBe(200);
		expect(mockGetOrInitDatabase).toHaveBeenCalledTimes(1);
		expect(mockGetOrInitDatabase.mock.calls[0]?.[0]).toMatchObject({ dbCacheKey: "admin" });
		expect(mockCreateRuntime).not.toHaveBeenCalled();

		const holder = getRuntimeHolder();
		expect(holder.adminDb).toBe(adminDbSentinel);
		expect(holder.slots.size).toBe(0);

		const emdash = ctx.locals.emdash as {
			db: unknown;
			adminDb: unknown;
			storage: unknown;
			getManifest: () => Promise<{ hash: string; sites?: Array<{ id: string }> }>;
		};
		expect(emdash.db).toBe(adminDbSentinel);
		expect(emdash.adminDb).toBe(adminDbSentinel);
		expect(emdash.storage).toBeNull();
		const manifest = await emdash.getManifest();
		expect(manifest.hash).toBe("admin");
		expect(manifest.sites?.map((s) => s.id)).toEqual(["orange", "purple", "pink"]);
	});

	it("boots only the requested site runtime slots lazily and leaves untouched sites uninitialized", async () => {
		const next = vi.fn(async () => new Response("ok"));

		const orangeCtx = makeContext("/_emdash/api/sites/orange/content/pages");
		await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(orangeCtx, next);

		const purpleCtx = makeContext("/_emdash/api/sites/purple/content/pages");
		await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(purpleCtx, next);

		expect(mockCreateRuntime).toHaveBeenCalledTimes(2);
		expect(mockGetOrInitDatabase).toHaveBeenCalledTimes(1);

		const orangeDeps = mockCreateRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
		const purpleDeps = mockCreateRuntime.mock.calls[1]?.[0] as Record<string, unknown>;
		expect(orangeDeps.siteId).toBe("orange");
		expect(orangeDeps.dbCacheKey).toBe("site:orange");
		expect(orangeDeps.adminDb).toBe(adminDbSentinel);
		expect(orangeDeps.mediaProviderEntries).toEqual(mockMediaProvidersBySite.orange);
		expect(purpleDeps.siteId).toBe("purple");
		expect(purpleDeps.dbCacheKey).toBe("site:purple");
		expect(purpleDeps.adminDb).toBe(adminDbSentinel);
		expect(purpleDeps.mediaProviderEntries).toEqual(mockMediaProvidersBySite.purple);

		const holder = getRuntimeHolder();
		expect([...holder.slots.keys()].toSorted()).toEqual(["site:orange", "site:purple"]);
		expect(holder.slots.has("site:pink")).toBe(false);
	});

	it("skips site runtime init on anonymous root multi-site public routes", async () => {
		const ctx = makeContext("/");
		const next = vi.fn(async () => new Response("home"));

		const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)(
			ctx,
			next,
		);
		expect(response.status).toBe(200);
		expect(mockCreateRuntime).not.toHaveBeenCalled();
		expect(mockGetOrInitDatabase).not.toHaveBeenCalled();
		expect(ctx.locals.emdash).toBeUndefined();
	});
});
