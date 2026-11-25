import type {
	DecisionCheckRequest,
	DecisionGetRequest,
	DecisionRecordRequest,
	DecisionSubjects,
} from './types.js';

type Fields = Record<string, unknown>;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Fields {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	for (const key of Object.keys(value))
		if (!keys.includes(key)) fail(path, `unrecognized key "${key}"`);
	return value as Fields;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length < 1) fail(path, 'expected a non-empty string');
	return value;
}

function parseNonEmptyStringList(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) fail(path, 'expected an array of strings');
	return value.map((item, index) => text(item, `${path}[${index}]`));
}

const MAX_GLOB_BRACE_EXPANSIONS = 64;

function normalizeGlobPosix(value: string): string {
	let normalized = value.replaceAll('\\', '/');
	while (normalized.startsWith('./')) normalized = normalized.slice(2);
	return normalized;
}

function expandGlobBraces(pattern: string, budget = MAX_GLOB_BRACE_EXPANSIONS): string[] {
	const open = pattern.indexOf('{');
	if (open < 0 || budget <= 1) return [pattern];
	let depth = 0;
	let close = -1;
	for (let i = open; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	if (close < 0) return [pattern];
	const prefix = pattern.slice(0, open);
	const body = pattern.slice(open + 1, close);
	const suffix = pattern.slice(close + 1);
	const alternatives: string[] = [];
	let current = '';
	depth = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
		if (ch === ',' && depth === 0) {
			alternatives.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	alternatives.push(current);
	const results: string[] = [];
	for (const alt of alternatives) {
		if (results.length >= budget) break;
		for (const expanded of expandGlobBraces(`${prefix}${alt}${suffix}`, budget - results.length)) {
			results.push(expanded);
			if (results.length >= budget) break;
		}
	}
	return results;
}

/** Compile a POSIX subject glob to a RegExp; throws SyntaxError on invalid character classes. */
export function compileSubjectGlob(glob: string): RegExp {
	const normalized = normalizeGlobPosix(glob);
	if (!normalized) throw new SyntaxError('Glob pattern must not be empty');
	const variants = expandGlobBraces(normalized);
	const regexParts = variants.map((variant) => {
		let out = '';
		let i = 0;
		while (i < variant.length) {
			const ch = variant[i] as string;
			if (ch === '*') {
				if (variant[i + 1] === '*') {
					if (variant[i + 2] === '/') {
						out += '(?:.*/)?';
						i += 3;
					} else {
						out += '.*';
						i += 2;
					}
				} else {
					out += '[^/]*';
					i += 1;
				}
				continue;
			}
			if (ch === '?') {
				out += '[^/]';
				i += 1;
				continue;
			}
			if (ch === '[') {
				const close = variant.indexOf(']', i + 1);
				if (close <= i + 1) {
					throw new SyntaxError(`Unclosed or empty character class in glob: ${glob}`);
				}
				let content = variant.slice(i + 1, close);
				if (content.startsWith('!')) content = `^${content.slice(1)}`;
				// Validate the character class independently so reversed ranges like [z-a] fail cleanly.
				new RegExp(`[${content}]`);
				out += `[${content}]`;
				i = close + 1;
				continue;
			}
			if (/[.+^$()|[\]\\{}]/.test(ch)) {
				out += `\\${ch}`;
			} else {
				out += ch;
			}
			i += 1;
		}
		return `^(?:${out})$`;
	});
	return new RegExp(regexParts.join('|'));
}

/** Return true when `pattern` is a syntactically valid POSIX subject glob. */
export function isValidSubjectGlob(pattern: string): boolean {
	if (typeof pattern !== 'string' || pattern.length === 0) return false;
	try {
		compileSubjectGlob(pattern);
		return true;
	} catch {
		return false;
	}
}

function parseDecisionSubjects(value: unknown, path: string): DecisionSubjects {
	const fields = record(value, path, ['specimens', 'files', 'tokens']);
	let files: string[] | undefined;
	if (fields.files !== undefined) {
		files = parseNonEmptyStringList(fields.files, `${path}.files`);
		for (let i = 0; i < files.length; i++) {
			const pattern = files[i] as string;
			if (!isValidSubjectGlob(pattern)) {
				fail(`${path}.files[${i}]`, `invalid glob pattern "${pattern}"`);
			}
		}
	}
	return {
		...(fields.specimens === undefined
			? {}
			: { specimens: parseNonEmptyStringList(fields.specimens, `${path}.specimens`) }),
		...(files === undefined ? {} : { files }),
		...(fields.tokens === undefined
			? {}
			: { tokens: parseNonEmptyStringList(fields.tokens, `${path}.tokens`) }),
	};
}

export function parseDecisionRecordRequest(value: unknown): DecisionRecordRequest {
	const path = 'decision record request';
	const fields = record(value, path, [
		'slug',
		'question',
		'set',
		'supersedes',
		'items',
		'chosen',
		'reason',
		'subjects',
	]);
	const slug = fields.slug === undefined ? undefined : text(fields.slug, `${path}.slug`);
	const question =
		fields.question === undefined ? undefined : text(fields.question, `${path}.question`);
	const set = fields.set === undefined ? undefined : text(fields.set, `${path}.set`);
	let supersedes: string | string[] | undefined;
	if (fields.supersedes !== undefined) {
		if (typeof fields.supersedes === 'string') {
			supersedes = text(fields.supersedes, `${path}.supersedes`);
		} else if (Array.isArray(fields.supersedes) && fields.supersedes.length >= 1) {
			const list = fields.supersedes.map((item, index) =>
				text(item, `${path}.supersedes[${index}]`)
			);
			if (new Set(list).size !== list.length)
				fail(`${path}.supersedes`, 'superseded decision ids must be unique');
			supersedes = list;
		} else {
			fail(`${path}.supersedes`, 'expected a decision id or non-empty array of decision ids');
		}
	}
	let items: string[] | undefined;
	if (fields.items !== undefined) {
		if (!Array.isArray(fields.items) || fields.items.length < 1)
			fail(`${path}.items`, 'expected a non-empty array of review item ids');
		items = fields.items.map((item, index) => text(item, `${path}.items[${index}]`));
		if (new Set(items).size !== items.length)
			fail(`${path}.items`, 'review item ids must be unique');
	}
	const chosen = text(fields.chosen, `${path}.chosen`);
	let reason: string | undefined;
	if (fields.reason !== undefined) {
		if (typeof fields.reason !== 'string') fail(`${path}.reason`, 'expected a string');
		reason = fields.reason;
	}
	const subjects =
		fields.subjects === undefined
			? undefined
			: parseDecisionSubjects(fields.subjects, `${path}.subjects`);

	const hasSet = set !== undefined;
	const hasSupersedes = supersedes !== undefined;
	const hasItems = items !== undefined;
	if (!hasSet && !hasSupersedes && !hasItems) {
		fail(path, 'provide set (new choice), supersedes (supersede choice), or items (review answer)');
	}
	if (hasSet && !hasSupersedes && !hasItems) {
		if (slug === undefined) fail(`${path}.slug`, 'required when recording a new choice from a set');
		if (question === undefined)
			fail(`${path}.question`, 'required when recording a new choice from a set');
	} else if (hasSupersedes) {
		const supersedeCount = Array.isArray(supersedes) ? supersedes.length : 1;
		if (hasItems) {
			if (chosen !== 'accept')
				fail(`${path}.chosen`, 'superseding choices from review items requires chosen: "accept"');
			if (subjects !== undefined)
				fail(
					`${path}.subjects`,
					'accepting review items preserves each superseded choice’s existing subjects'
				);
			if (hasSet) fail(`${path}.set`, 'accepting review items cites the accepted item’s after set');
		}
		if (supersedeCount > 1) {
			if (slug !== undefined)
				fail(`${path}.slug`, 'cannot override slug when superseding multiple choices');
			if (question !== undefined)
				fail(`${path}.question`, 'cannot override question when superseding multiple choices');
			if (subjects !== undefined)
				fail(`${path}.subjects`, 'cannot override subjects when superseding multiple choices');
		}
	} else {
		if (hasSet) fail(`${path}.set`, 'cannot be combined with items without supersedes');
		if (subjects !== undefined) fail(`${path}.subjects`, 'review answers cannot carry subjects');
		if (chosen !== 'accept' && chosen !== 'reject')
			fail(`${path}.chosen`, 'review answers require chosen to be "accept" or "reject"');
	}

	return {
		...(slug === undefined ? {} : { slug }),
		...(question === undefined ? {} : { question }),
		...(set === undefined ? {} : { set }),
		...(supersedes === undefined ? {} : { supersedes }),
		...(items === undefined ? {} : { items }),
		chosen,
		...(reason === undefined ? {} : { reason }),
		...(subjects === undefined ? {} : { subjects }),
	};
}

export function parseDecisionGetRequest(value: unknown): DecisionGetRequest {
	const path = 'decision get request';
	const fields = record(value, path, ['decision']);
	return { decision: text(fields.decision, `${path}.decision`) };
}

export function parseDecisionListRequest(value: unknown): Record<string, never> {
	record(value, 'decision list request', []);
	return {};
}

export function parseDecisionCheckRequest(value: unknown): DecisionCheckRequest {
	const path = 'decision check request';
	const fields = record(value, path, ['files', 'specimens', 'tokens']);
	return {
		...(fields.files === undefined
			? {}
			: { files: parseNonEmptyStringList(fields.files, `${path}.files`) }),
		...(fields.specimens === undefined
			? {}
			: { specimens: parseNonEmptyStringList(fields.specimens, `${path}.specimens`) }),
		...(fields.tokens === undefined
			? {}
			: { tokens: parseNonEmptyStringList(fields.tokens, `${path}.tokens`) }),
	};
}
