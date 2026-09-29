/**
 * Fake pi runtime for the tests: ModelConfig, the pi-ai models store, and
 * ModelRuntime, each reduced to what pi-model-inherit touches.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piModelInherit from "../extensions/model-inherit/index.ts";

export const agentDir = mkdtempSync(join(tmpdir(), "pi-model-inherit-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

export const writeModels = (config: unknown): void => writeFileSync(join(agentDir, "models.json"), JSON.stringify(config, null, 2));

export const writeSettings = (settings: unknown): void => writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2));

export interface EnvOptions {
	/** Configs models.json would produce, keyed by provider. */
	providers?: Record<string, unknown>;
	/** Composed models, keyed by provider. */
	store?: Record<string, any[]>;
	builtins?: string[];
	extensions?: string[];
}

export function makeEnv({ providers = {}, store = {}, builtins = [], extensions = [] }: EnvOptions = {}) {
	class ModelConfig {
		providers = new Map<string, any>(Object.entries(providers));
		getProvider(id: string) {
			return this.providers.get(id);
		}
		getProviderIds() {
			return [...this.providers.keys()];
		}
	}
	const modelsStore = {
		getModels: (providerId?: string) => (providerId ? [...(store[providerId] ?? [])] : Object.values(store).flat()),
		getModel: (providerId: string, id: string) => (store[providerId] ?? []).find((model) => model.id === id),
		getAvailable: async (providerId?: string) => (providerId ? [...(store[providerId] ?? [])] : Object.values(store).flat()),
	};
	const runtime: any = {
		config: new ModelConfig(),
		builtins: new Map(builtins.map((id) => [id, {}])),
		nativeExtensionProviders: new Map(extensions.map((id) => [id, {}])),
		extensionProviders: new Map(),
		models: modelsStore,
		rebuilds: 0,
		rebuildProviders() {
			this.rebuilds++;
		},
		getAuth: async () => ({ auth: { apiKey: "key", headers: { "x-host": "host" } } }),
		getCompatibilityRequestConfig: () => ({ headers: { "x-host": "host" }, authHeader: false }),
	};
	return { registry: { runtime } as any, runtime, store };
}

export function start(env: ReturnType<typeof makeEnv>, model?: any, options: { thinkingLevel?: string } = {}) {
	const notices: { message: string; type?: string }[] = [];
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	let level = options.thinkingLevel ?? "medium";
	piModelInherit({
		on(event: string, handler: any) {
			handlers.set(event, handler);
			return () => handlers.delete(event);
		},
		getThinkingLevel: () => level,
		setThinkingLevel: (next: string) => { level = next; },
	} as any);
	const ctx: any = {
		modelRegistry: env.registry,
		model,
		hasUI: true,
		ui: { notify: (message: string, type?: string) => notices.push({ message, type }) },
	};
	return {
		sessionStart: () => handlers.get("session_start")!({ type: "session_start" }, ctx),
		modelSelect: (selected: any) => handlers.get("model_select")!({ type: "model_select", model: selected }, ctx),
		notices,
		ctx,
		thinkingLevel: () => level,
	};
}
