/**
 * Virtual Module Generators
 *
 * Functions that generate virtual module content for Vite.
 * These modules statically import configured dependencies
 * so Vite can properly resolve and bundle them.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import type { AuthProviderDescriptor } from "../../auth/types.js";
import type { MediaProviderDescriptor } from "../../media/types.js";
import { defaultSeed } from "../../seed/default.js";
import type { PluginDescriptor } from "./runtime.js";

const TS_SOURCE_EXT_RE = /^\.(ts|tsx|mts|cts|jsx)$/;

/** Pattern to remove scoped package prefix from plugin ID */
const SCOPED_PREFIX_PATTERN = /^@[^/]+\/plugin-/;

/** Pattern to remove emdash-plugin- prefix from plugin ID */
const EMDASH_PREFIX_PATTERN = /^emdash-plugin-/;

// Virtual module IDs
export const VIRTUAL_CONFIG_ID = "virtual:emdash/config";
export const RESOLVED_VIRTUAL_CONFIG_ID = "\0" + VIRTUAL_CONFIG_ID;

export const VIRTUAL_DIALECT_ID = "virtual:emdash/dialect";
export const RESOLVED_VIRTUAL_DIALECT_ID = "\0" + VIRTUAL_DIALECT_ID;

export const VIRTUAL_STORAGE_ID = "virtual:emdash/storage";
export const RESOLVED_VIRTUAL_STORAGE_ID = "\0" + VIRTUAL_STORAGE_ID;

export const VIRTUAL_OBJECT_CACHE_ID = "virtual:emdash/object-cache";
export const RESOLVED_VIRTUAL_OBJECT_CACHE_ID = "\0" + VIRTUAL_OBJECT_CACHE_ID;

export const VIRTUAL_ADMIN_REGISTRY_ID = "virtual:emdash/admin-registry";
export const RESOLVED_VIRTUAL_ADMIN_REGISTRY_ID = "\0" + VIRTUAL_ADMIN_REGISTRY_ID;

export const VIRTUAL_PLUGINS_ID = "virtual:emdash/plugins";
export const RESOLVED_VIRTUAL_PLUGINS_ID = "\0" + VIRTUAL_PLUGINS_ID;

export const VIRTUAL_SANDBOX_RUNNER_ID = "virtual:emdash/sandbox-runner";
export const RESOLVED_VIRTUAL_SANDBOX_RUNNER_ID = "\0" + VIRTUAL_SANDBOX_RUNNER_ID;

export const VIRTUAL_SANDBOXED_PLUGINS_ID = "virtual:emdash/sandboxed-plugins";
export const RESOLVED_VIRTUAL_SANDBOXED_PLUGINS_ID = "\0" + VIRTUAL_SANDBOXED_PLUGINS_ID;

export const VIRTUAL_AUTH_ID = "virtual:emdash/auth";
export const RESOLVED_VIRTUAL_AUTH_ID = "\0" + VIRTUAL_AUTH_ID;

export const VIRTUAL_AUTH_PROVIDERS_ID = "virtual:emdash/auth-providers";
export const RESOLVED_VIRTUAL_AUTH_PROVIDERS_ID = "\0" + VIRTUAL_AUTH_PROVIDERS_ID;

export const VIRTUAL_MEDIA_PROVIDERS_ID = "virtual:emdash/media-providers";
export const RESOLVED_VIRTUAL_MEDIA_PROVIDERS_ID = "\0" + VIRTUAL_MEDIA_PROVIDERS_ID;

export const VIRTUAL_BLOCK_COMPONENTS_ID = "virtual:emdash/block-components";
export const RESOLVED_VIRTUAL_BLOCK_COMPONENTS_ID = "\0" + VIRTUAL_BLOCK_COMPONENTS_ID;

export const VIRTUAL_SEED_ID = "virtual:emdash/seed";
export const RESOLVED_VIRTUAL_SEED_ID = "\0" + VIRTUAL_SEED_ID;

export const VIRTUAL_WAIT_UNTIL_ID = "virtual:emdash/wait-until";
export const RESOLVED_VIRTUAL_WAIT_UNTIL_ID = "\0" + VIRTUAL_WAIT_UNTIL_ID;

export const VIRTUAL_SCHEDULER_ID = "virtual:emdash/scheduler";
export const RESOLVED_VIRTUAL_SCHEDULER_ID = "\0" + VIRTUAL_SCHEDULER_ID;

export const VIRTUAL_ENV_ID = "virtual:emdash/env";
export const RESOLVED_VIRTUAL_ENV_ID = "\0" + VIRTUAL_ENV_ID;

export const VIRTUAL_BUILD_ID = "virtual:emdash/build";
export const RESOLVED_VIRTUAL_BUILD_ID = "\0" + VIRTUAL_BUILD_ID;

/**
 * Generates the config virtual module.
 */
export function generateConfigModule(serializableConfig: Record<string, unknown>): string {
	return `export default ${JSON.stringify(serializableConfig)};`;
}

/**
 * Generates the dialect virtual module.
 *
 * Adapters that set `supportsRequestScope: true` on their descriptor are
 * expected to export `createRequestScopedDb` from their runtime entrypoint;
 * the generator re-exports it so middleware can ask for a per-request Kysely
 * (used for D1 Sessions API, bookmark cookies, read-replica routing). Other
 * adapters get a stub that returns null.
 *
 * Adapters independently opt into the cold-start coalescing dialect. Keeping
 * this capability explicit prevents bundlers from probing exports that do not
 * exist on SQLite, libSQL, PostgreSQL, or other adapters.
 */
export interface DialectModuleTarget {
	entrypoint: string;
	type?: string;
	supportsRequestScope: boolean;
	supportsCoalescing: boolean;
	supportsCollectionDeletionGuard: boolean;
}

export function generateDialectModule(opts: {
	entrypoint?: string;
	type?: string;
	supportsRequestScope: boolean;
	supportsCoalescing: boolean;
	supportsCollectionDeletionGuard: boolean;
	additionalDialects?: readonly DialectModuleTarget[];
}): string {
	const {
		entrypoint,
		supportsRequestScope,
		supportsCoalescing,
		supportsCollectionDeletionGuard,
		additionalDialects = [],
	} = opts;

	const uniqueDialects = new Map<string, DialectModuleTarget>();
	if (entrypoint) {
		uniqueDialects.set(entrypoint, {
			entrypoint,
			type: opts.type,
			supportsRequestScope,
			supportsCoalescing,
			supportsCollectionDeletionGuard,
		});
	}
	for (const extra of additionalDialects) {
		if (!extra.entrypoint) continue;
		const existing = uniqueDialects.get(extra.entrypoint);
		if (existing) {
			existing.supportsRequestScope ||= extra.supportsRequestScope;
			existing.supportsCoalescing ||= extra.supportsCoalescing;
			existing.supportsCollectionDeletionGuard ||= extra.supportsCollectionDeletionGuard;
			existing.type ??= extra.type;
		} else {
			uniqueDialects.set(extra.entrypoint, { ...extra });
		}
	}

	const lines: string[] = [];
	if (!entrypoint) {
		lines.push(
			`export const createDialect = undefined;`,
			`export const dialectType = "sqlite";`,
			`export const createRequestScopedDb = (_opts) => null;`,
			`export const createCoalescingDialect = undefined;`,
			`export const executeCollectionDeletionGuard = undefined;`,
		);
	} else {
		const primary = uniqueDialects.get(entrypoint)!;
		const type = primary.type ?? "sqlite";
		const coalescingExport = primary.supportsCoalescing
			? `import { createCoalescingDialect as _createCoalescingDialect } from "${entrypoint}";\nexport const createCoalescingDialect = _createCoalescingDialect;`
			: `export const createCoalescingDialect = undefined;`;
		const collectionDeletionExport = primary.supportsCollectionDeletionGuard
			? `import { executeCollectionDeletionGuard as _executeCollectionDeletionGuard } from "${entrypoint}";\nexport { executeCollectionDeletionGuard } from "${entrypoint}";`
			: `export const executeCollectionDeletionGuard = undefined;`;

		if (primary.supportsRequestScope) {
			lines.push(
				`import { createDialect as _createDialect } from "${entrypoint}";`,
				`import { createRequestScopedDb as _createRequestScopedDb } from "${entrypoint}";`,
				`export { createRequestScopedDb } from "${entrypoint}";`,
				coalescingExport,
				collectionDeletionExport,
				`export const createDialect = _createDialect;`,
				`export const dialectType = ${JSON.stringify(type)};`,
			);
		} else {
			lines.push(
				`import { createDialect as _createDialect } from "${entrypoint}";`,
				coalescingExport,
				collectionDeletionExport,
				`export const createDialect = _createDialect;`,
				`export const dialectType = ${JSON.stringify(type)};`,
				`export const createRequestScopedDb = (_opts) => null;`,
			);
		}
	}

	const mapEntries: string[] = [];
	let extraIndex = 0;
	for (const [ep, target] of uniqueDialects) {
		if (ep === entrypoint) {
			const requestScopedExpr = target.supportsRequestScope
				? "_createRequestScopedDb"
				: "createRequestScopedDb";
			const deletionGuardExpr = target.supportsCollectionDeletionGuard
				? "_executeCollectionDeletionGuard"
				: "executeCollectionDeletionGuard";
			mapEntries.push(
				`  ${JSON.stringify(ep)}: { createDialect, dialectType, createRequestScopedDb: ${requestScopedExpr}, createCoalescingDialect, executeCollectionDeletionGuard: ${deletionGuardExpr} },`,
			);
			continue;
		}
		const idx = extraIndex++;
		const type = target.type ?? "sqlite";
		lines.push(`import { createDialect as _createDialect${idx} } from "${ep}";`);
		if (target.supportsRequestScope) {
			lines.push(`import { createRequestScopedDb as _createRequestScopedDb${idx} } from "${ep}";`);
		}
		if (target.supportsCoalescing) {
			lines.push(
				`import { createCoalescingDialect as _createCoalescingDialect${idx} } from "${ep}";`,
			);
		}
		if (target.supportsCollectionDeletionGuard) {
			lines.push(
				`import { executeCollectionDeletionGuard as _executeCollectionDeletionGuard${idx} } from "${ep}";`,
			);
		}
		mapEntries.push(
			`  ${JSON.stringify(ep)}: {
    createDialect: _createDialect${idx},
    dialectType: ${JSON.stringify(type)},
    createRequestScopedDb: ${target.supportsRequestScope ? `_createRequestScopedDb${idx}` : `(_opts) => null`},
    createCoalescingDialect: ${target.supportsCoalescing ? `_createCoalescingDialect${idx}` : `undefined`},
    executeCollectionDeletionGuard: ${target.supportsCollectionDeletionGuard ? `_executeCollectionDeletionGuard${idx}` : `undefined`},
  },`,
		);
	}

	lines.push(
		mapEntries.length > 0
			? `export const dialectsByEntrypoint = {\n${mapEntries.join("\n")}\n};`
			: `export const dialectsByEntrypoint = {};`,
	);

	return lines.join("\n");
}

/**
 * Generates the storage virtual module.
 * Statically imports the configured storage adapter(s).
 */
export function generateStorageModule(
	storageEntrypoint?: string,
	additionalEntrypoints: readonly string[] = [],
): string {
	const uniqueEntrypoints = [
		...new Set(
			[storageEntrypoint, ...additionalEntrypoints].filter((v): v is string => Boolean(v)),
		),
	];

	if (uniqueEntrypoints.length === 0) {
		return [
			`export const createStorage = undefined;`,
			`export const storagesByEntrypoint = {};`,
		].join("\n");
	}

	const imports: string[] = [];
	const mapEntries: string[] = [];
	uniqueEntrypoints.forEach((ep, index) => {
		const varName = ep === storageEntrypoint ? "_createStorage" : `_createStorage${index}`;
		imports.push(`import { createStorage as ${varName} } from "${ep}";`);
		mapEntries.push(`  ${JSON.stringify(ep)}: ${varName},`);
	});

	return [
		...imports,
		storageEntrypoint
			? `export const createStorage = _createStorage;`
			: `export const createStorage = undefined;`,
		`export const storagesByEntrypoint = {\n${mapEntries.join("\n")}\n};`,
	].join("\n");
}

/**
 * Generates the object-cache virtual module.
 *
 * Statically imports the configured object-cache backend's `createObjectCache`
 * factory and embeds its serializable config. When no object cache is
 * configured, exports `undefined` so the runtime read-through layer becomes a
 * transparent passthrough (cache off by default).
 */
export function generateObjectCacheModule(
	entrypoint?: string,
	config?: Record<string, unknown>,
	additionalEntrypoints: readonly string[] = [],
): string {
	const uniqueEntrypoints = [
		...new Set([entrypoint, ...additionalEntrypoints].filter((v): v is string => Boolean(v))),
	];

	if (uniqueEntrypoints.length === 0) {
		return [
			`export const createObjectCache = undefined;`,
			`export const objectCacheConfig = undefined;`,
			`export const objectCachesByEntrypoint = {};`,
		].join("\n");
	}

	const imports: string[] = [];
	const mapEntries: string[] = [];
	uniqueEntrypoints.forEach((ep, index) => {
		const varName = ep === entrypoint ? "_createObjectCache" : `_createObjectCache${index}`;
		imports.push(`import { createObjectCache as ${varName} } from "${ep}";`);
		mapEntries.push(`  ${JSON.stringify(ep)}: ${varName},`);
	});

	return [
		...imports,
		entrypoint
			? `export const createObjectCache = _createObjectCache;\nexport const objectCacheConfig = ${JSON.stringify(config ?? {})};`
			: `export const createObjectCache = undefined;\nexport const objectCacheConfig = undefined;`,
		`export const objectCachesByEntrypoint = {\n${mapEntries.join("\n")}\n};`,
	].join("\n");
}

/**
 * Generates the auth virtual module.
 * Statically imports the configured auth provider.
 */
export function generateAuthModule(authEntrypoint?: string): string {
	if (!authEntrypoint) {
		return `export const authenticate = undefined;`;
	}
	return `
import { authenticate as _authenticate } from "${authEntrypoint}";
export const authenticate = _authenticate;
`;
}

/**
 * Generates the auth providers module.
 *
 * Statically imports each auth provider's `adminEntry` module and exports
 * a registry keyed by provider ID. The admin UI uses this to render
 * provider-specific login buttons/forms and setup steps.
 *
 * Follows the same pattern as `generateAdminRegistryModule()` for plugins.
 */
export function generateAuthProvidersModule(descriptors: AuthProviderDescriptor[]): string {
	const withAdmin = descriptors.filter((d) => d.adminEntry);

	if (withAdmin.length === 0) {
		return `export const authProviders = {};`;
	}

	const imports: string[] = [];
	const entries: string[] = [];

	withAdmin.forEach((descriptor, index) => {
		const varName = `authProvider${index}`;
		imports.push(`import * as ${varName} from ${JSON.stringify(descriptor.adminEntry)};`);
		entries.push(
			`  ${JSON.stringify(descriptor.id)}: { ...${varName}, id: ${JSON.stringify(descriptor.id)}, label: ${JSON.stringify(descriptor.label)} },`,
		);
	});

	return `
// Auto-generated auth provider registry
${imports.join("\n")}

export const authProviders = {
${entries.join("\n")}
};
`;
}

/**
 * Generates the plugins module.
 * Imports and instantiates all plugins at runtime.
 *
 * Handles two plugin formats:
 * - **Native**: imports `createPlugin` and calls it with options
 * - **Standard**: imports the default export and wraps it with `adaptSandboxEntry`
 *
 * The format is determined by `descriptor.format`:
 * - `"standard"` -- uses adaptSandboxEntry
 * - `"native"` or undefined -- uses createPlugin
 *
 * This is critical for Cloudflare Workers where globals don't persist
 * between build time and runtime.
 */
export function generatePluginsModule(descriptors: PluginDescriptor[]): string {
	const imports: string[] = [];
	const instantiations: string[] = [];

	// Track whether we need the adapter import
	let needsAdapter = false;

	descriptors.forEach((descriptor, index) => {
		// Every `plugins: []` entry must resolve to a file/package entrypoint that
		// can be statically imported and bundled at build time. An in-process
		// `definePlugin({...})` result passed directly has no entrypoint; without
		// this guard the generator emitted `import pluginDefN from "undefined";`,
		// which failed deep in Rollup with `failed to resolve import "undefined"`
		// (#1416). Fail fast with an actionable message instead.
		if (!descriptor.entrypoint) {
			throw new Error(
				`[emdash] Plugin "${descriptor.id}" has no \`entrypoint\`. The astro integration's ` +
					`\`plugins: []\` requires plugins that resolve to a file/package entrypoint so they can be ` +
					`bundled at build time; an in-process \`definePlugin({...})\` result passed directly is not ` +
					`supported. Move the plugin into its own module and reference it via a factory that returns ` +
					`a descriptor with an \`entrypoint\` (e.g. \`plugins: [myPlugin()]\`).`,
			);
		}
		if (descriptor.format === "standard") {
			// Standard format: import default export, wrap with adaptSandboxEntry
			needsAdapter = true;
			const varName = `pluginDef${index}`;
			imports.push(`import ${varName} from "${descriptor.entrypoint}";`);
			instantiations.push(
				`adaptSandboxEntry(${varName}, ${JSON.stringify({
					id: descriptor.id,
					displayName: descriptor.displayName,
					description: descriptor.description,
					version: descriptor.version,
					capabilities: descriptor.capabilities,
					allowedHosts: descriptor.allowedHosts,
					storage: descriptor.storage,
					adminPages: descriptor.adminPages,
					adminWidgets: descriptor.adminWidgets,
					editorPanels: descriptor.editorPanels,
					editorActions: descriptor.editorActions,
					settingsSchema: descriptor.settingsSchema,
					portableTextBlocks: descriptor.portableTextBlocks,
					fieldWidgets: descriptor.fieldWidgets,
					mcp: descriptor.mcp,
				})})`,
			);
		} else {
			// Native format: import createPlugin and call with options
			const varName = `createPlugin${index}`;
			imports.push(`import { createPlugin as ${varName} } from "${descriptor.entrypoint}";`);
			instantiations.push(
				`({ ...${varName}(${JSON.stringify(descriptor.options ?? {})}), ...${JSON.stringify({
					displayName: descriptor.displayName,
					description: descriptor.description,
				})} })`,
			);
		}
	});

	const adapterImport = needsAdapter
		? `import { adaptSandboxEntry } from "emdash/internal/plugins/adapt-sandbox-entry";\n`
		: "";

	// Share instances across duplicated SSR chunks, but not across plugin configurations.
	const cacheId = createHash("sha256")
		.update(adapterImport + imports.join("\n") + instantiations.join(",\n"))
		.digest("hex");

	return `
// Auto-generated plugins module
${adapterImport}${imports.join("\n")}

// Defer factories and adaptation until the runtime's module graph has initialized.
export function plugins() {
  const key = Symbol.for("emdash:plugins");
  const cache = globalThis[key] ??= {};
  return cache["${cacheId}"] ??= [
    ${instantiations.join(",\n    ")}
  ];
}
`;
}

/**
 * Generates the admin registry module.
 * Uses adminEntry from plugin descriptors to statically import admin modules.
 */
export function generateAdminRegistryModule(descriptors: PluginDescriptor[]): string {
	// Filter to descriptors with admin entries
	const adminDescriptors = descriptors.filter((d) => d.adminEntry);

	if (adminDescriptors.length === 0) {
		return `export const pluginAdmins = {};`;
	}

	const imports: string[] = [];
	const entries: string[] = [];

	adminDescriptors.forEach((descriptor, index) => {
		const varName = `admin${index}`;
		// Use explicit ID from descriptor if available, otherwise derive from entrypoint
		const pluginId =
			descriptor.id ??
			descriptor.entrypoint.replace(SCOPED_PREFIX_PATTERN, "").replace(EMDASH_PREFIX_PATTERN, "");

		imports.push(`import * as ${varName} from "${descriptor.adminEntry}";`);
		entries.push(`  "${pluginId}": ${varName},`);
	});

	return `
// Auto-generated plugin admin registry
${imports.join("\n")}

export const pluginAdmins = {
${entries.join("\n")}
};
`;
}

/**
 * Generates the sandbox runner module.
 * Imports the configured sandbox runner factory or provides a noop default.
 *
 * When sandbox is explicitly false (debugging escape hatch), we still mark
 * sandboxEnabled = true so sandboxed plugin entries are loaded, but we use
 * the noop runner which falls through to in-process loading via adaptSandboxEntry.
 */
export function generateSandboxRunnerModule(sandboxRunner?: string, sandbox?: boolean): string {
	if (!sandboxRunner) {
		// No sandbox runner configured - sandboxed plugins disabled
		return `
// No sandbox runner configured - sandboxed plugins disabled
import { createNoopSandboxRunner } from "emdash";

export const createSandboxRunner = createNoopSandboxRunner;
export const sandboxEnabled = false;
`;
	}

	if (sandbox === false) {
		// sandbox: false escape hatch - plugins are loaded but run in-process
		// (no isolation, for debugging)
		return `
// Sandbox explicitly disabled (sandbox: false) - plugins run in-process
import { createNoopSandboxRunner } from "emdash";

export const createSandboxRunner = createNoopSandboxRunner;
export const sandboxEnabled = true;
export const sandboxBypassed = true;
`;
	}

	return `
// Auto-generated sandbox runner module
import { createSandboxRunner as _createSandboxRunner } from "${sandboxRunner}";

export const createSandboxRunner = _createSandboxRunner;
export const sandboxEnabled = true;
`;
}

function isLocalMediaProviderDisabled(list: MediaProviderDescriptor[]): boolean {
	return list.some((d) => d.id === "local" && d.config.enabled === false);
}

/**
 * Generates the media providers module.
 * Imports and instantiates configured media providers at runtime.
 */
export function generateMediaProvidersModule(
	descriptors: MediaProviderDescriptor[],
	siteDescriptors: Record<string, MediaProviderDescriptor[]> = {},
): string {
	const imports: string[] = [];
	const providerVars = new Map<string, string>();
	let nextProviderIndex = 0;
	let needsLocalProvider = false;

	const registerList = (list: MediaProviderDescriptor[]) => {
		if (!isLocalMediaProviderDisabled(list)) {
			needsLocalProvider = true;
		}
		for (const descriptor of list) {
			if (descriptor.id === "local") continue;
			if (!providerVars.has(descriptor.entrypoint)) {
				const varName = `createProvider${nextProviderIndex++}`;
				providerVars.set(descriptor.entrypoint, varName);
				imports.push(
					`import { createMediaProvider as ${varName} } from "${descriptor.entrypoint}";`,
				);
			}
		}
	};

	registerList(descriptors);
	for (const list of Object.values(siteDescriptors)) {
		registerList(list);
	}

	if (needsLocalProvider) {
		imports.unshift(
			`import { createMediaProvider as createLocalProvider } from "emdash/internal/media/local-runtime";`,
		);
	}

	const buildEntries = (list: MediaProviderDescriptor[]): string[] => {
		const entries: string[] = [];
		if (!isLocalMediaProviderDisabled(list)) {
			entries.push(`{
	id: "local",
	name: "Library",
	icon: "folder",
	capabilities: { browse: true, search: false, upload: true, delete: true },
	createProvider: (ctx) => createLocalProvider({ ...ctx, enabled: true }),
}`);
		}
		for (const descriptor of list) {
			if (descriptor.id === "local") continue;
			const varName = providerVars.get(descriptor.entrypoint)!;
			entries.push(`{
	id: ${JSON.stringify(descriptor.id)},
	name: ${JSON.stringify(descriptor.name)},
	icon: ${JSON.stringify(descriptor.icon)},
	capabilities: ${JSON.stringify(descriptor.capabilities)},
	createProvider: (ctx) => ${varName}({ ...${JSON.stringify(descriptor.config)}, ...ctx }),
}`);
		}
		return entries;
	};

	const rootEntries = buildEntries(descriptors);
	const siteEntries = Object.entries(siteDescriptors).map(([siteId, list]) => {
		const entries = buildEntries(list);
		return `  ${JSON.stringify(siteId)}: [\n    ${entries.join(",\n    ")}\n  ],`;
	});

	return `
// Auto-generated media providers module
${imports.join("\n")}

/** Media provider descriptors with factory functions */
export const mediaProviders = [
  ${rootEntries.join(",\n  ")}
];

/** Per-site media provider descriptors with factory functions */
export const mediaProvidersBySite = {
${siteEntries.join("\n")}
};
`;
}

/**
 * Generates the block components module.
 * Collects and merges `blockComponents` exports from plugin component entries.
 */
export function generateBlockComponentsModule(descriptors: PluginDescriptor[]): string {
	const withComponents = descriptors.filter((d) => d.componentsEntry);
	if (withComponents.length === 0) {
		return `export const pluginBlockComponents = {};`;
	}

	const imports: string[] = [];
	const spreads: string[] = [];
	withComponents.forEach((d, i) => {
		imports.push(`import { blockComponents as bc${i} } from "${d.componentsEntry}";`);
		spreads.push(`...bc${i}`);
	});

	return `${imports.join("\n")}\nexport const pluginBlockComponents = { ${spreads.join(", ")} };`;
}

/**
 * Generates the wait-until virtual module.
 *
 * Under @astrojs/cloudflare, re-exports `waitUntil` from `cloudflare:workers`
 * so `after(fn)` in core can extend the worker's lifetime past the response
 * for deferred bookkeeping. For any other adapter, exports `undefined` —
 * Node's long-lived event loop keeps deferred promises running without a
 * lifetime extender.
 *
 * Keeping the adapter check here — rather than in core — means core itself
 * has no Cloudflare-specific imports or code paths.
 */
export function generateWaitUntilModule(adapterName: string | undefined): string {
	if (adapterName === "@astrojs/cloudflare") {
		return `export { waitUntil } from "cloudflare:workers";`;
	}
	return `export const waitUntil = undefined;`;
}

/**
 * Generates the env virtual module.
 *
 * Under @astrojs/cloudflare, re-exports `env` from `cloudflare:workers` so
 * routes can read Worker bindings/secrets without touching
 * `Astro.locals.runtime.env`, which Astro 6+ removed (accessing it throws
 * rather than returning undefined, so `locals.runtime?.env` optional-chaining
 * doesn't help). For any other adapter, exports `undefined`. Callers that
 * need runtime secrets then prefer `process.env` over `import.meta.env`,
 * which Vite replaces with the environment present at build time. Mirrors
 * generateWaitUntilModule: core stays adapter-agnostic, with no direct
 * `cloudflare:workers` import that would fail to resolve under a Node build.
 */
export function generateEnvModule(adapterName: string | undefined): string {
	if (adapterName === "@astrojs/cloudflare") {
		return `export { env } from "cloudflare:workers";`;
	}
	return `export const env = undefined;`;
}

/**
 * Generates the build virtual module.
 *
 * Content-hashed `/_astro/*` names make the response depend on the build, not
 * only on the content. Exposing the build timestamp lets the middleware fold
 * that dimension into the cache validator, so a code-only deploy stops
 * answering conditional requests with 304 while the assets the cached HTML
 * references are already gone.
 */
export function generateBuildModule(buildTime: number): string {
	return `export const buildTime = ${buildTime};`;
}

/**
 * Generates the scheduler virtual module.
 *
 * Decides — at build time, from the Astro adapter — whether the runtime gets a
 * long-lived timer heartbeat. Cloudflare Workers have no persistent timers, so
 * the Worker's `scheduled()` handler drives `runScheduledTasks()` instead. In
 * local dev the long-lived Vite host invokes an EmDash-owned route that runs
 * the same maintenance inside workerd. Other adapters (Node, Bun) get a
 * `NodeCronScheduler` factory.
 *
 * Keeping the adapter check here — rather than in core's runtime — means the
 * runtime has no Cloudflare-specific code path; it just calls `createScheduler`
 * if one was injected. Mirrors the wait-until module's approach.
 */
export function generateSchedulerModule(adapterName: string | undefined): string {
	if (adapterName === "@astrojs/cloudflare") {
		return `// Cloudflare: an external platform event drives scheduled work.
export const createScheduler = null;
`;
	}
	return `// Long-lived runtime: drive scheduled work from an in-process timer.
import { NodeCronScheduler } from "emdash";

export function createScheduler(executor) {
	return new NodeCronScheduler(executor);
}
`;
}

/**
 * Generates the seed virtual module.
 * Reads the user's seed file at build time (in Node context) and embeds it,
 * so the runtime doesn't need filesystem access (required for workerd).
 *
 * Search order:
 *   1. `.emdash/seed.json`
 *   2. `package.json` → `emdash.seed` reference
 *   3. `seed/seed.json` (conventional template path)
 *
 * Exports `userSeed` (user's seed or null) and `seed` (user's seed or default).
 *
 * When no user seed is found, falls back to the built-in default seed and
 * (if `warnOnFallback` is true) logs a warning so misconfiguration is visible
 * during `astro dev`. Build/preview/sync stay silent so sites that
 * intentionally use the default seed (e.g. the blank template) don't
 * generate noisy logs.
 */
export function generateSeedModule(projectRoot: string, warnOnFallback = false): string {
	let userSeedJson: string | null = null;
	let mediaBasePath: string | undefined;

	// Try .emdash/seed.json
	try {
		const seedPath = resolve(projectRoot, ".emdash", "seed.json");
		const content = readFileSync(seedPath, "utf-8");
		JSON.parse(content); // validate
		userSeedJson = content;
		mediaBasePath = dirname(seedPath);
	} catch {
		// Not found, try next
	}

	// Try package.json → emdash.seed reference
	if (!userSeedJson) {
		try {
			const pkgPath = resolve(projectRoot, "package.json");
			const pkgContent = readFileSync(pkgPath, "utf-8");
			const pkg: { emdash?: { seed?: string } } = JSON.parse(pkgContent);

			if (pkg.emdash?.seed) {
				const seedPath = resolve(projectRoot, pkg.emdash.seed);
				const content = readFileSync(seedPath, "utf-8");
				JSON.parse(content); // validate
				userSeedJson = content;
				mediaBasePath = dirname(seedPath);
			}
		} catch {
			// Not found
		}
	}

	// Try conventional seed/seed.json fallback
	if (!userSeedJson) {
		try {
			const seedPath = resolve(projectRoot, "seed", "seed.json");
			const content = readFileSync(seedPath, "utf-8");
			JSON.parse(content); // validate
			userSeedJson = content;
			mediaBasePath = dirname(seedPath);
		} catch {
			// Not found
		}
	}

	if (userSeedJson) {
		return [
			`export const userSeed = ${userSeedJson};`,
			`export const seed = userSeed;`,
			`export const mediaBasePath = ${JSON.stringify(mediaBasePath)};`,
		].join("\n");
	}

	// No user seed — inline the default. Caller (the Vite plugin) gates this
	// to dev-only so production builds stay quiet for sites that intentionally
	// rely on the default seed.
	if (warnOnFallback) {
		console.warn(
			"[emdash] No user seed found at .emdash/seed.json, package.json#emdash.seed, or seed/seed.json. Falling back to the built-in default seed; the setup wizard will not offer demo content for this site.",
		);
	}
	return [
		`export const userSeed = null;`,
		`export const seed = ${JSON.stringify(defaultSeed)};`,
		`export const mediaBasePath = undefined;`,
	].join("\n");
}

/**
 * Resolve a module specifier from the project's context.
 * Uses Node.js require.resolve with the project root as base.
 */
function resolveModulePathFromProject(specifier: string, projectRoot: string): string {
	// Create require from the project's package.json location
	const projectPackageJson = resolve(projectRoot, "package.json");
	const require = createRequire(projectPackageJson);
	return require.resolve(specifier);
}

/**
 * Generates the sandboxed plugins module.
 * Resolves plugin entrypoints to files, reads them, and embeds the code.
 * Notifies the caller about each resolved entry so build tools can watch it.
 *
 * At runtime, middleware uses SandboxRunner to load these into isolates.
 */
export function generateSandboxedPluginsModule(
	sandboxed: PluginDescriptor[],
	projectRoot: string,
	onEntryResolved?: (filePath: string) => void,
): string {
	if (sandboxed.length === 0) {
		return `
// No sandboxed plugins configured
export const sandboxedPlugins = [];
`;
	}

	const pluginEntries: string[] = [];

	for (const descriptor of sandboxed) {
		const bundleSpecifier = descriptor.entrypoint;

		// Resolve the bundle to a file path using project's require context
		const filePath = resolveModulePathFromProject(bundleSpecifier, projectRoot);

		const ext = filePath.slice(filePath.lastIndexOf("."));
		if (TS_SOURCE_EXT_RE.test(ext)) {
			throw new Error(
				`Sandboxed plugin "${descriptor.id}" entrypoint "${bundleSpecifier}" resolves to ` +
					`unbuilt source (${filePath}). Sandbox entries must be pre-built JavaScript. ` +
					`Ensure the plugin's package.json exports point to built files (e.g. dist/*.mjs) ` +
					`and run the plugin's build step before building the site.`,
			);
		}

		onEntryResolved?.(filePath);

		const code = readFileSync(filePath, "utf-8");

		// Create the plugin entry with embedded code and sandbox config
		pluginEntries.push(`{
    id: ${JSON.stringify(descriptor.id)},
		displayName: ${JSON.stringify(descriptor.displayName)},
		description: ${JSON.stringify(descriptor.description)},
    version: ${JSON.stringify(descriptor.version)},
    options: ${JSON.stringify(descriptor.options ?? {})},
    capabilities: ${JSON.stringify(descriptor.capabilities ?? [])},
    allowedHosts: ${JSON.stringify(descriptor.allowedHosts ?? [])},
    storage: ${JSON.stringify(descriptor.storage ?? {})},
    mcp: ${JSON.stringify(descriptor.mcp)},
    routes: ${JSON.stringify(descriptor.routes ?? [])},
    hooks: ${JSON.stringify(descriptor.hooks ?? [])},
    adminPages: ${JSON.stringify(descriptor.adminPages ?? [])},
    adminWidgets: ${JSON.stringify(descriptor.adminWidgets ?? [])},
    editorPanels: ${JSON.stringify(descriptor.editorPanels ?? [])},
    editorActions: ${JSON.stringify(descriptor.editorActions ?? [])},
    settingsSchema: ${JSON.stringify(descriptor.settingsSchema)},
    portableTextBlocks: ${JSON.stringify(descriptor.portableTextBlocks ?? [])},
    fieldWidgets: ${JSON.stringify(descriptor.fieldWidgets ?? [])},
    adminEntry: ${JSON.stringify(descriptor.adminEntry)},
    // Code read from: ${filePath}
    code: ${JSON.stringify(code)},
  }`);
	}

	return `
// Auto-generated sandboxed plugins module
// Plugin code is embedded at build time

/**
 * Sandboxed plugin entries with embedded code.
 * Loaded at runtime via SandboxRunner.
 */
export const sandboxedPlugins = [
  ${pluginEntries.join(",\n  ")}
];
`;
}
