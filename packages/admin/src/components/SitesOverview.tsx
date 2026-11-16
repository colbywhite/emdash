import { LayerCard, Table } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import * as React from "react";

import { getAdminBasepath } from "../lib/site-path.js";

export interface SiteDirectoryEntry {
	id: string;
	name: string;
}

export interface SitesOverviewProps {
	sites: readonly SiteDirectoryEntry[];
}

export function SitesOverview({ sites }: SitesOverviewProps) {
	const { t } = useLingui();

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-semibold leading-tight text-kumo-default">{t`Sites`}</h1>

			<LayerCard className="overflow-x-auto p-0">
				<Table className="text-start [:where(&)_th]:text-start">
					<Table.Header>
						<Table.Row>
							<Table.Head>{t`Name`}</Table.Head>
							<Table.Head>{t`ID`}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{sites.map((site) => (
							<Table.Row key={site.id}>
								<Table.Cell className="font-medium">
									<a
										href={getAdminBasepath(site.id)}
										className="text-kumo-default underline-offset-4 hover:underline"
									>
										{site.name}
									</a>
								</Table.Cell>
								<Table.Cell className="font-mono text-sm text-kumo-subtle">
									<bdi dir="ltr">{site.id}</bdi>
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</LayerCard>
		</div>
	);
}
