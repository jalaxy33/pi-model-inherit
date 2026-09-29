/**
 * Read the JSON files in pi's agent directory, and narrow unknown JSON values.
 * Tolerates comments and trailing commas exactly like pi's own reader.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Dict = Record<string, any>;

export const isObj = (value: unknown): value is Dict =>
	typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);

/** pi's agent directory (this package imports pi types only, so resolve it here). */
export function agentDir(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
}

/** Parsed `<agentDir>/<name>`, or undefined when it is missing, unreadable or not an object. */
export function readAgentJson(name: string): Dict | undefined {
	try {
		const text = readFileSync(join(agentDir(), name), "utf8").replace(/^\uFEFF/, "");
		const parsed: unknown = JSON.parse(stripJsonComments(text));
		return isObj(parsed) ? parsed : undefined;
	} catch {
		return undefined; // pi reports its own errors
	}
}

const stripJsonComments = (input: string): string =>
	input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m: string, tail: string) => tail ?? (m[0] === '"' ? m : ""));
