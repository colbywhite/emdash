import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const loaderGet = vi.fn(() => ({
		getEntrypoint: vi.fn(() => ({
			invokeRoute: vi.fn(async () => ({ status: 200, body: "{}" })),
			invokeHook: vi.fn(async () => ({ success: true })),
		})),
	}));
	const bridgeFactory = vi.fn();
	return {
		loaderGet,
		bridgeFactory,
		env: {
			LOADER: { get: loaderGet },
			ORANGE_DB: {
				prepare: vi.fn(() => ({
					bind: vi.fn(() => ({
						first: vi.fn(async () => null),
						run: vi.fn(async () => ({ meta: { changes: 0 } })),
					})),
				})),
			},
			PURPLE_DB: {
				prepare: vi.fn(() => ({
					bind: vi.fn(() => ({
						first: vi.fn(async () => null),
						run: vi.fn(async () => ({ meta: { changes: 0 } })),
					})),
				})),
			},
			ORANGE_MEDIA: {
				put: vi.fn(async () => {}),
				get: vi.fn(async () => null),
				delete: vi.fn(async () => {}),
			},
			PURPLE_MEDIA: {
				put: vi.fn(async () => {}),
				get: vi.fn(async () => null),
				delete: vi.fn(async () => {}),
			},
		} as Record<string, unknown>,
	};
});

vi.mock("cloudflare:workers", () => ({
	RpcTarget: vi.fn(),
	WorkerEntrypoint: class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
	env: mocks.env,
	exports: { PluginBridge: mocks.bridgeFactory },
}));

import { PluginBridge } from "../../src/sandbox/bridge.js";
import { CloudflareSandboxRunner } from "../../src/sandbox/runner.js";

const manifest = {
	id: "multi-plugin",
	version: "1.0.0",
	capabilities: ["email:send" as const, "comments:moderate" as const, "media:write" as const],
	allowedHosts: [],
	storage: {},
	hooks: [],
	routes: ["ping"],
	admin: {},
};

describe("multi-site CloudflareSandboxRunner and PluginBridge isolation", () => {
	const runners: CloudflareSandboxRunner[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await Promise.all(runners.splice(0).map((runner) => runner.terminateAll()));
	});

	it("namespaces Worker Loader isolate keys by siteId and forwards site binding props", async () => {
		const orangeRunner = new CloudflareSandboxRunner({
			db: null as never,
			siteId: "orange",
			dbBindingName: "ORANGE_DB",
			mediaBindingName: "ORANGE_MEDIA",
			runtimeId: "rt-orange",
		});
		const purpleRunner = new CloudflareSandboxRunner({
			db: null as never,
			siteId: "purple",
			dbBindingName: "PURPLE_DB",
			mediaBindingName: "PURPLE_MEDIA",
			runtimeId: "rt-purple",
		});
		runners.push(orangeRunner, purpleRunner);

		const orangePlugin = await orangeRunner.load(manifest, "export default {};");
		const purplePlugin = await purpleRunner.load(manifest, "export default {};");

		await orangePlugin.invokeHook("plugin:install", {});
		await purplePlugin.invokeHook("plugin:install", {});

		expect(mocks.loaderGet).toHaveBeenNthCalledWith(
			1,
			"orange:multi-plugin:1.0.0",
			expect.any(Function),
		);
		expect(mocks.loaderGet).toHaveBeenNthCalledWith(
			2,
			"purple:multi-plugin:1.0.0",
			expect.any(Function),
		);
		expect(mocks.bridgeFactory).toHaveBeenNthCalledWith(1, {
			props: expect.objectContaining({
				siteId: "orange",
				dbBindingName: "ORANGE_DB",
				mediaBindingName: "ORANGE_MEDIA",
				runtimeId: "rt-orange",
			}),
		});
		expect(mocks.bridgeFactory).toHaveBeenNthCalledWith(2, {
			props: expect.objectContaining({
				siteId: "purple",
				dbBindingName: "PURPLE_DB",
				mediaBindingName: "PURPLE_MEDIA",
				runtimeId: "rt-purple",
			}),
		});
	});

	it("routes PluginBridge DB, R2, emailSend, and commentModerate by configured bindings and runtimeId", async () => {
		const orangeEmail = vi.fn(async () => {});
		const purpleEmail = vi.fn(async () => {});
		const orangeModerate = vi.fn(async () => ({ id: "c1", status: "approved" }) as never);
		const purpleModerate = vi.fn(async () => ({ id: "c2", status: "spam" }) as never);

		const orangeRunner = new CloudflareSandboxRunner({
			db: null as never,
			siteId: "orange",
			dbBindingName: "ORANGE_DB",
			mediaBindingName: "ORANGE_MEDIA",
			runtimeId: "rt-orange",
			emailSend: orangeEmail,
			commentModerate: orangeModerate,
		});
		const purpleRunner = new CloudflareSandboxRunner({
			db: null as never,
			siteId: "purple",
			dbBindingName: "PURPLE_DB",
			mediaBindingName: "PURPLE_MEDIA",
			runtimeId: "rt-purple",
			emailSend: purpleEmail,
			commentModerate: purpleModerate,
		});
		runners.push(orangeRunner, purpleRunner);

		const orangeBridge = new PluginBridge(
			{
				props: {
					pluginId: "multi-plugin",
					pluginVersion: "1.0.0",
					capabilities: manifest.capabilities,
					allowedHosts: [],
					storageCollections: [],
					siteId: "orange",
					dbBindingName: "ORANGE_DB",
					mediaBindingName: "ORANGE_MEDIA",
					runtimeId: "rt-orange",
				},
			} as never,
			mocks.env as never,
		);
		const purpleBridge = new PluginBridge(
			{
				props: {
					pluginId: "multi-plugin",
					pluginVersion: "1.0.0",
					capabilities: manifest.capabilities,
					allowedHosts: [],
					storageCollections: [],
					siteId: "purple",
					dbBindingName: "PURPLE_DB",
					mediaBindingName: "PURPLE_MEDIA",
					runtimeId: "rt-purple",
				},
			} as never,
			mocks.env as never,
		);

		await orangeBridge.emailSend({ to: "a@example.com", subject: "O", text: "hi" });
		await purpleBridge.emailSend({ to: "b@example.com", subject: "P", text: "hi" });
		expect(orangeEmail).toHaveBeenCalledTimes(1);
		expect(purpleEmail).toHaveBeenCalledTimes(1);

		await orangeBridge.commentSetStatus("c1", "approved", "pending");
		await purpleBridge.commentSetStatus("c2", "spam", "pending");
		expect(orangeModerate).toHaveBeenCalledWith("multi-plugin", "c1", "approved", "pending");
		expect(purpleModerate).toHaveBeenCalledWith("multi-plugin", "c2", "spam", "pending");

		const uploaded = await orangeBridge.mediaUpload(
			"hero.png",
			"image/png",
			new Uint8Array([1, 2, 3]).buffer,
		);
		expect(uploaded.url).toMatch(/^\/_emdash\/api\/sites\/orange\/media\/file\//);
		expect((mocks.env.ORANGE_MEDIA as { put: ReturnType<typeof vi.fn> }).put).toHaveBeenCalledTimes(
			1,
		);
		expect(
			(mocks.env.PURPLE_MEDIA as { put: ReturnType<typeof vi.fn> }).put,
		).not.toHaveBeenCalled();
		expect(
			(mocks.env.ORANGE_DB as { prepare: ReturnType<typeof vi.fn> }).prepare,
		).toHaveBeenCalled();
		expect(
			(mocks.env.PURPLE_DB as { prepare: ReturnType<typeof vi.fn> }).prepare,
		).not.toHaveBeenCalled();

		// Terminating orange cleans up orange's callbacks without touching purple's
		await orangeRunner.terminateAll();
		await purpleBridge.emailSend({ to: "b@example.com", subject: "P2", text: "hi" });
		expect(purpleEmail).toHaveBeenCalledTimes(2);
	});
});
