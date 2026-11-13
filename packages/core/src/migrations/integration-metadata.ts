import type { DatabaseDescriptor } from "../db/adapters.js";
import { validateSecretFreeExecutorConfig } from "./manifest.js";

export const MIGRATION_CONFIG_SYMBOL = Symbol.for("emdash:migration-config");

export interface MigrationIntegrationSiteMetadata {
	id: string;
	database: Pick<DatabaseDescriptor, "type" | "migrations">;
}

export interface MigrationIntegrationMetadata {
	database?: Pick<DatabaseDescriptor, "type" | "migrations">;
	sites?: MigrationIntegrationSiteMetadata[];
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isDatabaseMetadata(database: unknown): boolean {
	if (!isRecord(database) || (database.type !== "sqlite" && database.type !== "postgres")) {
		return false;
	}
	const migrations = database.migrations;
	return (
		migrations === undefined ||
		(isRecord(migrations) &&
			typeof migrations.entrypoint === "string" &&
			Object.hasOwn(migrations, "manifestConfig"))
	);
}

function isMigrationIntegrationMetadata(value: unknown): value is MigrationIntegrationMetadata {
	if (!isRecord(value)) return false;
	if (value.database !== undefined && !isDatabaseMetadata(value.database)) {
		return false;
	}
	if (value.sites !== undefined) {
		if (!Array.isArray(value.sites)) return false;
		for (const site of value.sites) {
			if (!isRecord(site) || typeof site.id !== "string" || !isDatabaseMetadata(site.database)) {
				return false;
			}
		}
	}
	return true;
}

function serializeDatabaseMetadata(
	database: DatabaseDescriptor,
	path: string,
): Pick<DatabaseDescriptor, "type" | "migrations"> {
	return {
		type: database.type,
		migrations: database.migrations
			? {
					entrypoint: database.migrations.entrypoint,
					manifestConfig: validateSecretFreeExecutorConfig(
						database.migrations.manifestConfig,
						path,
					),
				}
			: undefined,
	};
}

export function createMigrationIntegrationMetadata(
	database?: DatabaseDescriptor,
	sites?: ReadonlyArray<{ id: string; database: DatabaseDescriptor }>,
): MigrationIntegrationMetadata {
	const metadata: MigrationIntegrationMetadata = {};
	if (database) {
		metadata.database = serializeDatabaseMetadata(database, "database.migrations.manifestConfig");
	}
	if (sites?.length) {
		metadata.sites = sites.map((site, index) => ({
			id: site.id,
			database: serializeDatabaseMetadata(
				site.database,
				`sites[${index}].database.migrations.manifestConfig`,
			),
		}));
	}
	return metadata;
}

export function getMigrationIntegrationMetadata(
	integration: unknown,
): MigrationIntegrationMetadata | undefined {
	if (
		(typeof integration !== "object" || integration === null) &&
		typeof integration !== "function"
	) {
		return undefined;
	}
	if (!Object.hasOwn(integration, MIGRATION_CONFIG_SYMBOL)) {
		return undefined;
	}

	const metadata: unknown = Reflect.get(integration, MIGRATION_CONFIG_SYMBOL);
	return isMigrationIntegrationMetadata(metadata) ? metadata : undefined;
}
