/**
 * `default` block: values every provider inherits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeEnv, start, writeModels } from "./fake-pi.ts";

const compatOnly = { default: { providers: { "*": { compat: { sendSessionAffinityHeaders: true, supportsStrictMode: true } }, ark: { compat: { sendSessionAffinityHeaders: false } } } } };

describe("model layer", () => {
	it("fills missing compat keys and keeps explicit ones", async () => {
		writeModels({ ...compatOnly, providers: { ark: { apiKey: "$K" }, zai: { apiKey: "$Z" } } });
		const env = makeEnv({
			providers: { ark: { apiKey: "$K" }, zai: { apiKey: "$Z" } },
			store: {
				deepseek: [{ provider: "deepseek", id: "deepseek-flash", compat: undefined }],
				ark: [{ provider: "ark", id: "glm-5.3", compat: { thinkingFormat: "zai" } }],
				zai: [{ provider: "zai", id: "glm-5.3-flash", compat: { sendSessionAffinityHeaders: false } }],
				complete: [{ provider: "complete", id: "x", compat: { sendSessionAffinityHeaders: true, supportsStrictMode: false } }],
			},
			builtins: ["deepseek", "zai", "ark", "complete"],
		});
		const session = { provider: "wd-CPAMP", id: "glm-5.3", compat: { thinkingFormat: "zai" } };
		const { sessionStart, notices } = start(env, session);
		sessionStart();

		assert.deepEqual(env.runtime.models.getModel("deepseek", "deepseek-flash").compat, {
			sendSessionAffinityHeaders: true,
			supportsStrictMode: true,
		});
		assert.deepEqual(env.runtime.models.getModel("ark", "glm-5.3").compat, {
			thinkingFormat: "zai",
			sendSessionAffinityHeaders: false,
			supportsStrictMode: true,
		});
		assert.equal(env.store.deepseek[0].compat, undefined, "store objects are not mutated");
		assert.equal(env.runtime.models.getModel("complete", "x"), env.store.complete[0], "no missing key: same object");
		assert.deepEqual(session.compat, { thinkingFormat: "zai", sendSessionAffinityHeaders: true, supportsStrictMode: true });
		assert.equal(notices.length, 0);
	});

	it("covers list reads, including the async availability call", async () => {
		writeModels(compatOnly);
		const env = makeEnv({ store: { deepseek: [{ provider: "deepseek", id: "deepseek-flash" }] }, builtins: ["deepseek"] });
		const { sessionStart } = start(env, { provider: "deepseek", id: "deepseek-flash" });
		sessionStart();

		assert.equal(env.runtime.models.getModels("deepseek")[0].compat.sendSessionAffinityHeaders, true);
		assert.equal(env.runtime.models.getModels()[0].compat.sendSessionAffinityHeaders, true);
		assert.equal((await env.runtime.models.getAvailable("deepseek"))[0].compat.sendSessionAffinityHeaders, true);
	});
});

describe("provider composition", () => {
	it("is not touched for compat/headers defaults", () => {
		writeModels(compatOnly);
		const env = makeEnv({ store: { deepseek: [{ provider: "deepseek", id: "deepseek-flash" }] }, builtins: ["deepseek"] });
		const prototype = Object.getPrototypeOf(env.runtime.config);
		const originalGetProvider = prototype.getProvider;
		const { sessionStart } = start(env, { provider: "deepseek", id: "deepseek-flash" });
		sessionStart();

		assert.equal(env.runtime.config.providers.size, 0);
		assert.equal(prototype.getProvider, originalGetProvider);
		assert.equal(env.runtime.rebuilds, 0);
	});

	it("is used only when a provider-level key is defaulted", () => {
		writeModels({ default: { providers: { "*": { headers: { "x-team": "core" }, baseUrl: "https://gateway.local/v1" } } }, providers: { ark: { apiKey: "$K", baseUrl: "https://own.local/v1" } } });
		const env = makeEnv({ providers: { ark: { apiKey: "$K", baseUrl: "https://own.local/v1" } }, store: {}, builtins: ["deepseek", "ark"] });
		const prototype = Object.getPrototypeOf(env.runtime.config);
		const originalGetProvider = prototype.getProvider;
		const { sessionStart, notices } = start(env, { provider: "ark", id: "glm-5.3" });
		sessionStart();

		assert.notEqual(prototype.getProvider, originalGetProvider);
		assert.equal(env.runtime.config.getProvider("ark").baseUrl, "https://own.local/v1", "explicit wins");
		assert.deepEqual(env.runtime.config.getProvider("deepseek"), { baseUrl: "https://gateway.local/v1" });
		assert.equal(env.runtime.config.getProvider("ghost"), undefined, "never invents providers");
		assert.ok(env.runtime.rebuilds >= 1);
		assert.equal(notices.length, 0);
	});
});

describe("request layer", () => {
	it("merges default headers into auth, keeping explicit ones", async () => {
		writeModels({ default: { providers: { "*": { headers: { "x-team": "core" } } } }, providers: {} });
		const env = makeEnv({ builtins: ["ark"] });
		const { sessionStart } = start(env, { provider: "ark", id: "glm-5.3" });
		sessionStart();

		assert.deepEqual((await env.runtime.getAuth({ provider: "ark", id: "glm-5.3" })).auth.headers, { "x-team": "core", "x-host": "host" });
		assert.deepEqual((await env.runtime.getAuth("zai")).auth.headers, { "x-team": "core", "x-host": "host" });
		assert.deepEqual(env.runtime.getCompatibilityRequestConfig({ provider: "ark" }).headers, { "x-team": "core", "x-host": "host" });
	});
});

describe("validation", () => {
	const cases: Array<[string, unknown, RegExp | undefined]> = [
		["typos get a did-you-mean hint", { default: { providers: { "*": { comapt: true, compat: { sendSessionAffinityHeader: true } } } } }, /comapt[\s\S]*compat/],
		["model definitions are rejected", { default: { providers: { "*": { models: [] } } } }, /definitions or overrides/],
		["wrong types are reported", { default: { providers: { "*": { compat: { sendSessionAffinityHeaders: "true" } } } } }, /must be a boolean/],
		["empty entries are reported", { default: { providers: { "*": {} } } }, /is empty/],
		["unknown top-level keys are reported", { default: { proviers: {} } }, /only "providers" is/],
		["unrelated compat keys stay silent (forward compatible)", { default: { providers: { "*": { compat: { someFuturePiFlag: true } } } } }, undefined],
	];

	for (const [label, models, expected] of cases) {
		it(label, () => {
			writeModels(models);
			const env = makeEnv({ store: {}, builtins: ["deepseek"] });
			const { sessionStart, notices } = start(env, { provider: "deepseek", id: "deepseek-flash" });
			sessionStart();
			sessionStart();
			if (!expected) {
				assert.equal(notices.length, 0);
				return;
			}
			assert.equal(notices.length, 1, "one warning per session");
			assert.equal(notices[0].type, "warning");
			assert.match(notices[0].message, expected);
		});
	}

	it("stays quiet without a UI", () => {
		writeModels({ default: { providers: { "*": { comapt: true } } } });
		const env = makeEnv({ builtins: ["deepseek"] });
		const { sessionStart, ctx, notices } = start(env);
		ctx.hasUI = false;
		sessionStart();
		assert.equal(notices.length, 0);
	});
});
