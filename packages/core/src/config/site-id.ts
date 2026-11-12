import { z } from "zod";

import { isValidUrlSlug } from "../utils/url-slug.js";

export type SiteId = string;

export const BLACKLISTED_SITE_IDS = [
	"admin",
	"api",
	"auth",
	"default",
	"dev",
	"device",
	"emdash",
	"health",
	"internal",
	"invite",
	"login",
	"logout",
	"manifest",
	"mcp",
	"oauth",
	"setup",
	"signup",
	"site",
	"sites",
	"well-known",
] as const;

export type BlacklistedSiteId = (typeof BLACKLISTED_SITE_IDS)[number];

const BLACKLISTED_SITE_ID_SET: ReadonlySet<string> = new Set(BLACKLISTED_SITE_IDS);

export function isBlacklistedSiteId(value: string): value is BlacklistedSiteId {
	return BLACKLISTED_SITE_ID_SET.has(value);
}

export function isValidSiteId(value: unknown): value is SiteId {
	return isValidUrlSlug(value) && !isBlacklistedSiteId(value);
}

export const siteIdSchema = z.string().superRefine((id, ctx) => {
	if (!isValidUrlSlug(id)) {
		ctx.addIssue({
			code: "custom",
			message:
				'Site ID must be a URL-safe slug (lowercase letters, numbers, and single hyphens, e.g. "my-site")',
		});
		return;
	}
	if (isBlacklistedSiteId(id)) {
		ctx.addIssue({
			code: "custom",
			message: `"${id}" is a reserved term and cannot be used as a site ID`,
		});
	}
});
