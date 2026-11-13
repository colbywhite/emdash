/**
 * Pure URL and header helpers for multi-site request resolution.
 *
 * Kept free of `astro:*` and `virtual:emdash/*` imports so middleware, auth,
 * write-fence, and unit tests can share one canonical routing contract.
 */

import {
	type EmDashConfig,
	type EmDashSiteConfig,
	resolveSiteConfig,
} from "./integration/runtime.js";

const ADMIN_SITE_PREFIX = "/_emdash/admin/site/";
const API_SITE_PREFIX = "/_emdash/api/site/";
const DOMAIN_PROOF_PATH = "/_emdash/api/site/domain-proof";

const NON_SITE_SCOPED_API_EXACT = new Set([
	"/_emdash/api/health",
	"/_emdash/api/openapi.json",
	"/_emdash/api/manifest",
	"/_emdash/api/admin/multisite-info",
	"/_emdash/api/admin/core-update",
	"/_emdash/api/typegen",
	"/_emdash/api/themes/preview",
	"/_emdash/api/visual-editing/toolbar-labels",
	"/_emdash/api/visual-editing/action-token",
]);

const NON_SITE_SCOPED_API_PREFIXES = [
	"/_emdash/api/setup",
	"/_emdash/api/auth",
	"/_emdash/api/oauth",
	"/_emdash/api/admin/users",
	"/_emdash/api/admin/api-tokens",
	"/_emdash/api/admin/oauth-clients",
	"/_emdash/api/admin/allowed-domains",
	"/_emdash/api/admin/themes/marketplace",
	"/_emdash/api/dev",
];

function stripTrailingSlash(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export interface ParsedAdminSitePath {
	siteId: string;
	restPathname: string;
}

export function parseAdminSitePath(pathname: string): ParsedAdminSitePath | null {
	if (!pathname.startsWith(ADMIN_SITE_PREFIX)) return null;
	const rest = pathname.slice(ADMIN_SITE_PREFIX.length);
	if (!rest) return null;
	const slashIndex = rest.indexOf("/");
	if (slashIndex === -1) {
		return { siteId: rest, restPathname: "/_emdash/admin" };
	}
	const siteId = rest.slice(0, slashIndex);
	if (!siteId) return null;
	return {
		siteId,
		restPathname: `/_emdash/admin${rest.slice(slashIndex)}`,
	};
}

export interface ParsedSiteApiPath {
	siteId: string;
	normalizedPathname: string;
}

export function parseSiteApiPath(pathname: string): ParsedSiteApiPath | null {
	if (stripTrailingSlash(pathname) === DOMAIN_PROOF_PATH) return null;
	if (!pathname.startsWith(API_SITE_PREFIX)) return null;
	const rest = pathname.slice(API_SITE_PREFIX.length);
	if (!rest) return null;
	const slashIndex = rest.indexOf("/");
	if (slashIndex === -1) {
		return { siteId: rest, normalizedPathname: "/_emdash/api" };
	}
	const siteId = rest.slice(0, slashIndex);
	if (!siteId) return null;
	return {
		siteId,
		normalizedPathname: `/_emdash/api${rest.slice(slashIndex)}`,
	};
}

export function normalizeSiteApiPathname(pathname: string): string {
	return parseSiteApiPath(pathname)?.normalizedPathname ?? pathname;
}

export function isSiteScopedApiPath(pathname: string): boolean {
	const normalized = stripTrailingSlash(normalizeSiteApiPathname(pathname));
	if (!normalized.startsWith("/_emdash/api/") && normalized !== "/_emdash/api") {
		return false;
	}
	if (NON_SITE_SCOPED_API_EXACT.has(normalized)) return false;
	if (
		NON_SITE_SCOPED_API_PREFIXES.some(
			(prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
		)
	) {
		return false;
	}
	return true;
}

export interface ResolvedActiveSite {
	id: string;
	name: string;
	config: EmDashSiteConfig;
}

export function findConfiguredSite(
	config: EmDashConfig | null | undefined,
	siteId: string,
): ResolvedActiveSite | null {
	const matched = config?.sites?.find((entry) => entry.id === siteId);
	if (!matched || !config) return null;
	return {
		id: matched.id,
		name: matched.name,
		config: resolveSiteConfig(config, matched),
	};
}

export type SiteResolutionResult =
	| {
			ok: true;
			site?: ResolvedActiveSite;
			rewrittenApiPathname?: string;
	  }
	| {
			ok: false;
			status: 400 | 404;
			code: string;
			message: string;
	  };

export function resolveSiteForRequest(
	pathname: string,
	headerSiteIdRaw: string | null | undefined,
	config: EmDashConfig | null | undefined,
	imageHrefSiteId?: string | null,
): SiteResolutionResult {
	const hasSites = Boolean(config?.sites?.length);
	const headerSiteId = headerSiteIdRaw?.trim() || null;

	const adminSite = parseAdminSitePath(pathname);
	if (adminSite) {
		if (!hasSites) {
			return {
				ok: false,
				status: 404,
				code: "SITE_NOT_FOUND",
				message: `Unknown site "${adminSite.siteId}"`,
			};
		}
		const resolved = findConfiguredSite(config, adminSite.siteId);
		if (!resolved) {
			return {
				ok: false,
				status: 404,
				code: "SITE_NOT_FOUND",
				message: `Unknown site "${adminSite.siteId}"`,
			};
		}
		return { ok: true, site: resolved };
	}

	const apiSite = parseSiteApiPath(pathname);
	if (
		apiSite ||
		pathname.startsWith("/_emdash/api") ||
		pathname.startsWith("/_emdash/.well-known")
	) {
		if (apiSite && headerSiteId && apiSite.siteId !== headerSiteId) {
			return {
				ok: false,
				status: 400,
				code: "SITE_CONFLICT",
				message: `Conflicting site identifiers: URL "${apiSite.siteId}" vs X-EmDash-Site "${headerSiteId}"`,
			};
		}
		const requestedSiteId = apiSite?.siteId ?? headerSiteId;
		if (requestedSiteId !== null) {
			if (!hasSites) {
				return {
					ok: false,
					status: 404,
					code: "SITE_NOT_FOUND",
					message: `Unknown site "${requestedSiteId}"`,
				};
			}
			const resolved = findConfiguredSite(config, requestedSiteId);
			if (!resolved) {
				return {
					ok: false,
					status: 404,
					code: "SITE_NOT_FOUND",
					message: `Unknown site "${requestedSiteId}"`,
				};
			}
			return {
				ok: true,
				site: resolved,
				...(apiSite ? { rewrittenApiPathname: apiSite.normalizedPathname } : {}),
			};
		}
		if (hasSites && isSiteScopedApiPath(pathname)) {
			return {
				ok: false,
				status: 400,
				code: "SITE_REQUIRED",
				message:
					"Site ID is required for this endpoint when multi-site mode is enabled (use /_emdash/api/site/{siteId}/... or X-EmDash-Site header)",
			};
		}
		return { ok: true };
	}

	if (imageHrefSiteId) {
		if (!hasSites) {
			return {
				ok: false,
				status: 404,
				code: "SITE_NOT_FOUND",
				message: `Unknown site "${imageHrefSiteId}"`,
			};
		}
		const resolved = findConfiguredSite(config, imageHrefSiteId);
		if (!resolved) {
			return {
				ok: false,
				status: 404,
				code: "SITE_NOT_FOUND",
				message: `Unknown site "${imageHrefSiteId}"`,
			};
		}
		return { ok: true, site: resolved };
	}

	return { ok: true };
}
