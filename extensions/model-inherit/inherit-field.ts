/**
 * models.json `inherit` field: a models[] entry can copy another model's
 * configuration, so the same model does not have to be described again for
 * every endpoint that serves it.
 *
 *   { "id": "glm-5.3", "inherit": "zai/glm-5.3" }
 *
 * Everything is inherited except `id` and `baseUrl` (the endpoint stays with the
 * provider). Values written on the entry itself always win.
 */
import { isObj, type Dict } from "./utils/read-agent-json.ts";
import { merge, omit } from "./utils/fields.ts";
import { suggest } from "./utils/suggest.ts";

/** Fields an entry keeps for itself. */
export const LOCAL_KEYS = ["id", "provider", "baseUrl", "inherit"];

/** Where a target model's fields come from. */
export interface Target {
	model(providerId: string, modelId: string): Dict | undefined;
	models(providerId: string): string[];
}

export interface Plan {
	/** providerId -> its models[] entries with `inherit` resolved. */
	rewrites: Map<string, Dict[]>;
	issues: string[];
}

let plan: Plan = { rewrites: new Map(), issues: [] };

export function planInherit(models: Dict | undefined, target: Target, knownProviders: ReadonlySet<string>): Plan {
	const rewrites = new Map<string, Dict[]>();
	const issues: string[] = [];
	plan = { rewrites, issues };

	const raw = new Map<string, Dict[]>();
	const providers = isObj(models?.providers) ? models.providers : undefined;
	for (const [id, entry] of Object.entries(providers ?? {})) {
		const entries = isObj(entry) && Array.isArray(entry.models) ? entry.models.filter(isObj) : [];
		if (entries.length > 0) raw.set(id, entries);
	}

	/** `"provider/modelId"`, or a model of this provider when the prefix is no provider. */
	const splitRef = (ref: string, providerId: string): [string, string] => {
		const slash = ref.indexOf("/");
		return slash > 0 && knownProviders.has(ref.slice(0, slash)) ? [ref.slice(0, slash), ref.slice(slash + 1)] : [providerId, ref];
	};

	const local = (providerId: string, modelId: string): Dict | undefined => raw.get(providerId)?.find((entry) => entry.id === modelId);

	/** Closest existing reference, for the did-you-mean hint. */
	const nearest = (ref: string, providerId: string, modelId: string): string | undefined => {
		const nearModel = suggest(modelId, target.models(providerId));
		if (nearModel) return `${providerId}/${nearModel}`;
		const slash = ref.indexOf("/");
		const nearProvider = slash > 0 ? suggest(ref.slice(0, slash), [...knownProviders]) : undefined;
		return nearProvider ? `${nearProvider}/${ref.slice(slash + 1)}` : undefined;
	};

	/** Fields a target contributes; "cycle" when following `inherit` loops back. */
	const fieldsOf = (providerId: string, modelId: string, chain: string[]): Dict | "cycle" | undefined => {
		const key = `${providerId}/${modelId}`;
		if (chain.includes(key)) return "cycle";
		// A models.json entry defines the model itself; otherwise take the composed catalog model.
		const entry = local(providerId, modelId);
		const composed = entry ? undefined : target.model(providerId, modelId);
		if (!entry && !composed) return undefined;

		let base: Dict | undefined;
		const ref = entry?.inherit;
		if (typeof ref === "string") {
			const [p, m] = splitRef(ref, providerId);
			const parent = fieldsOf(p, m, [...chain, key]);
			if (parent === "cycle" || parent === undefined) return parent;
			base = parent;
		}
		const fields = omit((entry ?? composed) as Dict, LOCAL_KEYS);
		return base ? merge(base, fields) : fields;
	};

	for (const [providerId, entries] of raw) {
		let changed = false;
		const rewritten = entries.map((entry) => {
			const ref = entry.inherit;
			if (ref === undefined) return entry;
			const where = `providers["${providerId}"].models ${entry.id ? `"${entry.id}"` : "entry"}`;
			if (typeof ref !== "string" || ref === "") {
				issues.push(`${where}: inherit must be a string like "provider/modelId".`);
				return entry;
			}
			const [p, m] = splitRef(ref, providerId);
			const inherited = fieldsOf(p, m, []);
			if (inherited === "cycle") {
				issues.push(`${where}: inherit "${ref}" forms a cycle; ignored.`);
				return entry;
			}
			if (!inherited) {
				const near = nearest(ref, p, m);
				issues.push(`${where}: inherit target "${ref}" was not found${near ? `; did you mean "${near}"?` : ""}; ignored.`);
				return entry;
			}
			changed = true;
			return merge(inherited, omit(entry, ["inherit"]));
		});
		if (changed) rewrites.set(providerId, rewritten);
	}
	return plan;
}

/** Config layer: swap in the resolved models[] entries. */
export function withInherited(config: Dict | undefined, providerId: string): Dict | undefined {
	const entries = plan.rewrites.get(providerId);
	if (!entries || !config) return config;
	return { ...config, models: entries };
}

/** True when this provider's models[] entries were rewritten. */
export function isRewritten(providerId: string): boolean {
	return plan.rewrites.has(providerId);
}
