import { Sidebar } from "@cloudflare/kumo";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { ACTIVE_SITE_STORAGE_KEY, SidebarHeaderBrand, resolveActiveSite } =
	await import("../../src/components/Sidebar");

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

	it("returns the matching stored site when present", () => {
		expect(resolveActiveSite(sites, "purple")).toEqual({ id: "purple", name: "Purple" });
	});

	it("falls back to the first site when no stored id matches", () => {
		expect(resolveActiveSite(sites, null)).toEqual({ id: "orange", name: "Orange" });
		expect(resolveActiveSite(sites, "unknown")).toEqual({ id: "orange", name: "Orange" });
	});
});

describe("SidebarHeaderBrand", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("renders a dashboard link without a site dropdown when sites is omitted or has one entry", async () => {
		const single = await mountHeader(<SidebarHeaderBrand admin={{ siteName: "My Blog" }} />);
		await expect
			.element(single.getByRole("link", { name: /My Blog/ }))
			.toHaveAttribute("href", "/");
		expect(single.getByRole("button", { name: /Switch site/ }).query()).toBeNull();
	});

	it("renders a site switcher dropdown in data-sidebar='header' when multiple sites are configured", async () => {
		const sites = [
			{ id: "orange", name: "Orange Site" },
			{ id: "purple", name: "Purple Site" },
			{ id: "pink", name: "Pink Site" },
		];

		const screen = await mountHeader(<SidebarHeaderBrand sites={sites} />);

		const trigger = screen.getByRole("button", { name: "Switch site: Orange Site" });
		await expect.element(trigger).toBeInTheDocument();
		expect(trigger.element().closest('[data-sidebar="header"]')).not.toBeNull();

		await trigger.click();

		const orangeOption = screen.getByRole("menuitemradio", { name: "Orange Site" });
		const purpleOption = screen.getByRole("menuitemradio", { name: "Purple Site" });
		const pinkOption = screen.getByRole("menuitemradio", { name: "Pink Site" });

		await expect.element(orangeOption).toHaveAttribute("aria-checked", "true");
		await expect.element(purpleOption).toHaveAttribute("aria-checked", "false");
		await expect.element(pinkOption).toHaveAttribute("aria-checked", "false");

		await purpleOption.click();

		await expect
			.element(screen.getByRole("button", { name: "Switch site: Purple Site" }))
			.toBeInTheDocument();
		expect(localStorage.getItem(ACTIVE_SITE_STORAGE_KEY)).toBe("purple");
	});
});
