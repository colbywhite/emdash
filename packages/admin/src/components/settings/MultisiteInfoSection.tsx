import { Badge, Button, Loader } from "@cloudflare/kumo";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { fetchMultisiteInfo, type MultisiteInfo } from "../../lib/api/multisite.js";
import { cn } from "../../lib/utils.js";
import { getMutationError } from "../DialogError.js";
import { SettingRow, SettingsSection } from "./SettingsLayout.js";

const CACHE_PARTITION_LABELS: Array<{
	key: keyof MultisiteInfo["cachePartitions"];
	label: MessageDescriptor;
}> = [
	{ key: "secrets", label: msg`Secrets` },
	{ key: "settings", label: msg`Settings` },
	{ key: "collectionSlugs", label: msg`Collection slugs` },
	{ key: "taxonomyDefs", label: msg`Taxonomy defs` },
	{ key: "bylineFieldDefs", label: msg`Byline fields` },
	{ key: "urlPatterns", label: msg`URL patterns` },
	{ key: "redirects", label: msg`Redirects` },
	{ key: "objectCache", label: msg`Object cache` },
];

export function MultisiteInfoSection() {
	const { t } = useLingui();
	const { data, isLoading, isFetching, error, refetch } = useQuery({
		queryKey: ["multisite-info"],
		queryFn: fetchMultisiteInfo,
	});

	return (
		<SettingsSection
			title={t`Multi-site information`}
			description={t`Runtime, database, storage, and cache isolation state for configured sites`}
			actions={
				<Button
					variant="secondary"
					size="sm"
					icon={<ArrowsClockwise className={cn(isFetching && "animate-spin")} aria-hidden="true" />}
					onClick={() => void refetch()}
					disabled={isFetching}
				>
					{t`Refresh`}
				</Button>
			}
		>
			{isLoading ? (
				<SettingRow>
					<div className="flex items-center gap-2 text-sm text-kumo-subtle">
						<Loader size="sm" />
						<span>{t`Loading multi-site diagnostics…`}</span>
					</div>
				</SettingRow>
			) : error ? (
				<SettingRow>
					<p className="text-sm text-kumo-danger">
						{getMutationError(error) || t`Failed to load multi-site diagnostics`}
					</p>
				</SettingRow>
			) : data ? (
				<>
					<SettingRow>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0">
								<p className="text-base font-medium leading-5">{t`Host & Admin Database`}</p>
								<p className="mt-1 text-sm text-kumo-subtle">
									{t`Active context:`}{" "}
									<code className="font-mono text-xs text-kumo-default">
										{data.activeSiteId ?? t`root (no active site)`}
									</code>
								</p>
								<p className="mt-0.5 text-sm text-kumo-subtle">
									{t`Admin DB cache key:`}{" "}
									<code className="font-mono text-xs text-kumo-default">
										{data.adminDb.cacheKey}
									</code>
								</p>
								{data.adminDb.failure ? (
									<p className="mt-1 text-sm text-kumo-danger">{data.adminDb.failure}</p>
								) : null}
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant="outline">
									{data.mode === "multi-site" ? t`Multi-site` : t`Single-site`}
								</Badge>
								<Badge variant={data.adminDb.initialized ? "success" : "secondary"}>
									{data.adminDb.initialized ? t`Admin DB ready` : t`Admin DB uninitialized`}
								</Badge>
							</div>
						</div>
					</SettingRow>

					{data.sites.map((site) => (
						<SettingRow key={site.id}>
							<div className="flex flex-col gap-3">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex min-w-0 items-center gap-2">
										<p className="truncate text-base font-medium leading-5">{site.name}</p>
										<Badge variant="outline" className="font-mono">
											{site.id}
										</Badge>
									</div>
									<div className="flex flex-wrap items-center gap-1.5">
										<Badge variant={site.runtimeInitialized ? "success" : "secondary"}>
											{site.runtimeInitialized ? t`Runtime initialized` : t`Runtime uninitialized`}
										</Badge>
										<Badge variant={site.dbInitialized ? "success" : "secondary"}>
											{site.dbInitialized ? t`DB ready` : t`DB uninitialized`}
										</Badge>
										<Badge variant={site.storageInitialized ? "success" : "secondary"}>
											{site.storageInitialized ? t`Storage ready` : t`Storage uninitialized`}
										</Badge>
										<Badge variant={site.setupVerified ? "success" : "neutral"}>
											{site.setupVerified ? t`Setup verified` : t`Setup unverified`}
										</Badge>
									</div>
								</div>

								<dl className="grid gap-2 text-sm sm:grid-cols-3">
									<div>
										<dt className="text-xs text-kumo-subtle">{t`Database`}</dt>
										<dd className="mt-0.5 font-mono text-xs text-kumo-default break-all">
											{site.dbBinding ?? site.dbEntrypoint ?? t`Not configured`}
										</dd>
										{site.dbBinding && site.dbEntrypoint ? (
											<dd className="mt-0.5 truncate text-xs text-kumo-subtle">
												{site.dbEntrypoint}
											</dd>
										) : null}
									</div>
									<div>
										<dt className="text-xs text-kumo-subtle">{t`Storage`}</dt>
										<dd className="mt-0.5 font-mono text-xs text-kumo-default break-all">
											{site.storageBinding ?? site.storageEntrypoint ?? t`Default / unset`}
										</dd>
										{site.storageBinding && site.storageEntrypoint ? (
											<dd className="mt-0.5 truncate text-xs text-kumo-subtle">
												{site.storageEntrypoint}
											</dd>
										) : null}
									</div>
									<div>
										<dt className="text-xs text-kumo-subtle">{t`Loaded plugins`}</dt>
										<dd className="mt-0.5 tabular-nums text-xs text-kumo-default">
											{site.loadedPlugins}
										</dd>
									</div>
								</dl>

								{site.initFailure ? (
									<p className="text-sm text-kumo-danger">{site.initFailure}</p>
								) : null}
							</div>
						</SettingRow>
					))}

					<SettingRow>
						<div className="grid gap-3">
							<p className="text-base font-medium leading-5">{t`Cache Partitions`}</p>
							<dl className="grid gap-2.5 sm:grid-cols-2">
								{CACHE_PARTITION_LABELS.map(({ key, label }) => {
									const keys = data.cachePartitions[key];
									return (
										<div key={key} className="flex items-start justify-between gap-3 text-sm">
											<dt className="text-start text-kumo-subtle">{t(label)}</dt>
											<dd className="flex flex-wrap justify-end gap-1">
												{keys.length > 0 ? (
													keys.map((partitionKey) => (
														<Badge key={partitionKey} variant="secondary" className="font-mono">
															{partitionKey}
														</Badge>
													))
												) : (
													<span className="text-xs text-kumo-subtle">{t`None`}</span>
												)}
											</dd>
										</div>
									);
								})}
							</dl>
						</div>
					</SettingRow>
				</>
			) : null}
		</SettingsSection>
	);
}
