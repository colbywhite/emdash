/**
 * Multi-site diagnostics API
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse } from "./client.js";

export interface MultisiteSiteDiagnostics {
	id: string;
	name: string;
	dbEntrypoint?: string;
	dbBinding?: string;
	storageEntrypoint?: string;
	storageBinding?: string;
	runtimeInitialized: boolean;
	dbInitialized: boolean;
	storageInitialized: boolean;
	setupVerified: boolean;
	loadedPlugins: number;
	initFailure?: string;
}

export interface MultisiteInfo {
	mode: "multi-site" | "single-site";
	activeSiteId: string | null;
	adminDb: {
		initialized: boolean;
		cacheKey: string;
		failure?: string;
	};
	sites: MultisiteSiteDiagnostics[];
	cachePartitions: {
		secrets: string[];
		settings: string[];
		collectionSlugs: string[];
		taxonomyDefs: string[];
		bylineFieldDefs: string[];
		urlPatterns: string[];
		redirects: string[];
		objectCache: string[];
	};
}

/**
 * Fetch runtime, database, storage, and cache diagnostics for multi-site mode.
 */
export async function fetchMultisiteInfo(): Promise<MultisiteInfo> {
	const response = await apiFetch(`${API_BASE}/admin/multisite-info`);
	return parseApiResponse<MultisiteInfo>(
		response,
		i18n._(msg`Failed to fetch multi-site diagnostics`),
	);
}
