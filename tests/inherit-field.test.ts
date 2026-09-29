/**
 * `inherit` field: a models[] entry copies another model's configuration.
 *
 * The planning half is tested directly against the pure function; the wiring
 * half goes through the entry so the rewritten definitions reach pi's composer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planInherit, type Target } from "../extensions/model-inherit/inherit-field.ts";
import { makeEnv, start, writeModels } from "./fake-pi.ts";

/** Field bag of a target model, as pi composes one. */
const zaiGlm = {
	provider: "zai",
	id: "glm-5.3",
	name: "glm-5.3",
	api: "openai-completions",
	baseUrl: "https://api.z.ai/v4",
	reasoning: true,
	input: ["text"],
	contextWindow: 1000000,
	maxTokens: 131072,
	cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
	compat: { thinkingFormat: "zai", maxTokensField: "max_tokens", zaiToolStream: true },
};

function table(models: Record<string, any>): Target {
	return {
		model: (providerId, modelId) => models[`${providerId}/${modelId}`],
		models: (providerId) => Object.keys(models).filter((key) => key.startsWith(`${providerId}/`)).map((key) => key.slice(providerId.length + 1)),
	};
}

const known = new Set(["zai", "wd-CPAMP", "ark"]);
const entry = (extra: Record<string, unknown>) => ({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", name: "glm-5.3", inherit: "zai/glm-5.3", ...extra }] } } });
const resolved = (models: unknown, target: Target = table({ "zai/glm-5.3": zaiGlm })) => planInherit(models as any, target, known);

describe("planning", () => {
	it("copies the target's fields but keeps id and baseUrl", () => {
		const plan = resolved({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } } });
		assert.deepEqual(plan.issues, []);
		const models = plan.rewrites.get("wd-CPAMP")!;
		assert.equal(models.length, 1);
		assert.equal(models[0].id, "glm-5.3");
		assert.equal(models[0].inherit, undefined);
		assert.equal(models[0].provider, undefined, "provider is not a definition field");
		assert.equal(models[0].baseUrl, undefined, "location stays with the provider");
		assert.equal(models[0].name, "glm-5.3", "name is inherited too");
		assert.equal(models[0].contextWindow, 1000000);
		assert.equal(models[0].maxTokens, 131072);
		assert.equal(models[0].reasoning, true);
		assert.deepEqual(models[0].cost, zaiGlm.cost);
		assert.deepEqual(models[0].compat, zaiGlm.compat);
	});

	it("lets the entry override any field, including name", () => {
		const plan = resolved(entry({ name: "My GLM", maxTokens: 1000, contextWindow: 200000, compat: { thinkingFormat: "zai", supportsStrictMode: false } }));
		const model = plan.rewrites.get("wd-CPAMP")![0];
		assert.equal(model.name, "My GLM");
		assert.equal(model.maxTokens, 1000);
		assert.equal(model.contextWindow, 200000);
		assert.deepEqual(model.compat, { thinkingFormat: "zai", maxTokensField: "max_tokens", zaiToolStream: true, supportsStrictMode: false });
	});

	it("takes a bare model id as the same provider", () => {
		const models = { providers: { zai: { models: [{ id: "glm-5.3-flash", inherit: "glm-5.3" }] } } };
		const plan = resolved(models);
		assert.deepEqual(plan.issues, []);
		assert.equal(plan.rewrites.get("zai")![0].contextWindow, 1000000);
	});

	it("keeps a model id containing a slash intact when the prefix is no provider", () => {
		const target = table({ "openrouter/anthropic/claude-sonnet-5": { provider: "openrouter", id: "anthropic/claude-sonnet-5", maxTokens: 64000 } });
		const models = { providers: { openrouter: { models: [{ id: "anthropic/claude-sonnet-5-turbo", inherit: "anthropic/claude-sonnet-5" }] } } };
		const plan = planInherit(models as any, target, known);
		assert.deepEqual(plan.issues, []);
		assert.equal(plan.rewrites.get("openrouter")![0].maxTokens, 64000);
	});

	it("follows a chain of inherits", () => {
		const target = table({
			"a/root": { provider: "a", id: "root", maxTokens: 111, compat: { thinkingFormat: "zai", supportsStrictMode: true } },
		});
		const models = {
			providers: {
				a: { models: [{ id: "middle", inherit: "a/root", compat: { supportsStrictMode: false } }] },
				b: { models: [{ id: "leaf", inherit: "a/middle" }] },
			},
		};
		const plan = planInherit(models as any, target, new Set([...known, "a", "b"]));
		assert.deepEqual(plan.issues, []);
		const leaf = plan.rewrites.get("b")![0];
		assert.equal(leaf.maxTokens, 111, "inherited through the chain");
		assert.deepEqual(leaf.compat, { thinkingFormat: "zai", supportsStrictMode: false }, "the closer hop wins per key");
	});

	it("reports a cycle and leaves the entry alone", () => {
		const models = {
			providers: {
				a: { models: [{ id: "one", inherit: "a/two" }, { id: "two", inherit: "a/one" }] },
			},
		};
		const plan = planInherit(models as any, table({}), new Set(["a", "b"]));
		assert.equal(plan.rewrites.size, 0);
		assert.equal(plan.issues.length, 2);
		assert.match(plan.issues[0], /forms a cycle/);
	});

	it("reports a missing target with a did-you-mean", () => {
		const plan = resolved(entry({ inherit: "zai/glm-5.4" }));
		assert.equal(plan.rewrites.size, 0, "the entry is used as written");
		assert.equal(plan.issues.length, 1);
		assert.match(plan.issues[0], /inherit target "zai\/glm-5.4" was not found; did you mean "zai\/glm-5.3"\?/);
	});

	it("reports an unknown provider", () => {
		const plan = resolved(entry({ inherit: "zail/glm-5.3" }));
		assert.match(plan.issues[0], /was not found; did you mean "zai\/glm-5.3"\?/);
	});

	it("reports a non-string inherit", () => {
		const plan = resolved(entry({ inherit: ["zai/glm-5.3"] }));
		assert.equal(plan.rewrites.size, 0);
		assert.match(plan.issues[0], /inherit must be a string like "provider\/modelId"/);
	});

	it("ignores entries without inherit", () => {
		const plan = resolved({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3" }] } } });
		assert.equal(plan.rewrites.size, 0);
		assert.deepEqual(plan.issues, []);
	});
});

describe("wiring", () => {
	it("rewrites the provider's models and rebuilds once", () => {
		writeModels({ providers: { "wd-CPAMP": { baseUrl: "https://example.invalid/v1", api: "openai-completions", models: [{ id: "glm-5.3", name: "glm-5.3", inherit: "zai/glm-5.3" }] } } });
		const config = { baseUrl: "https://example.invalid/v1", api: "openai-completions", models: [{ id: "glm-5.3", name: "glm-5.3", inherit: "zai/glm-5.3" }] };
		const env = makeEnv({ providers: { "wd-CPAMP": config }, store: { zai: [zaiGlm], "wd-CPAMP": [{ provider: "wd-CPAMP", id: "glm-5.3" }] }, builtins: ["zai", "wd-CPAMP"] });
		const { sessionStart, notices } = start(env, { provider: "wd-CPAMP", id: "glm-5.3" });
		sessionStart();

		const rewritten = env.runtime.config.getProvider("wd-CPAMP").models[0];
		assert.equal(rewritten.inherit, undefined);
		assert.equal(rewritten.baseUrl, undefined, "the provider still owns the endpoint");
		assert.equal(rewritten.contextWindow, 1000000);
		assert.deepEqual(rewritten.compat, zaiGlm.compat);
		assert.equal(env.runtime.rebuilds, 1);
		assert.equal(notices.length, 0);
	});

	it("leaves other providers' configs untouched", () => {
		writeModels({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] }, ark: { apiKey: "$K" } } });
		const ark = { apiKey: "$K" };
		const env = makeEnv({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] }, ark }, store: { zai: [zaiGlm] }, builtins: ["zai", "ark", "wd-CPAMP"] });
		const { sessionStart } = start(env);
		sessionStart();

		assert.equal(env.runtime.config.getProvider("ark"), ark);
	});
});
