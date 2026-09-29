/**
 * Near-miss matching for "did you mean" hints. Only clearly similar names count,
 * so a key pi adds later never triggers a bogus suggestion.
 */
export function suggest(key: string, known: readonly string[]): string | undefined {
	let best: string | undefined;
	let score = Infinity;
	for (const candidate of known) {
		const d = distance(key.toLowerCase(), candidate.toLowerCase());
		if (d < score) {
			score = d;
			best = candidate;
		}
	}
	if (best === undefined) return undefined;
	if (score <= 2) return best;
	const a = key.toLowerCase();
	const b = best.toLowerCase();
	return a.length >= 6 && (b.startsWith(a) || a.startsWith(b)) ? best : undefined;
}

function distance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) {
			next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = next;
	}
	return prev[b.length];
}
