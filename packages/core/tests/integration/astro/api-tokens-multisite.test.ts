import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("virtual:emdash/auth", () => ({ authenticate: vi.fn() }), { virtual: true });
vi.mock("virtual:emdash/config", () => ({ default: {} }), { virtual: true });
vi.mock("virtual:emdash/object-cache", () => ({}), { virtual: true });

import { handleContentCreate, handleContentList } from "../../../src/api/handlers/content.js";
import { onRequest as authMiddleware } from "../../../src/astro/middleware/auth.js";
import { DELETE as revokeToken } from "../../../src/astro/routes/api/admin/api-tokens/[id].js";
import {
	GET as listTokens,
	POST as createToken,
} from "../../../src/astro/routes/api/admin/api-tokens/index.js";
import { GET as listContent } from "../../../src/astro/routes/api/content/[collection]/index.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

type AuthContext = Parameters<typeof authMiddleware>[0];

describe("multi-site API token routes", () => {
	let adminDb: Kysely<Database>;
	let siteDb: Kysely<Database>;

	beforeEach(async () => {
		adminDb = await setupTestDatabase();
		siteDb = await setupTestDatabase();

		await adminDb
			.insertInto("users")
			.values({
				id: "admin-1",
				email: "admin@example.com",
				name: "Admin",
				role: Role.ADMIN,
				email_verified: 1,
			})
			.execute();

		const registry = new SchemaRegistry(siteDb);
		await registry.createCollection({
			slug: "pages",
			label: "Pages",
			labelSingular: "Page",
		});
		await registry.createField("pages", {
			slug: "title",
			label: "Title",
			type: "string",
		});

		const created = await handleContentCreate(siteDb, "pages", {
			slug: "orange",
			status: "published",
			data: { title: "Orange Home" },
		});
		if (!created.success) {
			throw new Error(created.error?.message ?? "Failed to seed page");
		}
	});

	afterEach(async () => {
		await teardownTestDatabase(siteDb);
		await teardownTestDatabase(adminDb);
	});

	it("stores, lists, and revokes PATs in adminDb even when emdash.db points to a site DB, and authenticates site content reads", async () => {
		const siteLocals = {
			user: {
				id: "admin-1",
				email: "admin@example.com",
				name: "Admin",
				role: Role.ADMIN,
				emailVerified: true,
				disabled: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			emdash: {
				db: siteDb,
				adminDb,
				handleContentList: (collection: string, params: Parameters<typeof handleContentList>[2]) =>
					handleContentList(siteDb, collection, params),
			},
		};

		const createReq = new Request("http://localhost/_emdash/api/admin/api-tokens", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"X-EmDash-Site": "orange",
			},
			body: JSON.stringify({
				name: "Orange Client Token",
				scopes: ["content:read"],
			}),
		});
		const createRes = await createToken({
			params: {},
			request: createReq,
			url: new URL(createReq.url),
			locals: siteLocals,
		} as unknown as APIContext);
		expect(createRes.status).toBe(201);

		const createdBody = (await createRes.json()) as {
			success: boolean;
			data: { token: string; info: { id: string; name: string } };
		};
		expect(createdBody.success).toBe(true);
		expect(createdBody.data.token).toMatch(/^ec_pat_/);

		const adminTokenRows = await adminDb.selectFrom("_emdash_api_tokens").select("id").execute();
		const siteTokenRows = await siteDb.selectFrom("_emdash_api_tokens").select("id").execute();
		expect(adminTokenRows).toHaveLength(1);
		expect(siteTokenRows).toHaveLength(0);

		const listReq = new Request("http://localhost/_emdash/api/admin/api-tokens", {
			headers: { "X-EmDash-Site": "orange" },
		});
		const listRes = await listTokens({
			params: {},
			request: listReq,
			url: new URL(listReq.url),
			locals: siteLocals,
		} as unknown as APIContext);
		expect(listRes.status).toBe(200);
		const listBody = (await listRes.json()) as {
			success: boolean;
			data: { items: Array<{ id: string; name: string }> };
		};
		expect(listBody.data.items).toHaveLength(1);
		expect(listBody.data.items[0]?.id).toBe(createdBody.data.info.id);

		const contentReq = new Request("http://localhost/_emdash/api/sites/orange/content/pages", {
			method: "GET",
			headers: { Authorization: `Bearer ${createdBody.data.token}` },
		});
		const contentLocals = {
			emdash: {
				db: siteDb,
				adminDb,
				handleContentList: (collection: string, params: Parameters<typeof handleContentList>[2]) =>
					handleContentList(siteDb, collection, params),
			},
		};
		const contentAuthCtx = {
			params: { collection: "pages" },
			request: contentReq,
			url: new URL(contentReq.url),
			locals: contentLocals,
			redirect: vi.fn(),
			session: { get: vi.fn(), set: vi.fn(), destroy: vi.fn() },
		} as unknown as AuthContext;
		const contentRes = await authMiddleware(contentAuthCtx, async () =>
			listContent({
				params: { collection: "pages" },
				request: contentReq,
				url: new URL(contentReq.url),
				locals: contentLocals,
			} as unknown as APIContext),
		);
		expect(contentRes.status).toBe(200);
		const contentBody = (await contentRes.json()) as {
			success: boolean;
			data: { items: Array<{ slug: string | null; data: { title?: string } }> };
		};
		expect(contentBody.data.items).toHaveLength(1);
		expect(contentBody.data.items[0]).toMatchObject({
			slug: "orange",
			data: { title: "Orange Home" },
		});

		const revokeReq = new Request(
			`http://localhost/_emdash/api/admin/api-tokens/${createdBody.data.info.id}`,
			{
				method: "DELETE",
				headers: { "X-EmDash-Site": "orange" },
			},
		);
		const revokeRes = await revokeToken({
			params: { id: createdBody.data.info.id },
			request: revokeReq,
			url: new URL(revokeReq.url),
			locals: siteLocals,
		} as unknown as APIContext);
		expect(revokeRes.status).toBe(200);
		expect(await adminDb.selectFrom("_emdash_api_tokens").select("id").execute()).toHaveLength(0);

		const rejectedAuthCtx = {
			params: { collection: "pages" },
			request: contentReq,
			url: new URL(contentReq.url),
			locals: { emdash: { db: siteDb, adminDb } },
			redirect: vi.fn(),
			session: { get: vi.fn(), set: vi.fn(), destroy: vi.fn() },
		} as unknown as AuthContext;
		const rejectedRes = await authMiddleware(
			rejectedAuthCtx,
			async () => new Response("unexpected"),
		);
		expect(rejectedRes.status).toBe(401);
	});
});
