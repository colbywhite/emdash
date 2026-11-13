/**
 * Public media URL resolution.
 *
 * Used at render time by the Image components to decide whether a storage
 * key should be served from the configured `publicUrl` (R2 custom domain,
 * S3 CDN) or through the internal `/_emdash/api/media/file/{key}` route.
 */
import type { Storage } from "../storage/types.js";
import { INTERNAL_MEDIA_PREFIX } from "./normalize.js";

// Keys accepted by the public-URL rewrite: the `{ulid}{ext}` shape produced by
// the upload pipeline, with letters, digits, dots, dashes, and underscores.
// Slashes, `?`, `#`, and `%` are rejected so attacker-controlled content in a
// portable-text `asset.url` cannot traverse or reroute on the CDN origin.
const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/;
const QUERY_OR_FRAGMENT = /[?#]/;
const SITE_INTERNAL_MEDIA_RE = /^\/_emdash\/api\/site\/([^/]+)\/media\/file\/(.*)$/;

function mediaPrefixForSite(siteId?: string): string {
	return siteId
		? `/_emdash/api/site/${encodeURIComponent(siteId)}/media/file/`
		: INTERNAL_MEDIA_PREFIX;
}

/**
 * Build the internal file route URL for a storage key, encoding each path
 * segment so `?`, `#` and `%` stay inside the path. A key with an empty, `.` or
 * `..` segment is encoded whole, because the URL parser would collapse those
 * segments and move the request off the route. Mirrors the admin's
 * `localMediaFileUrl`.
 */
export function localMediaFileUrl(key: string, siteId?: string): string {
	const prefix = mediaPrefixForSite(siteId);
	const segments = key.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		return `${prefix}${encodeURIComponent(key)}`;
	}
	return `${prefix}${segments.map(encodeURIComponent).join("/")}`;
}

/**
 * The storage key named by a root-relative internal file route URL, the
 * inverse of {@link localMediaFileUrl}. Returns `null` for any other URL.
 */
export function storageKeyFromLocalMediaFileUrl(url: string): string | null {
	let path: string | null = null;
	if (url.startsWith(INTERNAL_MEDIA_PREFIX)) {
		path = url.slice(INTERNAL_MEDIA_PREFIX.length).split(QUERY_OR_FRAGMENT, 1)[0] ?? "";
	} else {
		const match = SITE_INTERNAL_MEDIA_RE.exec(url);
		if (match?.[2] !== undefined) {
			path = match[2].split(QUERY_OR_FRAGMENT, 1)[0] ?? "";
		}
	}
	if (path === null) return null;
	try {
		return decodeURIComponent(path) || null;
	} catch {
		return null;
	}
}

/**
 * Resolve the public URL for a locally stored media key. Returns an empty
 * string when no key is given. When a storage adapter is supplied, defers to
 * `storage.getPublicUrl()`; otherwise returns the internal proxy route.
 */
export function resolvePublicMediaUrl(
	storage: Storage | null | undefined,
	storageKey: string,
	siteId?: string,
): string {
	if (!storageKey) return "";
	if (storage) {
		const url = storage.getPublicUrl(storageKey);
		if (siteId && url.startsWith(INTERNAL_MEDIA_PREFIX)) {
			return `${mediaPrefixForSite(siteId)}${url.slice(INTERNAL_MEDIA_PREFIX.length)}`;
		}
		return url;
	}
	return `${mediaPrefixForSite(siteId)}${storageKey}`;
}

/**
 * Build the `getPublicMediaUrl` closure attached to `Astro.locals.emdash`.
 * Shared by the anonymous fast path and the full-runtime path in middleware.
 *
 * @internal
 */
export function createPublicMediaUrlResolver(
	storage: Storage | null | undefined,
	siteId?: string,
): (key: string) => string {
	return (key) => resolvePublicMediaUrl(storage, key, siteId);
}

/** Input shape for {@link buildRenderMediaUrl}. */
export interface RenderMediaRef {
	/** Storage key with extension (the canonical shape from the upload pipeline). */
	storageKey?: string;
	/** Pre-baked URL (either an internal proxy URL or an external URL). */
	url?: string;
	/** Bare media id (ULID without extension); only the internal proxy can look this up. */
	id?: string;
}

/**
 * Build a render-time media URL. Prefers `storageKey`, then rewrites an
 * internal `url` via `resolve`, then falls back to the internal proxy for a
 * bare `id`. External URLs and non-matching internal-looking URLs pass
 * through untouched. Returns `""` when nothing usable is present.
 *
 * @internal
 */
export function buildRenderMediaUrl(
	resolve: ((key: string) => string) | undefined,
	ref: RenderMediaRef,
	siteId?: string,
): string {
	const { storageKey, url, id } = ref;
	if (storageKey) {
		return resolve ? resolve(storageKey) : `${mediaPrefixForSite(siteId)}${storageKey}`;
	}
	if (url) {
		if (resolve) {
			if (url.startsWith(INTERNAL_MEDIA_PREFIX)) {
				const key = url.slice(INTERNAL_MEDIA_PREFIX.length);
				if (SAFE_STORAGE_KEY.test(key)) return resolve(key);
			}
			const siteMatch = SITE_INTERNAL_MEDIA_RE.exec(url);
			if (siteMatch?.[2] && SAFE_STORAGE_KEY.test(siteMatch[2])) {
				return resolve(siteMatch[2]);
			}
		}
		return url;
	}
	if (id) return `${mediaPrefixForSite(siteId)}${id}`;
	return "";
}
