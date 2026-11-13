import type { AstroIntegration } from "astro";
import { describe, expect, it, vi } from "vitest";

import { emdash, resolveEmDashConfig } from "../../../src/astro/integration/index.js";
import { memoryCache } from "../../../src/astro/object-cache/adapters.js";
import { local } from "../../../src/astro/storage/adapters.js";
import { unknownOptionWarning, validateConfigShape } from "../../../src/config/options-schema.js";
import { sqlite } from "../../../src/db/adapters.js";

function build(config: unknown) {
	// @ts-expect-error - runtime validation covers untyped JavaScript configuration
	return () => emdash(config);
}

describe("emdash() config validation", () => {
	it("accepts a typical single-site configuration", () => {
		expect(() =>
			emdash({
				database: sqlite({ url: "file:./data.db" }),
				storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
				plugins: [{ id: "audit-log", version: "1.0.0", entrypoint: "audit-log" }],
				mcp: false,
				maxUploadSize: 100 * 1024 * 1024,
				toolbar: "client",
				fonts: false,
				admin: { siteName: "Agency CMS", footerLabel: false },
			}),
		).not.toThrow();
	});

	it("accepts a typical multi-site configuration", () => {
		expect(() =>
			emdash({
				database: sqlite({ url: "file:./admin.db" }),
				plugins: [{ id: "audit-log", version: "1.0.0", entrypoint: "audit-log" }],
				mcp: false,
				maxUploadSize: 100 * 1024 * 1024,
				toolbar: "client",
				fonts: false,
				admin: { siteName: "Agency CMS", footerLabel: false },
				sites: [
					{
						id: "orange",
						name: "Orange",
						database: sqlite({ url: "file:./orange.db" }),
						storage: local({
							directory: "./orange-uploads",
							baseUrl: "/_emdash/api/media/file",
						}),
						mcp: false,
						images: true,
						imagePlaceholders: false,
						maxUploadSize: 50 * 1024 * 1024,
						siteUrl: "https://orange.example.com",
					},
					{
						id: "pink-client-2",
						name: "Pink Client 2",
						database: sqlite({ url: "file:./pink.db" }),
					},
				],
			}),
		).not.toThrow();
	});

	it.each([
		["mcp", { mcp: "yes" }],
		["maxUploadSize", { maxUploadSize: "10MB" }],
		["toolbar", { toolbar: "always" }],
		["database", { database: "file:./data.db" }],
		["plugins", { plugins: ["audit-log"] }],
		["admin.siteName", { admin: { siteName: 42 } }],
		["fonts", { fonts: { scripts: "arabic" } }],
		["imagePlaceholders", { imagePlaceholders: "no" }],
		[
			"sites[0].id",
			{ sites: [{ id: "", name: "Orange", database: sqlite({ url: "file:./orange.db" }) }] },
		],
		[
			"sites[0].name",
			{ sites: [{ id: "orange", name: "", database: sqlite({ url: "file:./orange.db" }) }] },
		],
		[
			"sites[0].database",
			{ sites: [{ id: "orange", name: "Orange", database: "file:./orange.db" }] },
		],
		[
			"sites[0].maxUploadSize",
			{
				sites: [
					{
						id: "orange",
						name: "Orange",
						database: sqlite({ url: "file:./orange.db" }),
						maxUploadSize: 0,
					},
				],
			},
		],
	])("names the option path for a wrong %s value", (path, config) => {
		expect(build(config)).toThrow(`→ at ${path}`);
	});

	it("reports every invalid option at once", () => {
		expect(build({ mcp: "yes", toolbar: "always" })).toThrow(/at mcp[\s\S]*at toolbar/);
	});

	it("returns unknown top-level options instead of failing", () => {
		expect(build({ sitUrl: "https://example.com" })).not.toThrow();
		expect(validateConfigShape({ sitUrl: "https://example.com", mcp: true })).toEqual(["sitUrl"]);
	});

	it("recognizes imagePlaceholders as a known option", () => {
		expect(validateConfigShape({ imagePlaceholders: false })).toEqual([]);
	});

	it("accepts options set to undefined", () => {
		expect(
			build({ sandboxRunner: undefined, objectCache: undefined, plugins: undefined }),
		).not.toThrow();
	});

	it.each([0, -1])("rejects a maxUploadSize of %s", (maxUploadSize) => {
		expect(build({ maxUploadSize })).toThrow("→ at maxUploadSize");
	});

	it("explains the allowed toolbar values", () => {
		expect(build({ toolbar: "always" })).toThrow('Expected "server", "client" or `false`');
	});

	it("reports the removed experimental.registry option before the shape check", () => {
		expect(build({ experimental: { registry: "x" }, mcp: "yes" })).toThrow(
			"`experimental.registry` has been removed",
		);
	});

	it("logs a warning for each unknown option during config setup", async () => {
		const warn = vi.fn();
		const setup = emdash({ sitUrl: "https://example.com" } as never).hooks[
			"astro:config:setup"
		] as NonNullable<AstroIntegration["hooks"]["astro:config:setup"]>;
		const root = new URL("file:///tmp/emdash-options-schema/");
		await setup({
			command: "build",
			config: {
				root,
				srcDir: new URL("src/", root),
				security: {},
				trailingSlash: "ignore",
				integrations: [{ name: "@astrojs/react", hooks: {} }],
			},
			logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn },
			injectRoute: vi.fn(),
			addMiddleware: vi.fn(),
			updateConfig: vi.fn(),
		} as never);
		expect(warn).toHaveBeenCalledWith(
			"Unknown EmDash config option `sitUrl` is ignored. Did you mean `siteUrl`?",
		);
	});

	it("suggests the closest option for a misspelled key", () => {
		expect(unknownOptionWarning("sitUrl")).toBe(
			"Unknown EmDash config option `sitUrl` is ignored. Did you mean `siteUrl`?",
		);
		expect(unknownOptionWarning("somethingElse")).toBe(
			"Unknown EmDash config option `somethingElse` is ignored.",
		);
	});

	it.each([
		"Orange",
		"orange_site",
		"orange site",
		"-orange",
		"orange-",
		"orange--site",
		"orange/site",
		"../orange",
		"orange.com",
	])("rejects non-slug site ID %j with the option path", (id) => {
		const fn = build({
			sites: [{ id, name: "Orange", database: sqlite({ url: "file:./orange.db" }) }],
		});
		expect(fn).toThrow("Site ID must be a URL-safe slug");
		expect(fn).toThrow("→ at sites[0].id");
	});

	it.each(["admin", "setup", "api", "auth", "login", "default", "sites"])(
		"rejects reserved site ID %j with the option path",
		(id) => {
			const fn = build({
				sites: [{ id, name: "Site", database: sqlite({ url: "file:./site.db" }) }],
			});
			expect(fn).toThrow(`"${id}" is a reserved term and cannot be used as a site ID`);
			expect(fn).toThrow("→ at sites[0].id");
		},
	);

	it("rejects duplicate site IDs and points at each duplicate index", () => {
		const db = sqlite({ url: "file:./site.db" });
		const fn = build({
			sites: [
				{ id: "orange", name: "Orange 1", database: db },
				{ id: "purple", name: "Purple", database: db },
				{ id: "orange", name: "Orange 2", database: db },
				{ id: "orange", name: "Orange 3", database: db },
			],
		});
		expect(fn).toThrow(
			/Duplicate site ID "orange"[\s\S]*→ at sites\[2\]\.id[\s\S]*→ at sites\[3\]\.id/,
		);
		expect(fn).not.toThrow("→ at sites[0].id");
	});

	it("does not emit a duplicate error when repeated site IDs are already invalid or reserved", () => {
		const db = sqlite({ url: "file:./site.db" });
		const fn = build({
			sites: [
				{ id: "admin", name: "Admin 1", database: db },
				{ id: "admin", name: "Admin 2", database: db },
			],
		});
		expect(fn).toThrow('"admin" is a reserved term and cannot be used as a site ID');
		expect(fn).not.toThrow("Duplicate site ID");
	});

	it("rejects top-level storage when sites is configured", () => {
		const fn = build({
			database: sqlite({ url: "file:./admin.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: sqlite({ url: "file:./orange.db" }),
					storage: local({ directory: "./orange-uploads", baseUrl: "/_emdash/api/media/file" }),
				},
			],
		});
		expect(fn).toThrow("Top-level `storage` cannot be set when `sites` is configured");
		expect(fn).toThrow("→ at storage");
	});

	it("rejects an empty sites array", () => {
		const fn = build({
			database: sqlite({ url: "file:./admin.db" }),
			sites: [],
		});
		expect(fn).toThrow("At least one site must be configured");
		expect(fn).toThrow("→ at sites");
	});

	it("validates and normalizes per-site siteUrl and migrations", () => {
		expect(() =>
			emdash({
				database: sqlite({ url: "file:./admin.db" }),
				sites: [
					{
						id: "orange",
						name: "Orange",
						database: sqlite({ url: "file:./orange.db" }),
						siteUrl: "ftp://orange.example.com",
					},
				],
			}),
		).toThrow("sites[0].siteUrl must be http or https");

		expect(() =>
			emdash({
				database: sqlite({ url: "file:./admin.db" }),
				sites: [
					{
						id: "orange",
						name: "Orange",
						database: sqlite({ url: "file:./orange.db" }),
						migrations: { runtime: "invalid" as never },
					},
				],
			}),
		).toThrow("Invalid migrations.runtime");
	});

	it("leaves root storage undefined and inherits shared site defaults into sites", () => {
		const sharedCache = memoryCache();
		const mediaProvider = {
			id: "custom-provider",
			name: "Custom",
			entrypoint: "custom-provider",
			config: {},
		};
		const resolved = resolveEmDashConfig({
			database: sqlite({ url: "file:./admin.db" }),
			siteUrl: "https://admin.example.com/ignored-path",
			migrations: { runtime: "check", dev: "auto" },
			objectCache: sharedCache,
			images: false,
			mcp: false,
			maxUploadSize: 25 * 1024 * 1024,
			imagePlaceholders: false,
			mediaProviders: [mediaProvider],
			sites: [
				{
					id: "orange",
					name: "Orange",
					database: sqlite({ url: "file:./orange.db" }),
					storage: local({ directory: "./orange-uploads", baseUrl: "/_emdash/api/media/file" }),
				},
				{
					id: "purple",
					name: "Purple",
					database: sqlite({ url: "file:./purple.db" }),
					siteUrl: "https://purple.example.com/nested",
					migrations: { runtime: "manual" },
					mcp: true,
					maxUploadSize: 10 * 1024 * 1024,
				},
			],
		});

		expect(resolved.storage).toBeUndefined();
		expect(resolved.siteUrl).toBe("https://admin.example.com");

		const orange = resolved.sites?.[0];
		expect(orange?.migrations).toEqual({ runtime: "check", dev: "auto" });
		expect(orange?.objectCache).toBe(sharedCache);
		expect(orange?.images).toBe(false);
		expect(orange?.mcp).toBe(false);
		expect(orange?.maxUploadSize).toBe(25 * 1024 * 1024);
		expect(orange?.imagePlaceholders).toBe(false);
		expect(orange?.mediaProviders).toEqual([mediaProvider]);
		expect(orange?.siteUrl).toBeUndefined();

		const purple = resolved.sites?.[1];
		expect(purple?.siteUrl).toBe("https://purple.example.com");
		expect(purple?.migrations).toEqual({ runtime: "manual" });
		expect(purple?.mcp).toBe(true);
		expect(purple?.maxUploadSize).toBe(10 * 1024 * 1024);
		expect(purple?.objectCache).toBe(sharedCache);
	});
});
