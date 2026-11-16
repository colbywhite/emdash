import { LinkProvider } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as baseRender } from "vitest-browser-react";

import "../../dist/styles.css";
import { KumoRouterLink } from "../../src/App.js";
import { SitesOverview } from "../../src/components/SitesOverview.js";
import { ThemeProvider } from "../../src/components/ThemeProvider.js";
import { createAdminRouter } from "../../src/router.js";
import { render } from "../utils/render.tsx";

const SITES = [
	{ id: "orange", name: "Orange site" },
	{ id: "purple", name: "Purple site" },
	{ id: "pink", name: "Pink site" },
];

describe("SitesOverview", () => {
	afterEach(() => {
		document.documentElement.removeAttribute("dir");
		document.documentElement.removeAttribute("lang");
		document.documentElement.removeAttribute("data-mode");
	});

	it("renders each configured site in a two-column table linking to /_emdash/admin/sites/{siteId}", async () => {
		const screen = await render(<SitesOverview sites={SITES} />);

		await expect.element(screen.getByRole("heading", { name: "Sites" })).toBeInTheDocument();
		const headers = Array.from(document.querySelectorAll("th"), (th) => th.textContent?.trim());
		expect(headers).toEqual(["Name", "ID"]);

		await expect
			.element(screen.getByRole("link", { name: "Orange site" }))
			.toHaveAttribute("href", "/_emdash/admin/sites/orange");
		await expect
			.element(screen.getByRole("link", { name: "Purple site" }))
			.toHaveAttribute("href", "/_emdash/admin/sites/purple");
		await expect
			.element(screen.getByRole("link", { name: "Pink site" }))
			.toHaveAttribute("href", "/_emdash/admin/sites/pink");
		await expect.element(screen.getByText("orange", { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText("purple", { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText("pink", { exact: true })).toBeInTheDocument();
	});

	it("supports RTL (Arabic) and light/dark modes with logical layout", async () => {
		document.documentElement.setAttribute("dir", "rtl");
		document.documentElement.setAttribute("lang", "ar");
		document.documentElement.setAttribute("data-mode", "dark");

		const screen = await render(
			<ThemeProvider defaultTheme="dark">
				<SitesOverview sites={SITES} />
			</ThemeProvider>,
		);

		const idCell = screen.getByText("orange", { exact: true }).element();
		expect(idCell.closest("bdi")?.getAttribute("dir")).toBe("ltr");

		const nameHeader = document.querySelector("th");
		expect(nameHeader).not.toBeNull();
		expect(getComputedStyle(nameHeader!).direction).toBe("rtl");
		expect(getComputedStyle(nameHeader!).textAlign).toBe("start");
	});
});

describe("multi-site root vs site-scoped shell", () => {
	const originalPath = window.location.pathname + window.location.search + window.location.hash;

	beforeEach(() => {
		i18n.loadAndActivate({ locale: "en", messages: {} });
	});

	afterEach(() => {
		window.history.replaceState(null, "", originalPath);
		vi.unstubAllGlobals();
	});

	function buildFetchMock(mode: "root" | "orange") {
		return vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url.includes("/_emdash/api/auth/me")) {
				return Response.json({
					success: true,
					data: {
						id: "user-1",
						email: "admin@example.com",
						name: "Admin",
						role: 50,
						isFirstLogin: false,
						adminLayout: null,
					},
				});
			}
			if (url.includes("/_emdash/api/manifest")) {
				return Response.json({
					success: true,
					data:
						mode === "root"
							? {
									version: "1.4.0",
									hash: "admin",
									sites: SITES,
									collections: {},
									plugins: {},
									taxonomies: [],
									authMode: "passkey",
								}
							: {
									version: "1.4.0",
									hash: "site-orange",
									sites: SITES,
									collections: {
										pages: {
											label: "Pages",
											labelSingular: "Page",
											supports: ["drafts"],
											hasSeo: false,
											fields: {},
										},
									},
									plugins: {},
									taxonomies: [],
									authMode: "passkey",
								},
				});
			}
			if (url.includes("/_emdash/api/dashboard")) {
				return Response.json({
					success: true,
					data: {
						collections: [{ slug: "pages", label: "Pages", total: 2, published: 1, draft: 1 }],
						mediaCount: 0,
						recentItems: [],
					},
				});
			}
			if (url.includes("/_emdash/api/admin/comments/counts")) {
				return Response.json({ success: true, data: { pending: 0 } });
			}
			if (url.includes("/_emdash/api/admin/core-update")) {
				return Response.json({ success: true, data: { updateAvailable: false } });
			}
			return Response.json({ success: true, data: {} });
		});
	}

	it("renders SitesOverview and an empty sidebar at root /_emdash/admin without calling dashboard or comment counts", async () => {
		window.history.replaceState(null, "", "/_emdash/admin");
		const fetchMock = buildFetchMock("root");
		vi.stubGlobal("fetch", fetchMock);

		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const router = createAdminRouter(qc, "/_emdash/admin");

		const screen = await baseRender(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={qc}>
					<ThemeProvider defaultTheme="light">
						<LinkProvider component={KumoRouterLink}>
							<RouterProvider router={router} />
						</LinkProvider>
					</ThemeProvider>
				</QueryClientProvider>
			</I18nProvider>,
		);

		await expect.element(screen.getByRole("heading", { name: "Sites" })).toBeInTheDocument();
		await expect.element(screen.getByText("Orange site")).toBeInTheDocument();
		await expect.element(screen.getByText("Purple site")).toBeInTheDocument();
		await expect.element(screen.getByText("Pink site")).toBeInTheDocument();

		const sidebar = document.querySelector('[aria-label="Admin navigation"]');
		expect(sidebar).not.toBeNull();
		const headerBrandLink = sidebar?.querySelector('[data-sidebar="header"] a');
		expect(headerBrandLink?.getAttribute("href")).toMatch(/^\/_emdash\/admin\/?$/);
		expect(headerBrandLink?.textContent).toContain("EmDash");
		expect(sidebar?.querySelector('[data-sidebar="content"] a')).toBeNull();
		expect(sidebar?.querySelector('a[href$="/settings/sidebars"]')).toBeNull();

		const calledUrls = fetchMock.mock.calls.map((call) => {
			const input = call[0];
			return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		});
		expect(calledUrls.some((url) => url.includes("/_emdash/api/dashboard"))).toBe(false);
		expect(calledUrls.some((url) => url.includes("/_emdash/api/admin/comments/counts"))).toBe(
			false,
		);
	});

	it("renders Dashboard and full site-scoped sidebar inside /_emdash/admin/sites/{siteId}", async () => {
		window.history.replaceState(null, "", "/_emdash/admin/sites/orange");
		const fetchMock = buildFetchMock("orange");
		vi.stubGlobal("fetch", fetchMock);

		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const router = createAdminRouter(qc, "/_emdash/admin/sites/orange");

		const screen = await baseRender(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={qc}>
					<ThemeProvider defaultTheme="light">
						<LinkProvider component={KumoRouterLink}>
							<RouterProvider router={router} />
						</LinkProvider>
					</ThemeProvider>
				</QueryClientProvider>
			</I18nProvider>,
		);

		await expect.element(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
		await expect
			.element(screen.getByRole("button", { name: "Switch site: Orange site" }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole("link", { name: "Pages", exact: true }))
			.toHaveAttribute("href", "/_emdash/admin/sites/orange/content/pages");
	});
});
