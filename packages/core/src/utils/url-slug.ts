/**
 * ASCII URL slug rule: lowercase letters and digits separated by single hyphens.
 */

export const URL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidUrlSlug(value: unknown): value is string {
	return typeof value === "string" && URL_SLUG_PATTERN.test(value);
}
