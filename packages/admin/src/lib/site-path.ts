export const ADMIN_BASEPATH = "/_emdash/admin";
export const ADMIN_SITES_PREFIX = "/_emdash/admin/sites/";

export function parseAdminSiteId(pathname: string): string | null {
	if (!pathname.startsWith(ADMIN_SITES_PREFIX)) return null;
	const rest = pathname.slice(ADMIN_SITES_PREFIX.length);
	if (!rest) return null;
	const slashIndex = rest.indexOf("/");
	const rawSiteId = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
	if (!rawSiteId) return null;
	try {
		return decodeURIComponent(rawSiteId);
	} catch {
		return rawSiteId;
	}
}

export function getActiveAdminSiteId(): string | null {
	if (typeof window === "undefined") return null;
	return parseAdminSiteId(window.location.pathname);
}

export function getAdminBasepath(siteId?: string | null): string {
	return siteId ? `${ADMIN_SITES_PREFIX}${encodeURIComponent(siteId)}` : ADMIN_BASEPATH;
}

export function isAdminSitePath(pathname: string): boolean {
	return pathname.startsWith(ADMIN_SITES_PREFIX);
}
