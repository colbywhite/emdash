import { z } from "astro/zod";

import { URL_SLUG_PATTERN } from "../utils/url-slug.js";
import type { FieldDefinition, FieldUIHints } from "./types.js";

export interface SlugOptions {
	required?: boolean;
	from?: string; // Field name to generate slug from
	pattern?: RegExp;
	helpText?: string;
}

/**
 * Slug field - URL-safe identifier
 */
export function slug(options: SlugOptions = {}): FieldDefinition<string> {
	const pattern = options.pattern || URL_SLUG_PATTERN;
	const stringSchema = z.string().regex(pattern, "Invalid slug format");

	// Optional vs required
	const schema: z.ZodType = options.required ? stringSchema : stringSchema.optional();

	const ui: FieldUIHints = {
		widget: "slug",
		helpText: options.helpText || "URL-safe identifier (lowercase, hyphens only)",
		from: options.from,
	};

	return {
		type: "slug",
		columnType: "TEXT",
		schema,
		options,
		ui,
	};
}
