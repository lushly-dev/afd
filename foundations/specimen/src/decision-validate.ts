import {
	CARD_CHOSEN_VALUES,
	type MeantToFix,
	REFUSAL_SCOPE_VALUES,
	type RefusalScope,
} from './card-types.js';
import type {
	DecisionCheckRequest,
	DecisionGetRequest,
	DecisionListRequest,
	DecisionPanelProvenance,
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

function trimmedText(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
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

function parseMeantToFix(value: unknown, path: string): MeantToFix {
	const fields = record(value, path, ['job', 'target']);
	return {
		job: trimmedText(fields.job, `${path}.job`),
		target: trimmedText(fields.target, `${path}.target`),
	};
}

function parsePanelProvenance(value: unknown, path: string): DecisionPanelProvenance {
	const fields = record(value, path, ['reviewers', 'split']);
	if (!Array.isArray(fields.reviewers) || fields.reviewers.length < 1) {
		fail(`${path}.reviewers`, 'expected a non-empty array of reviewer ids');
	}
	const reviewers = fields.reviewers.map((item, idx) =>
		trimmedText(item, `${path}.reviewers[${idx}]`)
	);
	return {
		reviewers,
		split: trimmedText(fields.split, `${path}.split`),
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
		'card',
		'cards',
		'chosen',
		'reason',
		'subjects',
		'refusalScope',
		'regressionAccepted',
		'meantToFix',
		'remediation',
		'provisional',
		'panel',
		'changeAuthor',
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
	const card = fields.card === undefined ? undefined : trimmedText(fields.card, `${path}.card`);
	let cards: string[] | undefined;
	if (fields.cards !== undefined) {
		if (!Array.isArray(fields.cards) || fields.cards.length < 1)
			fail(`${path}.cards`, 'expected a non-empty array of card ids');
		cards = fields.cards.map((item, index) => trimmedText(item, `${path}.cards[${index}]`));
		if (new Set(cards.map((id) => id.trim())).size !== cards.length)
			fail(`${path}.cards`, 'card ids must be unique');
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
	let refusalScope: RefusalScope | undefined;
	if (fields.refusalScope !== undefined) {
		if (
			typeof fields.refusalScope !== 'string' ||
			!(REFUSAL_SCOPE_VALUES as readonly string[]).includes(fields.refusalScope)
		) {
			fail(`${path}.refusalScope`, `expected one of ${REFUSAL_SCOPE_VALUES.join(', ')}`);
		}
		refusalScope = fields.refusalScope as RefusalScope;
	}
	let regressionAccepted: boolean | undefined;
	if (fields.regressionAccepted !== undefined) {
		if (typeof fields.regressionAccepted !== 'boolean') {
			fail(`${path}.regressionAccepted`, 'expected a boolean');
		}
		regressionAccepted = fields.regressionAccepted;
	}
	const meantToFix =
		fields.meantToFix === undefined
			? undefined
			: parseMeantToFix(fields.meantToFix, `${path}.meantToFix`);
	const remediation =
		fields.remediation === undefined
			? undefined
			: trimmedText(fields.remediation, `${path}.remediation`);
	let provisional: boolean | undefined;
	if (fields.provisional !== undefined) {
		if (typeof fields.provisional !== 'boolean') fail(`${path}.provisional`, 'expected a boolean');
		provisional = fields.provisional;
	}
	const panel =
		fields.panel === undefined ? undefined : parsePanelProvenance(fields.panel, `${path}.panel`);
	const changeAuthor =
		fields.changeAuthor === undefined
			? undefined
			: trimmedText(fields.changeAuthor, `${path}.changeAuthor`);

	const hasCard = card !== undefined;
	const hasCards = cards !== undefined;
	const hasSet = set !== undefined;
	const hasSupersedes = supersedes !== undefined;
	const hasItems = items !== undefined;

	if (hasCard && hasCards) {
		fail(path, 'provide either card or cards, not both');
	}
	if (hasCard || hasCards) {
		if (hasSet || hasItems) {
			fail(path, 'card mode cannot be combined with set or items');
		}
		if (subjects !== undefined) {
			fail(`${path}.subjects`, 'card mode cannot carry subjects');
		}
		if (Array.isArray(supersedes)) {
			fail(`${path}.supersedes`, 'card mode supersedes accepts a single decision id');
		}
		if (!(CARD_CHOSEN_VALUES as readonly string[]).includes(chosen)) {
			fail(
				`${path}.chosen`,
				`card mode requires chosen to be one of ${CARD_CHOSEN_VALUES.join(', ')}`
			);
		}
		if (refusalScope !== undefined && chosen !== 'reject') {
			fail(`${path}.refusalScope`, 'refusalScope is only valid when chosen is "reject"');
		}
		if (regressionAccepted !== undefined && chosen !== 'approve') {
			fail(
				`${path}.regressionAccepted`,
				'regressionAccepted is only valid when chosen is "approve"'
			);
		}
	} else {
		if (refusalScope !== undefined) {
			fail(`${path}.refusalScope`, 'refusalScope applies only in card mode');
		}
		if (regressionAccepted !== undefined) {
			fail(`${path}.regressionAccepted`, 'regressionAccepted applies only in card mode');
		}
		if (meantToFix !== undefined) {
			fail(`${path}.meantToFix`, 'meantToFix applies only in card mode');
		}
		if (remediation !== undefined) {
			fail(`${path}.remediation`, 'remediation applies only in card mode');
		}
		if (!hasSet && !hasSupersedes && !hasItems) {
			fail(
				path,
				'provide set (new choice), supersedes (supersede choice), items (review answer), or card/cards (card mode)'
			);
		}
		if (hasSet && !hasSupersedes && !hasItems) {
			if (slug === undefined)
				fail(`${path}.slug`, 'required when recording a new choice from a set');
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
				if (hasSet)
					fail(`${path}.set`, 'accepting review items cites the accepted item’s after set');
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
	}

	return {
		...(slug === undefined ? {} : { slug }),
		...(question === undefined ? {} : { question }),
		...(set === undefined ? {} : { set }),
		...(supersedes === undefined ? {} : { supersedes }),
		...(items === undefined ? {} : { items }),
		...(card === undefined ? {} : { card }),
		...(cards === undefined ? {} : { cards }),
		chosen,
		...(reason === undefined ? {} : { reason }),
		...(subjects === undefined ? {} : { subjects }),
		...(refusalScope === undefined ? {} : { refusalScope }),
		...(regressionAccepted === undefined ? {} : { regressionAccepted }),
		...(meantToFix === undefined ? {} : { meantToFix }),
		...(remediation === undefined ? {} : { remediation }),
		...(provisional === undefined ? {} : { provisional }),
		...(panel === undefined ? {} : { panel }),
		...(changeAuthor === undefined ? {} : { changeAuthor }),
	};
}

export function parseDecisionGetRequest(value: unknown): DecisionGetRequest {
	const path = 'decision get request';
	const fields = record(value, path, ['decision']);
	return { decision: text(fields.decision, `${path}.decision`) };
}

const DECISION_LIST_KINDS = ['choice', 'card', 'answer', 'all'] as const;

export function parseDecisionListRequest(value: unknown = {}): DecisionListRequest {
	const path = 'decision list request';
	const fields = record(value, path, ['kind', 'released', 'limit', 'after']);
	let kind: DecisionListRequest['kind'];
	if (fields.kind !== undefined) {
		if (
			typeof fields.kind !== 'string' ||
			!(DECISION_LIST_KINDS as readonly string[]).includes(fields.kind)
		) {
			fail(`${path}.kind`, `expected one of ${DECISION_LIST_KINDS.join(', ')}`);
		}
		kind = fields.kind as DecisionListRequest['kind'];
	}
	let released: boolean | undefined;
	if (fields.released !== undefined) {
		if (typeof fields.released !== 'boolean') fail(`${path}.released`, 'expected a boolean');
		released = fields.released;
	}
	let limit: number | undefined;
	if (fields.limit !== undefined) {
		if (
			typeof fields.limit !== 'number' ||
			!Number.isSafeInteger(fields.limit) ||
			fields.limit < 1 ||
			fields.limit > 200
		) {
			fail(`${path}.limit`, 'expected an integer from 1 to 200');
		}
		limit = fields.limit;
	}
	const after = fields.after === undefined ? undefined : trimmedText(fields.after, `${path}.after`);
	return {
		...(kind === undefined ? {} : { kind }),
		...(released === undefined ? {} : { released }),
		...(limit === undefined ? {} : { limit }),
		...(after === undefined ? {} : { after }),
	};
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
