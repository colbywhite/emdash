import { getActiveSiteKey } from "./request-context.js";

export { getActiveSiteKey };

/**
 * Resolve a site-partitioned holder stored on `globalThis` under `symbol`.
 * The slot holds a `Map<string, T>` keyed by `siteKey` (defaulting to
 * `getActiveSiteKey()`, i.e. `site.id` or `"default"`).
 */
export function getSiteScopedHolder<T>(
	symbol: symbol,
	create: () => T,
	siteKey = getActiveSiteKey(),
): T {
	const store = globalThis as Record<symbol, unknown>;
	let map = store[symbol];
	if (!(map instanceof Map)) {
		map = new Map<string, T>();
		store[symbol] = map;
	}
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis symbol slot holds Map<string, T>
	const typedMap = map as Map<string, T>;
	let entry = typedMap.get(siteKey);
	if (entry === undefined) {
		entry = create();
		typedMap.set(siteKey, entry);
	}
	return entry;
}
