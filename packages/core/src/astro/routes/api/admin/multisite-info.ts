/**
 * Multi-site diagnostics endpoint
 *
 * GET /_emdash/api/admin/multisite-info
 *
 * Returns non-sensitive runtime, database, storage, and cache-partition
 * diagnostics for multi-site deployments.
 */

import { Role } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";

import { getStorageCacheKeys } from "../../../../emdash-runtime.js";
import { getRequestContext } from "../../../../request-context.js";
import { getRuntimeHolder } from "../../../runtime-holder.js";

export const prerender = false;

const DB_HOLDER_KEY = Symbol.for("emdash:db-cache");
const SETUP_VERIFIED_KEY = Symbol.for("emdash:setup-verified");
const DB_INIT_FAILURE_BACKOFF_MS = 30_000;

const CACHE_SYMBOLS = {
	secrets: Symbol.for("@emdash-cms/core/secrets-cache@2"),
	settings: Symbol.for("emdash:site-settings:swr"),
	collectionSlugs: Symbol.for("emdash:collection-slugs@2"),
	taxonomyDefs: Symbol.for("emdash:taxonomy-defs:swr"),
	bylineFieldDefs: Symbol.for("emdash:byline-field-defs"),
	urlPatterns: Symbol.for("emdash:url-pattern-cache"),
	redirects: Symbol.for("emdash:redirect-cache"),
	objectCache: Symbol.for("emdash:object-cache:backend"),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readBindingName(config: unknown): string | undefined {
	if (!isRecord(config)) return undefined;
	return typeof config.binding === "string" && config.binding ? config.binding : undefined;
}

function activeFailureMessage(
	failures: Map<unknown, unknown> | undefined,
	key: string,
): string | undefined {
	const failure = failures?.get(key);
	if (!isRecord(failure)) return undefined;
	if (typeof failure.at !== "number" || typeof failure.message !== "string") return undefined;
	if (Date.now() - failure.at >= DB_INIT_FAILURE_BACKOFF_MS) return undefined;
	return failure.message;
}

function isSetupKeyVerified(raw: unknown, key: string): boolean {
	if (raw instanceof Set) {
		return raw.has(key);
	}
	return key === "default" && raw === true;
}

function readCachePartitionKeys(
	symbol: symbol,
	isSinglePopulated: (value: Record<string, unknown>) => boolean,
): string[] {
	const value = (globalThis as Record<symbol, unknown>)[symbol];
	if (value === undefined || value === null) return [];
	if (value instanceof Map) {
		return Array.from(value.keys(), (key) => String(key)).toSorted();
	}
	if (!isRecord(value)) return [];
	if (value.bySite instanceof Map) {
		return Array.from(value.bySite.keys(), (key) => String(key)).toSorted();
	}
	if (value.requestScopedBySite instanceof Map) {
		return Array.from(value.requestScopedBySite.keys(), (key) => String(key)).toSorted();
	}
	return isSinglePopulated(value) ? ["default"] : [];
}

function readActiveSiteId(ctx: unknown): string | null {
	if (!isRecord(ctx)) return null;
	const site = ctx.site;
	if (!isRecord(site)) return null;
	return typeof site.id === "string" ? site.id : null;
}

function readDbHolder(raw: unknown): {
	cache?: Map<unknown, unknown>;
	failures?: Map<unknown, unknown>;
} {
	if (!isRecord(raw)) return {};
	const cache = raw.cache instanceof Map ? raw.cache : undefined;
	const failures = raw.failures instanceof Map ? raw.failures : undefined;
	return { cache, failures };
}

function readRuntimeSlots(raw: unknown): Map<unknown, unknown> | undefined {
	if (!isRecord(raw)) return undefined;
	return raw.slots instanceof Map ? raw.slots : undefined;
}

function readLoadedPluginCount(slot: unknown): number {
	if (!isRecord(slot) || !isRecord(slot.instance)) return 0;
	const configured = Array.isArray(slot.instance.configuredPlugins)
		? slot.instance.configuredPlugins.length
		: 0;
	const sandboxed = Array.isArray(slot.instance.sandboxedPluginEntries)
		? slot.instance.sandboxedPluginEntries.length
		: 0;
	return configured + sandboxed;
}

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	if (!emdash) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "settings:read");
	if (denied) return denied;
	if (!user || user.role < Role.ADMIN) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}

	try {
		const sitesConfig = emdash.config.sites ?? [];
		const mode = sitesConfig.length > 0 ? "multi-site" : "single-site";
		const activeSiteId = readActiveSiteId(getRequestContext());

		const store = globalThis as Record<symbol, unknown>;
		const runtimeSlots = readRuntimeSlots(getRuntimeHolder());
		const dbHolder = readDbHolder(store[DB_HOLDER_KEY]);
		const dbCache = dbHolder.cache;
		const dbFailures = dbHolder.failures;
		const storageKeys = new Set(getStorageCacheKeys());
		const setupVerifiedRaw = store[SETUP_VERIFIED_KEY];

		const adminCacheKey = mode === "multi-site" ? "admin" : "default";
		const adminLookupKey =
			mode === "multi-site" ? "admin" : (emdash.config.database?.entrypoint ?? "default");

		const adminDb = {
			initialized: dbCache ? dbCache.has(adminLookupKey) : false,
			cacheKey: adminCacheKey,
			...(activeFailureMessage(dbFailures, adminLookupKey)
				? { failure: activeFailureMessage(dbFailures, adminLookupKey) }
				: {}),
		};

		const sites = sitesConfig.map((site) => {
			const slotKey = `site:${site.id}`;
			const slot = runtimeSlots?.get(slotKey);
			const runtimeInitialized = isRecord(slot) && isRecord(slot.instance);
			const loadedPlugins = readLoadedPluginCount(slot);
			const initFailure = activeFailureMessage(dbFailures, slotKey);
			const dbBinding = readBindingName(site.database?.config);
			const storageBinding = readBindingName(site.storage?.config);

			return {
				id: site.id,
				name: site.name,
				...(site.database?.entrypoint ? { dbEntrypoint: site.database.entrypoint } : {}),
				...(dbBinding ? { dbBinding } : {}),
				...(site.storage?.entrypoint ? { storageEntrypoint: site.storage.entrypoint } : {}),
				...(storageBinding ? { storageBinding } : {}),
				runtimeInitialized,
				dbInitialized: dbCache ? dbCache.has(slotKey) : false,
				storageInitialized: storageKeys.has(slotKey),
				setupVerified: isSetupKeyVerified(setupVerifiedRaw, slotKey),
				loadedPlugins,
				...(initFailure ? { initFailure } : {}),
			};
		});

		const cachePartitions = {
			secrets: readCachePartitionKeys(CACHE_SYMBOLS.secrets, (v) => v.requestScoped !== undefined),
			settings: readCachePartitionKeys(
				CACHE_SYMBOLS.settings,
				(v) => v.snapshot !== null && v.snapshot !== undefined,
			),
			collectionSlugs: readCachePartitionKeys(
				CACHE_SYMBOLS.collectionSlugs,
				(v) => typeof v.fetchedAt === "number" && v.fetchedAt > 0,
			),
			taxonomyDefs: readCachePartitionKeys(
				CACHE_SYMBOLS.taxonomyDefs,
				(v) => v.snapshot !== null && v.snapshot !== undefined,
			),
			bylineFieldDefs: readCachePartitionKeys(
				CACHE_SYMBOLS.bylineFieldDefs,
				(v) => v.hasValue === true,
			),
			urlPatterns: readCachePartitionKeys(
				CACHE_SYMBOLS.urlPatterns,
				(v) => v.patterns !== null && v.patterns !== undefined,
			),
			redirects: readCachePartitionKeys(
				CACHE_SYMBOLS.redirects,
				(v) => v.redirects !== null && v.redirects !== undefined,
			),
			objectCache: readCachePartitionKeys(CACHE_SYMBOLS.objectCache, (v) => v.initialized === true),
		};

		return apiSuccess({
			mode,
			activeSiteId,
			adminDb,
			sites,
			cachePartitions,
		});
	} catch (error) {
		return handleError(error, "Failed to collect multi-site diagnostics", "MULTISITE_INFO_ERROR");
	}
};
