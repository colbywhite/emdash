/**
 * EmDash Admin React Application
 *
 * This is the main entry point for the admin SPA.
 * Uses TanStack Router for client-side routing and TanStack Query for data fetching.
 *
 * Plugin admin components are passed via the pluginAdmins prop and made
 * available throughout the app via PluginAdminContext.
 */

import { LinkProvider, Toasty, type LinkComponentProps } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import type { Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, RouterProvider, type LinkProps } from "@tanstack/react-router";
import * as React from "react";

import { ThemeProvider } from "./components/ThemeProvider";
import { AdminBrandingProvider, type AdminBranding } from "./lib/admin-branding-context";
import { refetchCurrentUserOnForbidden } from "./lib/api/current-user";
import { AuthProviderProvider, type AuthProviders } from "./lib/auth-provider-context";
import { PluginAdminProvider, type PluginAdmins } from "./lib/plugin-context";
import { getActiveAdminSiteId, getAdminBasepath, isAdminSitePath } from "./lib/site-path.js";
import { getLoadedDateLocale, waitForDateLocale } from "./locales/date-locale.js";
import { LocaleDirectionProvider } from "./locales/index.js";
import { KumoTranslationsProvider } from "./locales/KumoTranslationsProvider.js";
import { createAdminRouter } from "./router";

interface SiteRouterEntry {
	queryClient: QueryClient;
	router: ReturnType<typeof createAdminRouter>;
}

const siteRouterCache = new Map<string, SiteRouterEntry>();

export function getSiteRouterEntry(siteId: string | null): SiteRouterEntry {
	const cacheKey = siteId ? `site:${siteId}` : "root";
	const existing = siteRouterCache.get(cacheKey);
	if (existing) return existing;

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 1000 * 60, // 1 minute
				retry: 1,
			},
		},
	});

	refetchCurrentUserOnForbidden(queryClient);

	const router = createAdminRouter(queryClient, getAdminBasepath(siteId));
	const entry = { queryClient, router };
	siteRouterCache.set(cacheKey, entry);
	return entry;
}

const DATE_LOCALE_BOOT_TIMEOUT_MS = 3000;

export function normalizeAdminHref(
	href: string,
	siteId: string | null = getActiveAdminSiteId(),
): string {
	const basepath = getAdminBasepath(siteId);
	if (!siteId && isAdminSitePath(href)) return "";
	if (href === basepath) return "/";
	if (href.startsWith(`${basepath}/`)) return href.slice(basepath.length);
	if (href.startsWith(`${basepath}?`) || href.startsWith(`${basepath}#`)) {
		return `/${href.slice(basepath.length)}`;
	}
	if (href.startsWith("/_emdash/")) return "";
	return href;
}

export function getAnchorHref(
	destination: string,
	routerDestination: string,
	siteId: string | null = getActiveAdminSiteId(),
): string {
	if (routerDestination.startsWith("/") && !routerDestination.startsWith("//")) {
		const basepath = getAdminBasepath(siteId);
		if (
			routerDestination === "/" ||
			routerDestination.startsWith("/?") ||
			routerDestination.startsWith("/#")
		) {
			return `${basepath}${routerDestination.slice(1)}`;
		}
		return `${basepath}${routerDestination}`;
	}
	return destination;
}

export const KumoRouterLink = React.forwardRef<HTMLAnchorElement, LinkComponentProps>(
	({ href, to, target, download, children, ...props }, ref) => {
		const siteId = getActiveAdminSiteId();
		const destination = href ?? to ?? "";
		const hasSearchOrHash = destination.includes("?") || destination.includes("#");
		const routerDestination = normalizeAdminHref(destination, siteId);
		const isRouterPath = routerDestination.startsWith("/") && !routerDestination.startsWith("//");
		const shouldUseAnchor = !isRouterPath || hasSearchOrHash || target || download != null;
		const linkProps = props as LinkComponentProps & {
			"aria-current"?: React.AriaAttributes["aria-current"];
			"data-active"?: boolean | string;
		};
		const ariaCurrent =
			linkProps["aria-current"] ?? (linkProps["data-active"] ? "page" : undefined);

		if (shouldUseAnchor) {
			const anchorHref =
				hasSearchOrHash && !target && download == null
					? getAnchorHref(destination, routerDestination, siteId)
					: destination;
			return (
				<a ref={ref} href={anchorHref} target={target} download={download} {...props}>
					{children}
				</a>
			);
		}

		return (
			<Link
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kumo provides runtime hrefs; TanStack requires literal route types.
				{...(props as Omit<LinkProps, "to" | "children">)}
				ref={ref}
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kumo provides runtime hrefs; TanStack requires literal route types.
				to={routerDestination as "/"}
				aria-current={ariaCurrent}
			>
				{children}
			</Link>
		);
	},
);

KumoRouterLink.displayName = "KumoRouterLink";

export interface AdminAppProps {
	/** Plugin admin modules keyed by plugin ID */
	pluginAdmins?: PluginAdmins;
	/** Auth provider UI modules keyed by provider ID */
	authProviders?: AuthProviders;
	/** Configured admin white-label branding (logo, site name) */
	adminBranding?: AdminBranding;
	/** Active locale code */
	locale?: string;
	/** Compiled Lingui messages for the active locale */
	messages?: Messages;
}

/**
 * Main Admin Application
 */
const EMPTY_PLUGINS: PluginAdmins = {};
const EMPTY_AUTH_PROVIDERS: AuthProviders = {};
const EMPTY_ADMIN_BRANDING: AdminBranding = {};

export function AdminApp({
	pluginAdmins = EMPTY_PLUGINS,
	authProviders = EMPTY_AUTH_PROVIDERS,
	adminBranding = EMPTY_ADMIN_BRANDING,
	locale = "en",
	messages = {},
}: AdminAppProps) {
	// Date locales can't be serialized from the server, so the first render waits
	// for the active one. Otherwise calendars would render with the US week start
	// and then shift. The timeout keeps a stalled request from blocking the admin.
	const [dateLocaleReady, setDateLocaleReady] = React.useState(
		() => getLoadedDateLocale(locale) !== undefined,
	);
	React.useEffect(() => {
		if (dateLocaleReady) return;
		let active = true;
		void (async () => {
			await waitForDateLocale(locale, DATE_LOCALE_BOOT_TIMEOUT_MS);
			if (active) setDateLocaleReady(true);
		})();
		return () => {
			active = false;
		};
	}, [locale, dateLocaleReady]);

	React.useEffect(() => {
		if (dateLocaleReady) document.getElementById("emdash-boot-loader")?.remove();
	}, [dateLocaleReady]);

	const i18nInitialized = React.useRef(false);
	if (!i18nInitialized.current) {
		i18n.loadAndActivate({ locale, messages });
		i18nInitialized.current = true;
	}

	const activeSiteId = getActiveAdminSiteId();
	const { queryClient, router } = React.useMemo(
		() => getSiteRouterEntry(activeSiteId),
		[activeSiteId],
	);

	if (!dateLocaleReady) return null;

	return (
		<ThemeProvider>
			<I18nProvider i18n={i18n}>
				<LocaleDirectionProvider>
					<KumoTranslationsProvider>
						<Toasty>
							<AdminBrandingProvider adminBranding={adminBranding}>
								<AuthProviderProvider authProviders={authProviders}>
									<PluginAdminProvider pluginAdmins={pluginAdmins}>
										<QueryClientProvider client={queryClient}>
											<LinkProvider component={KumoRouterLink}>
												<RouterProvider router={router} />
											</LinkProvider>
										</QueryClientProvider>
									</PluginAdminProvider>
								</AuthProviderProvider>
							</AdminBrandingProvider>
						</Toasty>
					</KumoTranslationsProvider>
				</LocaleDirectionProvider>
			</I18nProvider>
		</ThemeProvider>
	);
}

export default AdminApp;
