/**
 * Assembly: which hooks do what, when layers are installed, and how issues from
 * both features become one warning.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeEnv, start, writeModels, writeSettings } from "./fake-pi.ts";

describe("assembly", () => {
	it("is a no-op without models.json", async () => {
		const env = makeEnv({ store: { ark: [{ provider: "ark", id: "glm-5.3", compat: { supportsStore: false } }] }, builtins: ["ark"] });
		const prototype = Object.getPrototypeOf(env.runtime.config);
		const originalGetProvider = prototype.getProvider;
		const originalModel = env.store.ark[0];
		const { sessionStart, notices } = start(env, { provider: "ark", id: "glm-5.3" });
		sessionStart();

		assert.equal(env.runtime.models.getModel("ark", "glm-5.3"), originalModel, "store objects are returned as they are");
		assert.deepEqual((await env.runtime.getAuth({ provider: "ark" })).auth.headers, { "x-host": "host" });
		assert.equal(prototype.getProvider, originalGetProvider);
		assert.equal(env.runtime.rebuilds, 0);
		assert.equal(notices.length, 0);
	});

	it("applies both features from one session_start", () => {
		writeModels({
			default: { providers: { "*": { compat: { sendSessionAffinityHeaders: true } } } },
			providers: { "wd-CPAMP": { baseUrl: "https://example.invalid/v1", models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } },
		});
		const env = makeEnv({
			providers: { "wd-CPAMP": { baseUrl: "https://example.invalid/v1", models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } },
			store: { zai: [{ provider: "zai", id: "glm-5.3", compat: { thinkingFormat: "zai" } }] },
			builtins: ["zai", "wd-CPAMP"],
		});
		const { sessionStart, notices } = start(env, { provider: "zai", id: "glm-5.3" });
		sessionStart();

		assert.deepEqual(env.runtime.models.getModel("zai", "glm-5.3").compat, { thinkingFormat: "zai", sendSessionAffinityHeaders: true }, "default block");
		assert.equal(env.runtime.config.getProvider("wd-CPAMP").models[0].compat.thinkingFormat, "zai", "inherit");
		assert.equal(env.runtime.rebuilds, 1);
		assert.equal(notices.length, 0);
	});

	it("collects issues from both features into one warning", () => {
		writeModels({
			default: { providers: { "*": { comapt: true } } },
			providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/nope" }] } },
		});
		const env = makeEnv({ builtins: ["zai", "wd-CPAMP"], store: { zai: [{ provider: "zai", id: "glm-5.3" }] } });
		const { sessionStart, modelSelect, notices } = start(env, { provider: "zai", id: "glm-5.3" });
		sessionStart();
		sessionStart();
		modelSelect({ provider: "zai", id: "glm-5.3" });

		assert.equal(notices.length, 1, "one warning per session");
		assert.equal(notices[0].type, "warning");
		assert.match(notices[0].message, /^pi-model-inherit: /);
		assert.match(notices[0].message, /comapt/);
		assert.match(notices[0].message, /inherit target "zai\/nope" was not found/);
	});

	it("does not rebuild on model_select", () => {
		writeModels({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } } });
		const env = makeEnv({ store: { zai: [{ provider: "zai", id: "glm-5.3", maxTokens: 111 }] }, builtins: ["zai", "wd-CPAMP"] });
		const { sessionStart, modelSelect } = start(env, { provider: "zai", id: "glm-5.3" });
		sessionStart();
		const afterStart = env.runtime.rebuilds;
		modelSelect({ provider: "zai", id: "glm-5.3" });

		assert.equal(env.runtime.rebuilds, afterStart);
	});

	it("puts back the thinking level a startup model was clamped to", () => {
		writeSettings({ defaultThinkingLevel: "high" });
		writeModels({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } } });
		const env = makeEnv({
			store: { zai: [{ provider: "zai", id: "glm-5.3" }], "wd-CPAMP": [{ provider: "wd-CPAMP", id: "glm-5.3", reasoning: true }] },
			builtins: ["zai", "wd-CPAMP"],
		});
		const { sessionStart, thinkingLevel, ctx } = start(env, { provider: "wd-CPAMP", id: "glm-5.3", reasoning: false }, { thinkingLevel: "off" });
		sessionStart();

		assert.equal(ctx.model.reasoning, true, "the model is repaired first");
		assert.equal(thinkingLevel(), "high", "the configured default is used");
	});

	it("leaves a thinking level the user chose alone", () => {
		writeSettings({ defaultThinkingLevel: "high", modelThinkingLevels: { "wd-CPAMP/glm-5.3": "low" } });
		writeModels({ providers: { "wd-CPAMP": { models: [{ id: "glm-5.3", inherit: "zai/glm-5.3" }] } } });
		const env = makeEnv({
			store: { zai: [{ provider: "zai", id: "glm-5.3" }], "wd-CPAMP": [{ provider: "wd-CPAMP", id: "glm-5.3", reasoning: true }] },
			builtins: ["zai", "wd-CPAMP"],
		});
		const mid = start(env, { provider: "wd-CPAMP", id: "glm-5.3", reasoning: false }, { thinkingLevel: "medium" });
		mid.sessionStart();
		assert.equal(mid.thinkingLevel(), "medium", "a level that was not clamped is kept");

		const perModel = start(env, { provider: "wd-CPAMP", id: "glm-5.3", reasoning: false }, { thinkingLevel: "off" });
		perModel.sessionStart();
		assert.equal(perModel.thinkingLevel(), "low", "a per-model level outranks the default");
	});
});
