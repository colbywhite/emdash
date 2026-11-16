import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockStore, mockCreateKvLike, mockCreateMemoryLike, mockConfig } = vi.hoisted(() => {
	const store = new Map<string, string>();
	const createKvLike = vi.fn(() => ({
		get: async (key: string) => store.get(key) ?? null,
		set: async (key: string, value: string) => {
			store.set(key, value);
		},
	}));
	const createMemoryLike = vi.fn(() => ({
		get: async (key: string) => store.get(key) ?? null,
		set: async (key: string, value: string) => {
			store.set(key, value);
		},
	}));
	return {
		mockStore: store,
		mockCreateKvLike: createKvLike,
		mockCreateMemoryLike: createMemoryLike,
		mockConfig: {
			sites: [{ id: "orange" }, { id: "purple" }] as Array<{ id: string }>,
		},
	};
});

vi.mock("virtual:emdash/config", () => ({ default: mockConfig }), { virtual: true });
vi.mock(
	"virtual:emdash/object-cache",
	() => ({
		createObjectCache: undefined,
		objectCacheConfig: undefined,
		objectCachesByEntrypoint: {
			"@test/kv": mockCreateKvLike,
			"@test/memory": mockCreateMemoryLike,
		},
	}),
	{ virtual: true },
);

import {
	__setObjectCacheBackendForTests,
	cachedQuery,
	isObjectCacheActive,
} from "../../src/object-cache/index.js";
import { createRequestMetrics, runWithContext } from "../../src/request-context.js";

describe("object-cache multi-site backend instantiation and key prefixing", () => {
	beforeEach(() => {
		mockStore.clear();
		mockCreateKvLike.mockClear();
		mockCreateMemoryLike.mockClear();
		__setObjectCacheBackendForTests(null);
	});

	afterEach(() => {
		__setObjectCacheBackendForTests(null);
	});

	it("returns null backend at multi-site root when no site is active", async () => {
		expect(await isObjectCacheActive()).toBe(false);
		expect(mockCreateKvLike).not.toHaveBeenCalled();
	});

	it("instantiates site backends via objectCachesByEntrypoint and prefixes keys with site:<id>:", async () => {
		const orangeCtx = {
			editMode: false,
			metrics: createRequestMetrics(0),
			site: {
				id: "orange",
				name: "Orange",
				config: {
					id: "orange",
					name: "Orange",
					database: { type: "sqlite" as const, entrypoint: "@test/db", config: {} },
					storage: { entrypoint: "@test/storage", config: {} },
					objectCache: { entrypoint: "@test/kv", config: { keyPrefix: "shared" } },
				},
			},
		};
		const purpleCtx = {
			editMode: false,
			metrics: createRequestMetrics(0),
			site: {
				id: "purple",
				name: "Purple",
				config: {
					id: "purple",
					name: "Purple",
					database: { type: "sqlite" as const, entrypoint: "@test/db", config: {} },
					storage: { entrypoint: "@test/storage", config: {} },
					objectCache: { entrypoint: "@test/memory", config: { keyPrefix: "shared" } },
				},
			},
		};

		const orangeVal = await runWithContext(orangeCtx, () =>
			cachedQuery({ namespace: "settings", key: "k", load: async () => "orange-v" }),
		);
		const purpleVal = await runWithContext(purpleCtx, () =>
			cachedQuery({ namespace: "settings", key: "k", load: async () => "purple-v" }),
		);

		expect(orangeVal).toBe("orange-v");
		expect(purpleVal).toBe("purple-v");
		expect(mockCreateKvLike).toHaveBeenCalledTimes(1);
		expect(mockCreateMemoryLike).toHaveBeenCalledTimes(1);

		// Wait for deferred after() cache writes
		await new Promise((resolve) => setTimeout(resolve, 20));
		const keys = [...mockStore.keys()];
		expect(keys.some((k) => k.startsWith("site:orange:shared:"))).toBe(true);
		expect(keys.some((k) => k.startsWith("site:purple:shared:"))).toBe(true);
	});
});
