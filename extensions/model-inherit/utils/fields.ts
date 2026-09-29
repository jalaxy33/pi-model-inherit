/**
 * Field-level operations shared by the two features, following pi's own merge
 * rules: object-valued fields merge key by key, everything else is replaced.
 */
import { isObj, type Dict } from "./read-agent-json.ts";

const NESTED_KEYS = ["compat", "headers", "openRouterRouting", "vercelGatewayRouting", "chatTemplateKwargs", "chatTemplateArgs"];

/** `override` wins per key; nested object fields merge one level deeper. */
export function merge(base: Dict, override: Dict): Dict {
	const merged: Dict = { ...base, ...override };
	for (const key of NESTED_KEYS) {
		if (isObj(base[key]) && isObj(override[key])) merged[key] = { ...base[key], ...override[key] };
	}
	return merged;
}

/** Subset of `source` holding only defined values for `keys`. */
export function pick(source: Dict | undefined, keys: readonly string[]): Dict | undefined {
	if (!source) return undefined;
	const out: Dict = {};
	for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Copy of `source` without `keys`. Undefined values are dropped, so they never mask an inherited field. */
export function omit(source: Dict, keys: readonly string[]): Dict {
	const out: Dict = {};
	for (const [key, value] of Object.entries(source)) if (value !== undefined && !keys.includes(key)) out[key] = value;
	return out;
}
