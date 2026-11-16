import { Sidebar } from "@cloudflare/kumo";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../dist/styles.css";
import { render } from "../utils/render.tsx";

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual("@tanstack/react-router");
	return {
		...actual,
		Link: ({ children, to, ...props }: any) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		useNavigate: () => vi.fn(),
	};
});

const { SidebarHeaderBrand, resolveActiveSite } = await import("../../src/components/Sidebar");

function mountHeader(ui: React.ReactNode) {
	return render(
		<Sidebar.Provider defaultOpen>
			<Sidebar>
				<Sidebar.Header>{ui}</Sidebar.Header>
			</Sidebar>
		</Sidebar.Provider>,
	);
}

describe("resolveActiveSite", () => {
	const sites = [
		{ id: "orange", name: "Orange" },
		{ id: "purple", name: "Purple" },
		{ id: "pink", name: "Pink" },
	];

	it("returns the matching site when activeSiteId is present", () => {
		expect(resolveActiveSite(sites, "purple")).toEqual({ id: "purple", name: "Purple" });
	});

	it("returns undefined when no activeSiteId matches", () => {
		expect(resolveActiveSite(sites, null)).toBeUndefined();
		expect(resolveActiveSite(sites, "unknown")).toBeUndefined();
	});
});

describe("SidebarHeaderBrand", () => {
	const originalPath = window.location.pathname + window.location.search + window.location.hash;

	afterEach(() => {
		window.history.replaceState(null, "", originalPath);
		document.documentElement.removeAttribute("dir");
		document.documentElement.removeAttribute("lang");
	});

	it("renders a non-dropdown brand link in single-site mode and at multi-site root", async () => {
		const single = await mountHeader(<SidebarHeaderBrand admin={{ siteName: "My Blog" }} />);
		await expect
			.element(single.getByRole("link", { name: /My Blog/ }))
			.toHaveAttribute("href", "/");
		expect(single.getByRole("button", { name: /Switch site/ }).query()).toBeNull();

		window.history.replaceState(null, "", "/_emdash/admin");
		const multiRoot = await mountHeader(
			<SidebarHeaderBrand
				sites={[
					{ id: "orange", name: "Orange Site" },
					{ id: "purple", name: "Purple Site" },
				]}
			/>,
		);
		await expect
			.element(multiRoot.getByRole("link", { name: /EmDash/ }))
			.toHaveAttribute("href", "/");
		expect(multiRoot.getByRole("button", { name: /Switch site/ }).query()).toBeNull();
	});

	it("drives active site from URL siteId, switches sites, and links back to All sites", async () => {
		const sites = [
			{ id: "orange", name: "Orange Site" },
			{ id: "purple", name: "Purple Site" },
			{ id: "pink", name: "Pink Site" },
		];
		const onSelectSite = vi.fn();

		window.history.replaceState(null, "", "/_emdash/admin/sites/orange/settings");
		const screen = await mountHeader(
			<SidebarHeaderBrand sites={sites} onSelectSite={onSelectSite} />,
		);

		const trigger = screen.getByRole("button", { name: "Switch site: Orange Site" });
		await expect.element(trigger).toBeInTheDocument();
		expect(trigger.element().closest('[data-sidebar="header"]')).not.toBeNull();

		await trigger.click();

		const orangeOption = screen.getByRole("menuitemradio", { name: "Orange Site" });
		const purpleOption = screen.getByRole("menuitemradio", { name: "Purple Site" });
		const pinkOption = screen.getByRole("menuitemradio", { name: "Pink Site" });
		const allSitesLink = screen.getByRole("menuitem", { name: "All sites" });

		await expect.element(orangeOption).toHaveAttribute("aria-checked", "true");
		await expect.element(purpleOption).toHaveAttribute("aria-checked", "false");
		await expect.element(pinkOption).toHaveAttribute("aria-checked", "false");
		await expect.element(allSitesLink).toHaveAttribute("href", "/_emdash/admin");

		await purpleOption.click();
		expect(onSelectSite).toHaveBeenCalledWith("purple");
	});

	it("renders cleanly in RTL (Arabic) mode", async () => {
		document.documentElement.setAttribute("dir", "rtl");
		document.documentElement.setAttribute("lang", "ar");

		window.history.replaceState(null, "", "/_emdash/admin/sites/orange");
		const screen = await mountHeader(
			<SidebarHeaderBrand
				sites={[
					{ id: "orange", name: "Orange Site" },
					{ id: "purple", name: "Purple Site" },
				]}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Switch site: Orange Site" });
		await expect.element(trigger).toBeInTheDocument();
		expect(getComputedStyle(trigger.element()).direction).toBe("rtl");
		expect(getComputedStyle(trigger.element()).textAlign).toBe("start");
		// Verify logical padding in RTL (ps-2.5 = 10px on right, pe-2 = 8px on left)
		expect(getComputedStyle(trigger.element()).paddingInlineStart).toBe("10px");
		expect(getComputedStyle(trigger.element()).paddingInlineEnd).toBe("8px");
	});
});
