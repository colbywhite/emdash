import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";
import type { EmDashRuntime } from "../emdash-runtime.js";
import { createInitLock, type InitLock } from "../utils/init-lock.js";

// SSR chunks and the dev-server plugin must share the same runtime and init locks.
const RUNTIME_HOLDER_KEY = Symbol.for("emdash:runtime-holder");
const store = globalThis as Record<symbol, unknown>;

export interface RuntimeSlot {
	instance: EmDashRuntime | null;
	lock: InitLock;
}

export interface RuntimeHolder {
	slots: Map<string, RuntimeSlot>;
	adminDb: Kysely<Database> | null;
	adminDbLock: InitLock;
	closed: boolean;
}

export function getRuntimeHolder(): RuntimeHolder {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- private globalThis symbol slot
	let holder = store[RUNTIME_HOLDER_KEY] as RuntimeHolder | undefined;
	if (!holder || !(holder.slots instanceof Map)) {
		holder = {
			slots: new Map<string, RuntimeSlot>(),
			adminDb: null,
			adminDbLock: createInitLock(),
			closed: false,
		};
		store[RUNTIME_HOLDER_KEY] = holder;
	}
	return holder;
}

export function getRuntimeSlot(holder: RuntimeHolder, key: string): RuntimeSlot {
	let slot = holder.slots.get(key);
	if (!slot) {
		slot = { instance: null, lock: createInitLock() };
		holder.slots.set(key, slot);
	}
	return slot;
}

export async function shutdownRuntime(): Promise<void> {
	delete store[Symbol.for("emdash:plugins")];
	delete store[Symbol.for("emdash:storage-cache")];
	delete store[Symbol.for("emdash:storage-cache:entrypoints")];
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- private globalThis symbol slot
	const holder = store[RUNTIME_HOLDER_KEY] as RuntimeHolder | undefined;
	if (!holder) return;

	// Detach before awaiting so the next server cannot reuse a closing runtime.
	holder.closed = true;
	delete store[RUNTIME_HOLDER_KEY];

	const runtimes =
		holder.slots instanceof Map
			? Array.from(holder.slots.values(), (slot) => slot.instance).filter(
					(instance): instance is EmDashRuntime => instance !== null,
				)
			: [];
	if (holder.slots instanceof Map) {
		for (const slot of holder.slots.values()) {
			slot.instance = null;
		}
		holder.slots.clear();
	}
	const adminDb = holder.adminDb;
	holder.adminDb = null;

	let firstError: unknown;
	for (const runtime of runtimes) {
		try {
			await runtime.shutdown();
		} catch (error) {
			console.error("[emdash] runtime shutdown failed:", error);
			firstError ??= error;
		}
	}
	if (adminDb) {
		await adminDb.destroy().catch(() => {});
	}
	if (firstError !== undefined) {
		throw firstError;
	}
}
