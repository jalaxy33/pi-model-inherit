/**
 * models.json `default` block: values every provider inherits, so they are set
 * once instead of per provider. Explicit values always win, including `false`.
 *
 *   "default": { "providers": { "*": { "compat": { "sendSessionAffinityHeaders": true } } } }
 */
import { isObj, type Dict } from "./utils/read-agent-json.ts";
import { merge, pick } from "./utils/fields.ts";
import { suggest } from "./utils/suggest.ts";

// Keys pi reads while composing a provider, so they need the provider config layer.
const CONFIG_KEYS = ["name", "baseUrl", "apiKey", "api", "oauth", "authHeader"];
const ALLOWED_KEYS = [...CONFIG_KEYS, "compat", "headers"];
const REJECTED_KEYS = ["models", "modelOverrides"];

// pi's compat vocabulary: the three compat schemas plus multi-turn keys the api layer reads.
const COMPAT_KEYS = [
	"supportsStore", "supportsDeveloperRole", "supportsReasoningEffort", "supportsUsageInStreaming", "supportsFinishReason",
	"maxTokensField", "requiresToolResultName", "requiresAssistantAfterToolResult", "requiresThinkingAsText",
	"requiresReasoningContentOnAssistantMessages", "thinkingFormat", "chatTemplateKwargs", "chatTemplateArgs",
	"cacheControlFormat", "openRouterRouting", "vercelGatewayRouting", "supportsOpenAIGrammarTools", "supportsStrictMode",
	"sendSessionAffinityHeaders", "sessionAffinityFormat", "supportsLongCacheRetention", "vllmPriority",
	"supportsMaxOutputTokens", "supportsEagerToolInputStreaming", "supportsCacheControlOnTools", "supportsTemperature",
	"forceAdaptiveThinking", "allowEmptySignature", "supportsStrictTools", "supportsMidConvoEffort", "allowedFallbackModels",
	"supportsMidConvoSystemMessages", "supportsMidConvoToolAdditions", "supportsMidConvoToolChanges",
];
const OBJECT_COMPAT = new Set(["chatTemplateKwargs", "chatTemplateArgs", "openRouterRouting", "vercelGatewayRouting"]);
const ARRAY_COMPAT = new Set(["allowedFallbackModels"]);
const STRING_COMPAT = new Set(["maxTokensField", "thinkingFormat", "cacheControlFormat", "sessionAffinityFormat"]);

export interface Defaults {
	star?: Dict;
	exact: Map<string, Dict>;
	issues: string[];
}

let current: Defaults = { exact: new Map(), issues: [] };

function checkCompat(where: string, value: unknown, issues: string[]): void {
	if (!isObj(value)) {
		issues.push(`${where} must be an object.`);
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (!COMPAT_KEYS.includes(key)) {
			const hint = suggest(key, COMPAT_KEYS);
			if (hint) issues.push(`${where}.${key} is ignored; did you mean "${hint}"?`);
			continue;
		}
		if (OBJECT_COMPAT.has(key)) {
			if (!isObj(entry)) issues.push(`${where}.${key} must be an object.`);
			continue;
		}
		if (ARRAY_COMPAT.has(key)) {
			if (!Array.isArray(entry)) issues.push(`${where}.${key} must be an array.`);
			continue;
		}
		const want = STRING_COMPAT.has(key) ? "string" : "boolean";
		if (typeof entry !== want) issues.push(`${where}.${key} must be a ${want}.`);
	}
}

function checkProvider(id: string, entry: unknown, out: Defaults): void {
	const where = `default.providers["${id}"]`;
	if (!isObj(entry)) {
		out.issues.push(`${where} must be an object.`);
		return;
	}
	if (Object.keys(entry).length === 0) {
		out.issues.push(`${where} is empty.`);
		return;
	}
	for (const [key, value] of Object.entries(entry)) {
		if (REJECTED_KEYS.includes(key)) {
			out.issues.push(`${where}.${key} is ignored: default supplies values, not model definitions or overrides.`);
			continue;
		}
		if (!ALLOWED_KEYS.includes(key)) {
			const hint = suggest(key, ALLOWED_KEYS);
			out.issues.push(`${where}.${key} is ignored${hint ? `; did you mean "${hint}"` : ""} (valid: ${ALLOWED_KEYS.join(", ")})`);
			continue;
		}
		if (key === "headers") {
			if (!isObj(value) || Object.values(value).some((v) => typeof v !== "string")) out.issues.push(`${where}.headers must map strings to strings.`);
			continue;
		}
		if (key === "compat") {
			checkCompat(`${where}.compat`, value, out.issues);
			continue;
		}
		if (key === "authHeader") {
			if (typeof value !== "boolean") out.issues.push(`${where}.authHeader must be a boolean.`);
			continue;
		}
		if (typeof value !== "string" || value === "") out.issues.push(`${where}.${key} must be a non-empty string.`);
	}
	if (id === "*") out.star = entry;
	else out.exact.set(id, entry);
}

/** Parse the `default` block, remember it, and report what is wrong with it. */
export function loadDefaults(models: Dict | undefined): Defaults {
	const out: Defaults = { exact: new Map(), issues: [] };
	current = out;

	const block = models?.default;
	if (block === undefined) return out;
	if (!isObj(block)) {
		out.issues.push('"default" must be an object.');
		return out;
	}
	for (const key of Object.keys(block)) {
		if (key !== "providers") out.issues.push(`"default.${key}" is not supported; only "providers" is.`);
	}
	const providers = block.providers;
	if (providers === undefined) return out;
	if (!isObj(providers)) {
		out.issues.push('"default.providers" must be an object.');
		return out;
	}
	for (const [id, entry] of Object.entries(providers)) checkProvider(id, entry, out);
	return out;
}

/** `"*"` first, then the exact provider id. */
function inherited(providerId: string | undefined): Dict | undefined {
	if (!providerId) return undefined;
	const star = current.star;
	const exact = current.exact.get(providerId);
	if (!star) return exact;
	if (!exact) return star;
	return merge(star, exact);
}

const hasConfigKeys = (entry: Dict | undefined): boolean => Boolean(entry && CONFIG_KEYS.some((key) => entry[key] !== undefined));

/** True when the default block carries keys pi only reads while composing providers. */
export function needsConfigLayer(): boolean {
	return hasConfigKeys(current.star) || [...current.exact.values()].some(hasConfigKeys);
}

/** Fill compat keys nobody set. Returns the same object when nothing is missing. */
export function fillDefaults<T extends { compat?: Dict }>(model: T, providerId?: string): T {
	const compat = inherited(providerId)?.compat;
	if (!model || !compat) return model;
	const explicit = isObj(model.compat) ? model.compat : undefined;
	if (!Object.keys(compat).some((key) => explicit?.[key] === undefined)) return model;
	return { ...model, compat: { ...compat, ...explicit } };
}

function defaultHeaders(providerId?: string): Dict | undefined {
	return inherited(providerId)?.headers;
}

const wrapped = new WeakSet<object>();

/** Model layer for compat, request layer for headers. */
export function installDefaults(registry: any): void {
	const runtime = registry?.runtime;
	if (!runtime || typeof runtime !== "object" || wrapped.has(runtime)) return;
	wrapped.add(runtime);
	try {
		const store = runtime.models;
		for (const name of ["getModel", "getModels", "getAvailable"]) {
			const original = store?.[name];
			if (typeof original !== "function") continue;
			store[name] = (providerId?: any, ...rest: any[]) => {
				const result = original.call(store, providerId, ...rest);
				const fill = (model: any) => fillDefaults(model, model?.provider);
				if (result && typeof result.then === "function") return result.then((list: any) => (Array.isArray(list) ? list.map(fill) : fill(list)));
				return Array.isArray(result) ? result.map(fill) : fill(result);
			};
		}
		const getAuth = runtime.getAuth;
		if (typeof getAuth === "function") {
			runtime.getAuth = async (providerOrModel: any, overrides?: any) => {
				const resolution = await getAuth.call(runtime, providerOrModel, overrides);
				const extra = defaultHeaders(typeof providerOrModel === "string" ? providerOrModel : providerOrModel?.provider);
				if (!resolution?.auth || !extra) return resolution;
				return { ...resolution, auth: { ...resolution.auth, headers: { ...extra, ...resolution.auth.headers } } };
			};
		}
		const getCompat = runtime.getCompatibilityRequestConfig;
		if (typeof getCompat === "function") {
			runtime.getCompatibilityRequestConfig = (model: any) => {
				const result = getCompat.call(runtime, model);
				const extra = defaultHeaders(model?.provider);
				if (!result || !extra) return result;
				return { ...result, headers: { ...extra, ...result.headers } };
			};
		}
	} catch {
		/* internals changed: stay silent */
	}
}

const isReal = (runtime: any, id: string): boolean =>
	Boolean(runtime?.builtins?.has?.(id) || runtime?.nativeExtensionProviders?.has?.(id) || runtime?.extensionProviders?.has?.(id));

/** Config layer, for the keys pi reads while composing a provider. */
export function withDefaults(config: Dict | undefined, providerId: string, runtime: any): Dict | undefined {
	const layer = pick(inherited(providerId), CONFIG_KEYS);
	if (!layer) return config;
	const base = config ?? (isReal(runtime, providerId) ? {} : undefined);
	if (base === undefined) return config; // never invent providers
	const merged = merge(layer, base);
	// pi rejects a provider config that defines none of these
	if (!["baseUrl", "headers", "compat", "apiKey", "oauth", "authHeader"].some((key) => merged[key] !== undefined)) merged.compat = {};
	return merged;
}
