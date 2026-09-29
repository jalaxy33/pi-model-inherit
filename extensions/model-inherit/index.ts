/**
 * pi-model-inherit: two models.json features, both silent.
 *
 *   `default` block  values every provider inherits             (default-block.ts)
 *   `inherit` field  a model entry copies another model's config (inherit-field.ts)
 *
 * No commands, no config file, no output; a broken block or entry produces at
 * most one warning per session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readAgentJson, type Dict } from "./utils/read-agent-json.ts";
import { fillDefaults, installDefaults, loadDefaults, needsConfigLayer, withDefaults } from "./default-block.ts";
import { LOCAL_KEYS, isRewritten, planInherit, withInherited, type Target } from "./inherit-field.ts";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Level = (typeof LEVELS)[number];
const isLevel = (value: unknown): value is Level => typeof value === "string" && (LEVELS as readonly string[]).includes(value);

export default function piModelInherit(pi: ExtensionAPI): void {
	const patched = new WeakSet<object>();
	const warned = new Set<string>();

	/** Providers pi knows about: built-ins, extension-registered ones, and models.json. */
	const providersOf = (runtime: any): Set<string> => {
		const ids = new Set<string>();
		for (const map of [runtime?.builtins, runtime?.nativeExtensionProviders, runtime?.extensionProviders]) {
			if (typeof map?.keys === "function") for (const id of map.keys()) ids.add(id);
		}
		if (typeof runtime?.config?.getProviderIds === "function") for (const id of runtime.config.getProviderIds()) ids.add(id);
		return ids;
	};

	/** Models pi composed, as they are before this extension rewrites any definition. */
	const targetOf = (runtime: any): Target => {
		const store = runtime?.models;
		const list = (providerId: string): Dict[] => {
			try {
				const models = store?.getModels?.(providerId);
				return Array.isArray(models) ? models : [];
			} catch {
				return [];
			}
		};
		return {
			model: (providerId, modelId) => list(providerId).find((model) => model?.id === modelId),
			models: (providerId) => list(providerId).map((model) => model?.id).filter((id) => typeof id === "string"),
		};
	};

	/** Only needed for keys pi reads while composing a provider, and for `inherit` rewrites. */
	const installConfigLayer = (registry: any): void => {
		const runtime = registry?.runtime;
		const prototype = runtime?.config ? Object.getPrototypeOf(runtime.config) : undefined;
		if (typeof prototype?.getProvider !== "function" || patched.has(prototype)) return;
		try {
			const getProvider = prototype.getProvider;
			prototype.getProvider = function (this: unknown, providerId: string) {
				return withDefaults(withInherited(getProvider.call(this, providerId), providerId), providerId, runtime);
			};
			patched.add(prototype);
		} catch {
			/* internals changed: stay silent */
		}
	};

	/**
	 * pi resolves the session's thinking level from settings while it builds the
	 * startup model, before this extension runs, so a model that only becomes
	 * reasoning-capable through `inherit` keeps a level clamped to "off". An
	 * endpoint that rejects `thinking: {"type":"disabled"}` (zai-style thinking)
	 * then fails every request, so put back the level pi would have chosen.
	 */
	const restoreThinkingLevel = (model: any, hadReasoning: boolean): void => {
		if (hadReasoning || model?.reasoning !== true) return;
		const settings = readAgentJson("settings.json");
		const level: unknown = settings?.modelThinkingLevels?.[`${model.provider}/${model.id}`] ?? settings?.defaultThinkingLevel ?? "medium";
		if (!isLevel(level)) return;
		try {
			if (pi.getThinkingLevel?.() === "off") pi.setThinkingLevel(level);
		} catch {
			/* no session runtime: nothing to restore */
		}
	};

	/**
	 * A model resolved before install keeps the object it was built with: take the
	 * composed values for providers whose entries were rewritten, then default compat.
	 */
	const adopt = (registry: any, model: any): void => {
		if (!model?.provider) return;
		const fresh = isRewritten(model.provider) ? registry?.runtime?.models?.getModel?.(model.provider, model.id) : undefined;
		const hadReasoning = model.reasoning === true;
		const filled = fillDefaults(fresh ?? model, model.provider);
		if (filled && filled !== model) {
			for (const [key, value] of Object.entries(filled)) {
				if (LOCAL_KEYS.includes(key)) continue;
				try { model[key] = value; } catch { /* frozen: the model layer still covers compat */ }
			}
		}
		restoreThinkingLevel(model, hadReasoning);
	};

	const warn = (ctx: any, issues: string[]): void => {
		if (issues.length === 0) return;
		const message = `pi-model-inherit: ${issues.join(" ")}`;
		if (warned.has(message)) return;
		warned.add(message);
		if (ctx?.hasUI && typeof ctx.ui?.notify === "function") ctx.ui.notify(message, "warning");
	};

	/** Re-read models.json and apply both features. A rewrite only reaches a provider after a rebuild. */
	const sync = (registry: any, rebuild = false): string[] => {
	const models = readAgentJson("models.json");
		const defaults = loadDefaults(models);
		const inherit = planInherit(models, targetOf(registry?.runtime), providersOf(registry?.runtime));
		installDefaults(registry);
		if (inherit.rewrites.size > 0 || needsConfigLayer()) {
			installConfigLayer(registry);
			if (rebuild) registry?.runtime?.rebuildProviders?.();
		}
		return [...defaults.issues, ...inherit.issues];
	};

	const handle = (ctx: any, model: any, rebuild: boolean): void => {
		warn(ctx, sync(ctx?.modelRegistry, rebuild));
		adopt(ctx?.modelRegistry, model);
	};

	pi.on("session_start", (_event, ctx) => handle(ctx, (ctx as any)?.model, true));

	pi.on("model_select", (event, ctx) => handle(ctx, (event as any)?.model, false));
}
