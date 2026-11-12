import type { AstroIntegration } from "astro";
import { describe, expect, it, vi } from "vitest";

import { emdash } from "../../../src/astro/integration/index.js";
import { local } from "../../../src/astro/storage/adapters.js";
import { unknownOptionWarning, validateConfigShape } from "../../../src/config/options-schema.js";
import { sqlite } from "../../../src/db/adapters.js";

function build(config: unknown) {
	// @ts-expect-error - runtime validation covers untyped JavaScript configuration
	return () => emdash(config);
}

describe("emdash() config validation", () => {
	it("accepts a typical configuration", () => {
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
			expect(fn).toThrow(`Site ID "${id}" is reserved`);
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
		expect(fn).toThrow('Site ID "admin" is reserved');
		expect(fn).not.toThrow("Duplicate site ID");
	});
});
