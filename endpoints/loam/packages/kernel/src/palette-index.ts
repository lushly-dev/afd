/**
 * @fileoverview The palette's search index (phase 0 specification, 6.3): a deterministic
 * subsequence fuzzy match over name, title and description, with no model and no randomness.
 * Operation A1 of the accelerator admission rule (8.2) measures it.
 */

/** What the index searches. A {@link CommandSummaryV0} is one. */
export interface PaletteEntry {
	name: string;
	title?: string;
	description: string;
}

export type PaletteField = 'name' | 'title' | 'description';

/** One search result. */
export interface PaletteItem {
	name: string;
	title?: string;
	description: string;
	score: number;
	/** The best-scoring field. */
	field: PaletteField;
	/** The matched ranges in that field, as `[start, end)` character offsets. */
	matches: Array<[number, number]>;
}

export interface PaletteIndex {
	/** How many entries the index holds. */
	readonly size: number;
	/**
	 * The entries matching `query`, best first, ties broken by name; at most `limit` (default 20).
	 * Whitespace in the query is ignored and case does not matter. An empty query returns every
	 * entry, by name, with score 0.
	 */
	search(query: string, limit?: number): PaletteItem[];
}

/** Field weights: a match in the name counts three times one in the description. */
export const PALETTE_WEIGHTS: Readonly<Record<PaletteField, number>> = Object.freeze({
	name: 3,
	title: 2,
	description: 1,
});

/** Added per matched character that directly follows the previous one. */
export const PALETTE_RUN_BONUS = 1;
/** Added per matched character at the start of a word. */
export const PALETTE_WORD_START_BONUS = 2;

/** Most start positions tried per field; each costs one greedy pass. */
const MAX_STARTS = 16;
const DEFAULT_LIMIT = 20;
const FIELDS: readonly PaletteField[] = ['name', 'title', 'description'];

interface IndexedField {
	field: PaletteField;
	text: string;
	lower: string;
	wordStart: Uint8Array;
}

interface IndexedEntry {
	entry: PaletteEntry;
	fields: IndexedField[];
}

function isWordChar(code: number): boolean {
	return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isUpper(char: string): boolean {
	return char !== char.toLowerCase() && char === char.toUpperCase();
}

/**
 * `text` in lower case, one code unit for one, so offsets into it are offsets into `text`. A
 * character whose lower case is longer (\u0130, a dotted capital I) is kept as it is.
 */
function lowerCase(text: string): string {
	const lower = text.toLowerCase();
	if (lower.length === text.length) return lower;
	let out = '';
	for (const char of text) {
		const folded = char.toLowerCase();
		out += folded.length === char.length ? folded : char;
	}
	return out;
}

function indexField(field: PaletteField, text: string): IndexedField {
	const lower = lowerCase(text);
	const wordStart = new Uint8Array(lower.length);
	for (let i = 0; i < lower.length; i++) {
		const previous = i === 0 ? -1 : lower.charCodeAt(i - 1);
		const camel = i > 0 && isUpper(text[i] as string) && !isUpper(text[i - 1] as string);
		if (isWordChar(lower.charCodeAt(i)) && (i === 0 || !isWordChar(previous) || camel)) {
			wordStart[i] = 1;
		}
	}
	return { field, text, lower, wordStart };
}

/**
 * The best greedy match of `query` in `field` from one of its candidate starts: its score, or -1.
 * With `out`, the matched positions of the best start are written to it.
 */
function scoreField(
	field: IndexedField,
	query: string,
	scratch: Int32Array,
	out?: number[]
): number {
	const { lower, wordStart } = field;
	const first = query[0] as string;
	// Feasibility: one leftmost pass, which most entries fail.
	let at = -1;
	for (let i = 0; i < query.length; i++) {
		at = lower.indexOf(query[i] as string, at + 1);
		if (at < 0) return -1;
	}
	let best = -1;
	let tried = 0;
	for (
		let start = lower.indexOf(first);
		start >= 0 && tried < MAX_STARTS;
		start = lower.indexOf(first, start + 1)
	) {
		// The first occurrence, then only word starts.
		if (tried > 0 && !wordStart[start]) continue;
		tried++;
		let score = query.length + (wordStart[start] ? PALETTE_WORD_START_BONUS : 0);
		let previous = start;
		scratch[0] = start;
		for (let i = 1; i < query.length; i++) {
			const position = lower.indexOf(query[i] as string, previous + 1);
			// No later start can match either: they all begin further right.
			if (position < 0) return best;
			if (wordStart[position]) score += PALETTE_WORD_START_BONUS;
			if (position === previous + 1) score += PALETTE_RUN_BONUS;
			scratch[i] = position;
			previous = position;
		}
		if (score > best) {
			best = score;
			if (out) {
				out.length = 0;
				for (let i = 0; i < query.length; i++) out.push(scratch[i] as number);
			}
		}
	}
	return best;
}

function toRanges(positions: readonly number[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const position of positions) {
		const last = ranges[ranges.length - 1];
		if (last && last[1] === position) last[1] = position + 1;
		else ranges.push([position, position + 1]);
	}
	return ranges;
}

interface Candidate {
	index: number;
	score: number;
	field: number;
}

/** Whether `a` ranks before `b`: higher score first, then name. */
function ranksBefore(a: Candidate, b: Candidate, indexed: readonly IndexedEntry[]): boolean {
	if (a.score !== b.score) return a.score > b.score;
	return (
		(indexed[a.index] as IndexedEntry).entry.name < (indexed[b.index] as IndexedEntry).entry.name
	);
}

function byName(a: PaletteItem, b: PaletteItem): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function item(
	entry: PaletteEntry,
	score: number,
	field: PaletteField,
	matches: Array<[number, number]>
): PaletteItem {
	return {
		name: entry.name,
		...(entry.title !== undefined ? { title: entry.title } : {}),
		description: entry.description,
		score,
		field,
		matches,
	};
}

/** Build the index over `entries`. The entries are read once; later changes are not seen. */
export function createPaletteIndex(entries: readonly PaletteEntry[]): PaletteIndex {
	const indexed: IndexedEntry[] = entries.map((entry) => ({
		entry: { ...entry },
		fields: FIELDS.flatMap((field) => {
			const text = entry[field];
			return typeof text === 'string' && text.length > 0 ? [indexField(field, text)] : [];
		}),
	}));

	return {
		size: indexed.length,
		search(query: string, limit = DEFAULT_LIMIT): PaletteItem[] {
			const max = Math.max(0, Math.floor(limit));
			const needle = lowerCase(query).replace(/\s+/g, '');
			if (needle.length === 0) {
				return indexed
					.map(({ entry }) => item(entry, 0, 'name', []))
					.sort(byName)
					.slice(0, max);
			}
			if (max === 0) return [];
			const scratch = new Int32Array(needle.length);
			// The best `max` so far, best first: a short insertion list, not a sort of every match.
			const top: Candidate[] = [];
			for (let index = 0; index < indexed.length; index++) {
				const { fields } = indexed[index] as IndexedEntry;
				let best: Candidate | null = null;
				for (let f = 0; f < fields.length; f++) {
					const field = fields[f] as IndexedField;
					const raw = scoreField(field, needle, scratch);
					if (raw < 0) continue;
					const score = raw * PALETTE_WEIGHTS[field.field];
					if (!best || score > best.score) best = { index, score, field: f };
				}
				if (!best) continue;
				if (top.length === max && !ranksBefore(best, top[max - 1] as Candidate, indexed)) continue;
				let at = top.length;
				while (at > 0 && ranksBefore(best, top[at - 1] as Candidate, indexed)) at--;
				top.splice(at, 0, best);
				if (top.length > max) top.pop();
			}
			return top.map((candidate) => {
				const { entry, fields } = indexed[candidate.index] as IndexedEntry;
				const field = fields[candidate.field] as IndexedField;
				const positions: number[] = [];
				scoreField(field, needle, scratch, positions);
				return item(entry, candidate.score, field.field, toRanges(positions));
			});
		},
	};
}
