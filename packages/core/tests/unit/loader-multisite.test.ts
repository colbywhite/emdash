import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDialect } from "../../src/db/sqlite.js";
import { createRequestMetrics, runWithContext } from "../../src/request-context.js";

const { CONFIG, mockCreateDialect } = vi.hoisted(() => {
	return {
		CONFIG: {
			database: {
				entrypoint: "@test/admin-dialect",
				config: { url: "" },
			},
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: {
						entrypoint: "@test/site-dialect",
						config: { url: "" },
					},
				},
				{
					id: "purple",
					name: "Purple",
					database: {
						entrypoint: "@test/site-dialect",
						config: { url: "" },
					},
				},
			],
		},
		mockCreateDialect: vi.fn((cfg: { url: string }) => createDialect(cfg)),
	};
});

vi.mock("virtual:emdash/config", () => ({ default: CONFIG }), { virtual: true });
vi.mock(
	"virtual:emdash/dialect",
	() => ({
		createDialect: vi.fn(() => {
			throw new Error("root createDialect should not be used for site-dialect");
		}),
		dialectsByEntrypoint: {
			"@test/site-dialect": {
				createDialect: mockCreateDialect,
			},
		},
	}),
	{ virtual: true },
);

import { getDb } from "../../src/loader.js";

describe("loader getDb() in multi-site mode", () => {
	let tempDir: string;

	beforeAll(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "emdash-loader-multisite-"));
		CONFIG.database.config.url = join(tempDir, "admin.db");
		CONFIG.sites[0]!.database.config.url = join(tempDir, "orange.db");
		CONFIG.sites[1]!.database.config.url = join(tempDir, "purple.db");
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("throws explicitly when sites is configured without an active site context", async () => {
		await expect(getDb()).rejects.toThrow(
			"EmDash database cannot be resolved in multi-site mode without an active site context.",
		);
	});

	it("resolves and caches distinct Kysely instances per active site using dialectsByEntrypoint", async () => {
		const orangeDb1 = await runWithContext(
			{
				editMode: false,
				metrics: createRequestMetrics(0),
				site: { id: "orange", name: "Orange", config: CONFIG.sites[0]! as never },
			},
			() => getDb(),
		);
		const orangeDb2 = await runWithContext(
			{
				editMode: false,
				metrics: createRequestMetrics(0),
				site: { id: "orange", name: "Orange", config: CONFIG.sites[0]! as never },
			},
			() => getDb(),
		);
		const purpleDb = await runWithContext(
			{
				editMode: false,
				metrics: createRequestMetrics(0),
				site: { id: "purple", name: "Purple", config: CONFIG.sites[1]! as never },
			},
			() => getDb(),
		);

		expect(orangeDb1).toBe(orangeDb2);
		expect(orangeDb1).not.toBe(purpleDb);
		expect(mockCreateDialect).toHaveBeenCalledTimes(2);
		expect(mockCreateDialect.mock.calls[0]?.[0]).toEqual({ url: join(tempDir, "orange.db") });
		expect(mockCreateDialect.mock.calls[1]?.[0]).toEqual({ url: join(tempDir, "purple.db") });

		await orangeDb1.destroy().catch(() => {});
		await purpleDb.destroy().catch(() => {});
	});
});
