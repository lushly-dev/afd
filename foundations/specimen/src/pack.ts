import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { z } from 'zod';
import {
	IDENTIFIER_INVALID,
	PACK_FORMAT_VERSION,
	PACK_PATTERNS,
	type PackComponent,
	type PackComponentV1,
	type PackCopy,
	type PackLibrary,
	type PackLibraryV1,
	type PackPattern,
	type PackRules,
	type PackRulesV1,
	packComponentSchema,
	packComponentV1Schema,
	packCopySchema,
	packLibrarySchema,
	packLibraryV1Schema,
	packPatternSchema,
	packRulesSchema,
	packRulesV1Schema,
	TEXT_INVALID,
	TEXT_TOO_LONG,
} from './pack-schema.js';

export * from './pack-schema.js';

/** Which form of a pack: the records and rules a repository commits, or what a deployment copies. */
export type PackForm = 'committed' | 'exported';

export type PackProblemCode =
	| 'LAYOUT_INVALID'
	| 'JSON_INVALID'
	| 'FORMAT_UNSUPPORTED'
	| 'SCHEMA_INVALID'
	| 'IDENTIFIER_INVALID'
	| 'TEXT_TOO_LONG'
	| 'TEXT_INVALID'
	| 'NOT_CANONICAL'
	| 'DUPLICATE_ID'
	| 'RULE_UNKNOWN'
	| 'TAG_UNKNOWN'
	| 'TAG_MISMATCH'
	| 'LIBRARY_MISMATCH'
	| 'PREFIX_MISMATCH'
	| 'CATALOG_MISMATCH'
	| 'DIGEST_MISMATCH'
	| 'PATTERN_MISMATCH'
	| 'COPY_MISMATCH'
	| 'PATTERN_UNKNOWN'
	| 'COPY_UNKNOWN';

export interface PackProblem {
	code: PackProblemCode;
	/** The file, relative to the pack's root. */
	path: string;
	/** A JSON Pointer into the file, when the problem is at one place in it. */
	at?: string;
	message: string;
}

export interface PackCheck {
	valid: boolean;
	libraries: string[];
	problems: PackProblem[];
}

/** A pack's files by their path relative to its root, with `/` as the separator. */
export type PackFiles = ReadonlyMap<string, Uint8Array>;

/** What export adds to the committed form for one library. */
export interface PackStamp {
	title: string;
	package: { name: string; version: string };
	prefix: string;
	revision?: string;
}

type AnyComponent = PackComponent | PackComponentV1;
type AnyRules = PackRules | PackRulesV1;
type AnyLibrary = PackLibrary | PackLibraryV1;
type PackVersion = 1 | 2;

/** The deployer's file beside a pack's data. It belongs to Umbel, and a check skips it. */
const DEPLOYER_FILES = new Set(['pack.toml']);

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
	);
};

/** The one serialization a pack file may have: keys sorted, tab indent, a final line feed. */
export function canonicalJson(value: unknown): string {
	return `${JSON.stringify(sortKeys(value), null, '\t')}\n`;
}

/** `sha256:` and the hex digest of a file's bytes. */
export function packDigest(bytes: Uint8Array | string): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const rulesPath = (library: string) => `rules/${library}.json`;
const libraryPath = (library: string) => `data/${library}/library.json`;
const componentPath = (library: string, tag: string) => `data/${library}/components/${tag}.json`;
const patternPath = (library: string, pattern: string) =>
	`data/${library}/patterns/${pattern}.json`;
const copyPath = (library: string, pattern: string, name: string) =>
	`data/${library}/patterns/${pattern}/${name}.json`;

/**
 * A library's pack digest: the SHA-256 of one line per committed file, `<path> <digest>\n`, sorted
 * by path. It covers the rules, every component record, every pattern record, and every copy
 * record, and not the catalog that states it.
 */
export function packContentDigest(files: PackFiles, library: string): string {
	const lines = [...files.keys()]
		.filter(
			(path) =>
				path === rulesPath(library) ||
				path.startsWith(`data/${library}/components/`) ||
				path.startsWith(`data/${library}/patterns/`)
		)
		.sort()
		.map((path) => `${path} ${packDigest(files.get(path) as Uint8Array)}\n`);
	return packDigest(lines.join(''));
}

type Located =
	| { kind: 'rules'; library: string }
	| { kind: 'library'; library: string }
	| { kind: 'component'; library: string; tag: string }
	| { kind: 'pattern'; library: string; pattern: string }
	| { kind: 'copy'; library: string; pattern: string; name: string };

const isLibrary = (value: string | undefined): value is string =>
	value !== undefined && value.length <= 64 && PACK_PATTERNS.library.test(value);
const isTag = (value: string | undefined): value is string =>
	value !== undefined && value.length <= 100 && PACK_PATTERNS.tag.test(value);
const isPattern = (value: string | undefined): value is string =>
	value !== undefined && value.length <= 64 && PACK_PATTERNS.pattern.test(value);
const isCopyName = (value: string | undefined): value is string =>
	value !== undefined && value.length <= 64 && PACK_PATTERNS.copyName.test(value);

/** Where a path sits in the layout; an identifier that fails its pattern sits nowhere. */
const locate = (path: string): Located | undefined => {
	const rules = /^rules\/([^/]+)\.json$/.exec(path);
	if (isLibrary(rules?.[1])) return { kind: 'rules', library: rules[1] };
	const catalog = /^data\/([^/]+)\/library\.json$/.exec(path);
	if (isLibrary(catalog?.[1])) return { kind: 'library', library: catalog[1] };
	const component = /^data\/([^/]+)\/components\/([^/]+)\.json$/.exec(path);
	if (isLibrary(component?.[1]) && isTag(component[2]))
		return { kind: 'component', library: component[1], tag: component[2] };
	const pattern = /^data\/([^/]+)\/patterns\/([^/]+)\.json$/.exec(path);
	if (isLibrary(pattern?.[1]) && isPattern(pattern[2]))
		return { kind: 'pattern', library: pattern[1], pattern: pattern[2] };
	const copy = /^data\/([^/]+)\/patterns\/([^/]+)\/([^/]+)\.json$/.exec(path);
	if (isLibrary(copy?.[1]) && isPattern(copy[2]) && isCopyName(copy[3]))
		return { kind: 'copy', library: copy[1], pattern: copy[2], name: copy[3] };
	return undefined;
};

const PLAIN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * A path the layout does not place, shown only as far as its segments look like the format's own
 * names: the first segment that does not is cut, with what follows it, so no free text is shown.
 */
const shownPath = (path: string) => {
	const segments = path.split('/');
	const kept: string[] = [];
	for (const segment of segments) {
		if (!PLAIN_SEGMENT.test(segment)) break;
		kept.push(segment);
	}
	return kept.length === segments.length ? path : [...kept, '…'].join('/');
};

/**
 * Sanitizes a JSON Pointer so pack-supplied map keys (`facets`, `setups`, `targets`, `gates`) that
 * hold free text never appear in `problem.at`, cutting at the first non-plain segment with `…`.
 */
const shownPointer = (at: string): string => {
	if (!at.startsWith('/')) return at;
	const segments = at.slice(1).split('/');
	const kept: string[] = [];
	for (const segment of segments) {
		if (!PLAIN_SEGMENT.test(segment)) break;
		kept.push(segment);
	}
	return kept.length === segments.length ? at : `/${[...kept, '…'].join('/')}`;
};

const pointer = (path: readonly PropertyKey[]) =>
	path.length === 0
		? undefined
		: shownPointer(
				`/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
			);

const issueCode = (issue: z.core.$ZodIssue): PackProblemCode => {
	if (issue.code === 'custom') {
		const marker = (issue.params as { pack?: string } | undefined)?.pack;
		if (marker === TEXT_TOO_LONG) return 'TEXT_TOO_LONG';
		if (marker === TEXT_INVALID) return 'TEXT_INVALID';
		if (marker === IDENTIFIER_INVALID) return 'IDENTIFIER_INVALID';
	}
	if (issue.code === 'invalid_format') return 'IDENTIFIER_INVALID';
	if (issue.code === 'too_big' && issue.origin === 'string') return 'IDENTIFIER_INVALID';
	return 'SCHEMA_INVALID';
};

// Zod's message for an unknown key quotes the key, which is the pack's text, so it is not used.
const issueMessage = (issue: z.core.$ZodIssue) =>
	issue.code === 'unrecognized_keys' ? 'A key the format does not define' : issue.message;

interface Parsed<T> {
	path: string;
	value: T;
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const comparePairs = (a: readonly [string, string], b: readonly [string, string]) =>
	a[0] !== b[0] ? compareStrings(a[0], b[0]) : compareStrings(a[1], b[1]);

function peekFormat(bytes: Uint8Array | undefined): PackVersion | undefined {
	if (!bytes) return undefined;
	try {
		const raw = JSON.parse(
			new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
		);
		if (raw !== null && typeof raw === 'object') {
			const fmt = (raw as { format?: unknown }).format;
			if (fmt === 1 || fmt === 2) return fmt;
		}
	} catch {
		// Reported as JSON_INVALID when parsed.
	}
	return undefined;
}

/**
 * Determine the uniform format version (`1` or `2`) for a library from its valid-format files:
 * majority wins, breaking ties in favor of the rules file and then format 2.
 */
function detectLibraryFormat(
	files: PackFiles,
	paths: readonly string[],
	rulesFile?: string
): PackVersion {
	let count1 = 0;
	let count2 = 0;
	for (const path of paths) {
		const version = peekFormat(files.get(path));
		if (version === 1) count1++;
		else if (version === 2) count2++;
	}
	if (count1 > count2) return 1;
	if (count2 > count1) return 2;
	if (rulesFile) {
		const rulesVersion = peekFormat(files.get(rulesFile));
		if (rulesVersion) return rulesVersion;
	}
	return PACK_FORMAT_VERSION;
}

class Checker {
	readonly problems: PackProblem[] = [];
	constructor(readonly files: PackFiles) {}

	add(code: PackProblemCode, path: string, message: string, at?: string) {
		this.problems.push(
			at === undefined ? { code, path, message } : { code, path, at: shownPointer(at), message }
		);
	}

	/** Reads one file against its schema; reports and returns nothing when it does not hold. */
	parse<T>(
		path: string,
		schema: z.ZodType<T>,
		expectedVersion: PackVersion
	): Parsed<T> | undefined {
		let raw: unknown;
		try {
			raw = JSON.parse(
				new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
					this.files.get(path) as Uint8Array
				)
			);
		} catch {
			this.add('JSON_INVALID', path, 'Not UTF-8 JSON');
			return undefined;
		}
		const version =
			raw !== null && typeof raw === 'object' ? (raw as { format?: unknown }).format : undefined;
		if (version !== expectedVersion) {
			this.add(
				'FORMAT_UNSUPPORTED',
				path,
				`Not a JSON object whose format is ${expectedVersion}`,
				'/format'
			);
			return undefined;
		}
		const result = schema.safeParse(raw);
		if (!result.success) {
			for (const issue of result.error.issues)
				this.add(issueCode(issue), path, issueMessage(issue), pointer(issue.path));
			return undefined;
		}
		const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(this.files.get(path));
		if (text !== canonicalJson(raw))
			this.add(
				'NOT_CANONICAL',
				path,
				'Not in canonical form: sorted keys, tab indent, final newline'
			);
		return { path, value: result.data };
	}

	/** Names in a list must rise strictly: a repeat is a duplicate, a fall is out of order. */
	ascending(path: string, at: string, names: readonly string[]) {
		for (let index = 1; index < names.length; index++) {
			const [before, after] = [names[index - 1] as string, names[index] as string];
			if (before === after)
				this.add('DUPLICATE_ID', path, `"${after}" appears twice`, `${at}/${index}`);
			else if (before > after)
				this.add('NOT_CANONICAL', path, `"${after}" comes before "${before}"`, `${at}/${index}`);
		}
	}

	/** Ordered `(a, b)` pairs must rise strictly by `(a, b)`. */
	ascendingPairs(path: string, at: string, pairs: readonly (readonly [string, string])[]) {
		for (let index = 1; index < pairs.length; index++) {
			const before = pairs[index - 1] as readonly [string, string];
			const after = pairs[index] as readonly [string, string];
			const cmp = comparePairs(before, after);
			if (cmp === 0) this.add('DUPLICATE_ID', path, `Entry appears twice`, `${at}/${index}`);
			else if (cmp > 0) this.add('NOT_CANONICAL', path, `Entry is out of order`, `${at}/${index}`);
		}
	}

	/** Unique ids in an order-preserving list (such as `keep` basis arrays). */
	uniqueIds(path: string, at: string, ids: readonly string[]) {
		const seen = new Set<string>();
		ids.forEach((id, index) => {
			if (seen.has(id))
				this.add('DUPLICATE_ID', path, `"${id}" appears twice`, `${at}/${index}/id`);
			else seen.add(id);
		});
	}
}

const memberLists = ['attributes', 'slots', 'events', 'commands', 'cssProperties'] as const;

function checkComponent(checker: Checker, { path, value }: Parsed<AnyComponent>, tag: string) {
	if (value.tag !== tag)
		checker.add('TAG_MISMATCH', path, `The record's tag is not its file name, ${tag}`, '/tag');
	for (const list of memberLists)
		checker.ascending(
			path,
			`/api/${list}`,
			value.api[list].map((member) => member.name)
		);
	value.api.attributes.forEach((attribute, index) => {
		checker.ascending(path, `/api/attributes/${index}/rules`, attribute.rules ?? []);
	});
	value.api.slots.forEach((slot, index) => {
		checker.ascending(path, `/api/slots/${index}/accepts`, slot.accepts ?? []);
	});
	checker.ascending(
		path,
		'/a11y/role',
		value.a11y.role.map((role) => role.state)
	);
	checker.ascending(path, '/a11y/axe/exceptions', value.a11y.axe?.exceptions ?? []);
	checker.ascending(path, '/rules', value.rules);
	checker.ascending(path, '/themes/supported', value.themes?.supported ?? []);
	if (value.format === 2 && value.patterns) {
		checker.ascendingPairs(
			path,
			'/patterns',
			value.patterns.map((entry) => [entry.library, entry.pattern] as const)
		);
		value.patterns.forEach((entry, index) => {
			if (entry.contexts?.themes)
				checker.ascending(path, `/patterns/${index}/contexts/themes`, entry.contexts.themes);
			checker.uniqueIds(
				path,
				`/patterns/${index}/keep`,
				entry.keep.map((item) => item.id)
			);
		});
	}
}

function checkPatternRecord(
	checker: Checker,
	{ path, value }: Parsed<PackPattern>,
	pattern: string
) {
	if (value.pattern !== pattern)
		checker.add(
			'PATTERN_MISMATCH',
			path,
			`The record's pattern is not its file name, ${pattern}`,
			'/pattern'
		);
	for (const key of Object.keys(value.facets).sort()) {
		checker.ascending(path, `/facets/${key}`, value.facets[key] ?? []);
	}
	checker.ascendingPairs(
		path,
		'/implementations',
		value.implementations.map((impl) =>
			impl.kind === 'component'
				? ([impl.kind, impl.tag] as const)
				: ([impl.kind, impl.name] as const)
		)
	);
}

function checkCopyRecord(
	checker: Checker,
	{ path, value }: Parsed<PackCopy>,
	pattern: string,
	name: string
) {
	if (value.pattern !== pattern)
		checker.add(
			'PATTERN_MISMATCH',
			path,
			`The copy's pattern is not its directory name, ${pattern}`,
			'/pattern'
		);
	if (value.name !== name)
		checker.add('COPY_MISMATCH', path, `The copy's name is not its file name, ${name}`, '/name');
	checker.ascending(path, '/dependencies', value.dependencies);
	checker.ascending(path, '/tokens', value.tokens);
	if (value.contexts?.themes) checker.ascending(path, '/contexts/themes', value.contexts.themes);
	checker.uniqueIds(
		path,
		'/keep',
		value.keep.map((item) => item.id)
	);
}

function checkLibrary(
	checker: Checker,
	library: string,
	form: PackForm,
	version: PackVersion,
	components: Parsed<AnyComponent>[],
	patterns: Parsed<PackPattern>[],
	copies: Parsed<PackCopy>[],
	rules: Parsed<AnyRules> | undefined
) {
	// A tag/pattern/copy exists when its record's file does, so one unreadable record is reported once.
	const tags = new Set<string>();
	const patternIds = new Set<string>();
	const copiesByPattern = new Map<string, Set<string>>();
	for (const path of checker.files.keys()) {
		const located = locate(path);
		if (!located || located.library !== library) continue;
		if (located.kind === 'component') tags.add(located.tag);
		else if (located.kind === 'pattern') patternIds.add(located.pattern);
		else if (located.kind === 'copy') {
			const set = copiesByPattern.get(located.pattern) ?? new Set<string>();
			set.add(located.name);
			copiesByPattern.set(located.pattern, set);
		}
	}
	const ruleIds = rules ? new Set(rules.value.rules.map((rule) => rule.id)) : undefined;
	const seen = new Map<string, string>();
	const claim = (id: string, path: string, at: string) => {
		const first = seen.get(id);
		if (first === undefined) seen.set(id, path);
		else checker.add('DUPLICATE_ID', path, `"${id}" is also stated in ${first}`, at);
	};
	if (rules) {
		const { path, value } = rules;
		if (value.library !== library)
			checker.add(
				'LIBRARY_MISMATCH',
				path,
				`The rules name ${value.library}, not ${library}`,
				'/library'
			);
		checker.ascending(
			path,
			'/rules',
			value.rules.map((rule) => rule.id)
		);
		value.rules.forEach((rule, index) => {
			claim(rule.id, path, `/rules/${index}/id`);
			checker.ascending(path, `/rules/${index}/appliesTo/tags`, rule.appliesTo.tags ?? []);
			checker.ascending(
				path,
				`/rules/${index}/appliesTo/attributes`,
				rule.appliesTo.attributes ?? []
			);
			(rule.appliesTo.tags ?? []).forEach((tag, at) => {
				if (!tags.has(tag))
					checker.add(
						'TAG_UNKNOWN',
						path,
						`No record for ${tag}`,
						`/rules/${index}/appliesTo/tags/${at}`
					);
			});
		});
	}
	for (const { path, value } of components) {
		for (const [list, statements] of [
			['usage', value.usage],
			['a11y/statements', value.a11y.statements],
		] as const)
			statements.forEach((statement, index) => {
				claim(statement.id, path, `/${list}/${index}/id`);
			});
		const references = [
			...value.rules.map((id, index) => [id, `/rules/${index}`] as const),
			...value.api.attributes.flatMap((attribute, index) =>
				(attribute.rules ?? []).map(
					(id, at) => [id, `/api/attributes/${index}/rules/${at}`] as const
				)
			),
		];
		for (const [id, at] of references)
			if (ruleIds && !ruleIds.has(id))
				checker.add('RULE_UNKNOWN', path, `No shared rule ${id}`, at);
		if (value.replacedBy !== undefined && !tags.has(value.replacedBy))
			checker.add('TAG_UNKNOWN', path, `No record for ${value.replacedBy}`, '/replacedBy');
		if (value.format === 2 && value.patterns) {
			value.patterns.forEach((entry, index) => {
				if (entry.library === library && !patternIds.has(entry.pattern))
					checker.add(
						'PATTERN_UNKNOWN',
						path,
						`No pattern record for ${entry.pattern}`,
						`/patterns/${index}/pattern`
					);
			});
		}
	}
	for (const { path, value } of patterns) {
		for (const [list, statements] of [
			['useWhen', value.useWhen],
			['avoidWhen', value.avoidWhen],
			['keep', value.keep],
			['customize', value.customize],
		] as const)
			statements.forEach((statement, index) => {
				claim(statement.id, path, `/${list}/${index}/id`);
			});
		value.implementations.forEach((impl, index) => {
			if (impl.kind === 'component') {
				if (!tags.has(impl.tag))
					checker.add(
						'TAG_UNKNOWN',
						path,
						`No record for ${impl.tag}`,
						`/implementations/${index}/tag`
					);
			} else if (!copiesByPattern.get(value.pattern)?.has(impl.name)) {
				checker.add(
					'COPY_UNKNOWN',
					path,
					`No copy record for ${impl.name}`,
					`/implementations/${index}/name`
				);
			}
		});
		if (value.replacedBy !== undefined) {
			const slash = value.replacedBy.indexOf('/');
			if (slash === -1) {
				if (!patternIds.has(value.replacedBy))
					checker.add(
						'PATTERN_UNKNOWN',
						path,
						`No pattern record for ${value.replacedBy}`,
						'/replacedBy'
					);
			} else {
				const refLib = value.replacedBy.slice(0, slash);
				const refPat = value.replacedBy.slice(slash + 1);
				if (refLib === library && !patternIds.has(refPat))
					checker.add('PATTERN_UNKNOWN', path, `No pattern record for ${refPat}`, '/replacedBy');
			}
		}
	}
	for (const { path, value } of copies) {
		const located = locate(path);
		const parentPattern = located?.kind === 'copy' ? located.pattern : value.pattern;
		if (!patternIds.has(parentPattern))
			checker.add('PATTERN_UNKNOWN', path, `No pattern record for ${parentPattern}`, '/pattern');
		if (
			value.replacedBy !== undefined &&
			!copiesByPattern.get(parentPattern)?.has(value.replacedBy)
		)
			checker.add('COPY_UNKNOWN', path, `No copy record for ${value.replacedBy}`, '/replacedBy');
	}
	if (form === 'exported') checkCatalog(checker, library, version, components, patterns, copies);
}

function checkCatalog(
	checker: Checker,
	library: string,
	version: PackVersion,
	components: Parsed<AnyComponent>[],
	patterns: Parsed<PackPattern>[],
	copies: Parsed<PackCopy>[]
) {
	const { files } = checker;
	const path = libraryPath(library);
	if (!files.has(path)) {
		checker.add('LAYOUT_INVALID', path, 'An exported pack has a catalog for each library');
		return;
	}
	const parsed =
		version === 1
			? checker.parse<AnyLibrary>(path, packLibraryV1Schema, 1)
			: checker.parse<AnyLibrary>(path, packLibrarySchema, 2);
	if (!parsed) return;
	const catalog = parsed.value;
	if (catalog.library !== library)
		checker.add(
			'LIBRARY_MISMATCH',
			path,
			`The catalog names ${catalog.library}, not ${library}`,
			'/library'
		);
	checker.ascending(
		path,
		'/components',
		catalog.components.map((entry) => entry.tag)
	);
	const records = new Map(components.map((record) => [record.value.tag, record]));
	const listed = new Set(catalog.components.map((entry) => entry.tag));
	catalog.components.forEach((entry, index) => {
		const at = `/components/${index}`;
		if (!entry.tag.startsWith(catalog.prefix))
			checker.add(
				'PREFIX_MISMATCH',
				path,
				`${entry.tag} does not start with ${catalog.prefix}`,
				`${at}/tag`
			);
		const file = componentPath(library, entry.tag);
		const bytes = files.get(file);
		if (!bytes) {
			checker.add(
				'CATALOG_MISMATCH',
				path,
				`${entry.tag} is listed but has no record`,
				`${at}/tag`
			);
			return;
		}
		if (packDigest(bytes) !== entry.digest)
			checker.add('DIGEST_MISMATCH', path, `${file} does not match its digest`, `${at}/digest`);
		const record = records.get(entry.tag)?.value;
		if (record && (record.summary !== entry.summary || record.status !== entry.status))
			checker.add(
				'CATALOG_MISMATCH',
				path,
				`${entry.tag}'s summary or status differs from its record`,
				at
			);
	});
	for (const file of files.keys()) {
		const located = locate(file);
		if (located?.kind === 'component' && located.library === library && !listed.has(located.tag))
			checker.add(
				'CATALOG_MISMATCH',
				path,
				`${located.tag} has a record but is not listed`,
				'/components'
			);
	}
	if (catalog.format === 2) {
		checker.ascending(
			path,
			'/patterns',
			catalog.patterns.map((entry) => entry.pattern)
		);
		const patternRecords = new Map(patterns.map((record) => [record.value.pattern, record.value]));
		const listedPatterns = new Set(catalog.patterns.map((entry) => entry.pattern));
		catalog.patterns.forEach((entry, index) => {
			const at = `/patterns/${index}`;
			for (const key of Object.keys(entry.facets).sort()) {
				checker.ascending(path, `${at}/facets/${key}`, entry.facets[key] ?? []);
			}
			const file = patternPath(library, entry.pattern);
			const bytes = files.get(file);
			if (!bytes) {
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${entry.pattern} is listed but has no pattern record`,
					`${at}/pattern`
				);
				return;
			}
			if (packDigest(bytes) !== entry.digest)
				checker.add('DIGEST_MISMATCH', path, `${file} does not match its digest`, `${at}/digest`);
			const record = patternRecords.get(entry.pattern);
			if (
				record &&
				(record.summary !== entry.summary ||
					record.status !== entry.status ||
					record.replacedBy !== entry.replacedBy ||
					record.scope !== entry.scope ||
					canonicalJson(record.facets) !== canonicalJson(entry.facets))
			)
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${entry.pattern}'s metadata differs from its pattern record`,
					at
				);
		});
		for (const file of files.keys()) {
			const located = locate(file);
			if (
				located?.kind === 'pattern' &&
				located.library === library &&
				!listedPatterns.has(located.pattern)
			)
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${located.pattern} has a pattern record but is not listed`,
					'/patterns'
				);
		}

		checker.ascendingPairs(
			path,
			'/copies',
			catalog.copies.map((entry) => [entry.pattern, entry.name] as const)
		);
		const copyRecords = new Map(
			copies.map((record) => [`${record.value.pattern}/${record.value.name}`, record.value])
		);
		const listedCopies = new Set(catalog.copies.map((entry) => `${entry.pattern}/${entry.name}`));
		catalog.copies.forEach((entry, index) => {
			const at = `/copies/${index}`;
			const file = copyPath(library, entry.pattern, entry.name);
			const bytes = files.get(file);
			if (!bytes) {
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${entry.pattern}/${entry.name} is listed but has no copy record`,
					`${at}/name`
				);
				return;
			}
			if (packDigest(bytes) !== entry.digest)
				checker.add('DIGEST_MISMATCH', path, `${file} does not match its digest`, `${at}/digest`);
			const record = copyRecords.get(`${entry.pattern}/${entry.name}`);
			if (
				record &&
				(record.status !== entry.status ||
					record.replacedBy !== entry.replacedBy ||
					record.revision !== entry.revision ||
					record.fingerprint !== entry.fingerprint)
			)
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${entry.pattern}/${entry.name}'s metadata differs from its copy record`,
					at
				);
		});
		for (const file of files.keys()) {
			const located = locate(file);
			if (
				located?.kind === 'copy' &&
				located.library === library &&
				!listedCopies.has(`${located.pattern}/${located.name}`)
			)
				checker.add(
					'CATALOG_MISMATCH',
					path,
					`${located.pattern}/${located.name} has a copy record but is not listed`,
					'/copies'
				);
		}
	}
	const rules = files.get(rulesPath(library));
	if (rules && packDigest(rules) !== catalog.rules)
		checker.add(
			'DIGEST_MISMATCH',
			path,
			`${rulesPath(library)} does not match its digest`,
			'/rules'
		);
	if (packContentDigest(files, library) !== catalog.digest)
		checker.add('DIGEST_MISMATCH', path, 'The pack digest does not match its files', '/digest');
}

/**
 * Checks a pack's files: each file's shape, identifiers and text limits, canonical bytes, and the
 * rules that span files. Accepts uniform format 1 and uniform format 2 libraries (mixing versions
 * within one library fails with `FORMAT_UNSUPPORTED`).
 */
export function checkPack(files: PackFiles, options: { form: PackForm }): PackCheck {
	const checker = new Checker(files);
	const libraries = new Map<
		string,
		{ components: string[]; patterns: string[]; copies: string[]; rules?: string; catalog?: string }
	>();
	const entry = (library: string) => {
		const found = libraries.get(library) ?? { components: [], patterns: [], copies: [] };
		libraries.set(library, found);
		return found;
	};
	for (const path of [...files.keys()].sort()) {
		if (DEPLOYER_FILES.has(path)) continue;
		const located = locate(path);
		if (!located) {
			checker.add(
				'LAYOUT_INVALID',
				shownPath(path),
				'Not a file a pack holds, or a library, tag, pattern or copy name that fails its pattern'
			);
			continue;
		}
		if (located.kind === 'rules') entry(located.library).rules = path;
		else if (located.kind === 'component') entry(located.library).components.push(path);
		else if (located.kind === 'pattern') entry(located.library).patterns.push(path);
		else if (located.kind === 'copy') entry(located.library).copies.push(path);
		else {
			entry(located.library).catalog = path;
			if (options.form === 'committed')
				checker.add('LAYOUT_INVALID', path, 'The committed form has no catalog; export writes it');
		}
	}
	for (const [library, found] of [...libraries].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const allPaths = [
			...(found.rules ? [found.rules] : []),
			...(options.form === 'exported' && found.catalog ? [found.catalog] : []),
			...found.components,
			...found.patterns,
			...found.copies,
		];
		const version = detectLibraryFormat(files, allPaths, found.rules);
		if (!found.rules)
			checker.add('LAYOUT_INVALID', rulesPath(library), 'Each library has a rules file');
		const rules = found.rules
			? version === 1
				? checker.parse<AnyRules>(found.rules, packRulesV1Schema, 1)
				: checker.parse<AnyRules>(found.rules, packRulesSchema, 2)
			: undefined;
		const components: Parsed<AnyComponent>[] = [];
		for (const path of found.components) {
			const parsed =
				version === 1
					? checker.parse<AnyComponent>(path, packComponentV1Schema, 1)
					: checker.parse<AnyComponent>(path, packComponentSchema, 2);
			if (!parsed) continue;
			checkComponent(checker, parsed, (locate(path) as { tag: string }).tag);
			components.push(parsed);
		}
		const patterns: Parsed<PackPattern>[] = [];
		for (const path of found.patterns) {
			if (version === 1) {
				checker.add('FORMAT_UNSUPPORTED', path, 'Pattern records require pack format 2', '/format');
				continue;
			}
			const parsed = checker.parse<PackPattern>(path, packPatternSchema, 2);
			if (!parsed) continue;
			checkPatternRecord(checker, parsed, (locate(path) as { pattern: string }).pattern);
			patterns.push(parsed);
		}
		const copies: Parsed<PackCopy>[] = [];
		for (const path of found.copies) {
			if (version === 1) {
				checker.add('FORMAT_UNSUPPORTED', path, 'Copy records require pack format 2', '/format');
				continue;
			}
			const parsed = checker.parse<PackCopy>(path, packCopySchema, 2);
			if (!parsed) continue;
			const loc = locate(path) as { pattern: string; name: string };
			checkCopyRecord(checker, parsed, loc.pattern, loc.name);
			copies.push(parsed);
		}
		checkLibrary(checker, library, options.form, version, components, patterns, copies, rules);
	}
	return {
		valid: checker.problems.length === 0,
		libraries: [...libraries.keys()].sort(),
		problems: checker.problems,
	};
}

/**
 * Writes one library's catalog, `data/<library>/library.json`, from its committed files. The
 * files must already pass `checkPack` in the committed form.
 */
export function packCatalog(files: PackFiles, library: string, stamp: PackStamp): string {
	const rules = files.get(rulesPath(library));
	if (!rules) throw new Error(`${rulesPath(library)} is missing`);
	const rulesFormat = peekFormat(rules) ?? PACK_FORMAT_VERSION;
	const compPrefix = `data/${library}/components/`;
	// By tag, as the format orders a catalog: a path's `.json` sorts after `-`, so path order would
	// put `x-grid-cell` before `x-grid`.
	const components = [...files.keys()]
		.filter((path) => path.startsWith(compPrefix))
		.map((path) => path.slice(compPrefix.length, -5))
		.sort()
		.map((tag) => `${compPrefix}${tag}.json`)
		.map((path) => {
			const bytes = files.get(path) as Uint8Array;
			const record = JSON.parse(new TextDecoder().decode(bytes)) as AnyComponent;
			return {
				tag: path.slice(compPrefix.length, -5),
				...(record.summary === undefined ? {} : { summary: record.summary }),
				status: record.status,
				digest: packDigest(bytes),
			};
		});
	if (rulesFormat === 1) {
		const catalog: PackLibraryV1 = {
			format: 1,
			library,
			title: stamp.title,
			package: stamp.package,
			prefix: stamp.prefix,
			...(stamp.revision === undefined ? {} : { revision: stamp.revision }),
			digest: packContentDigest(files, library),
			rules: packDigest(rules),
			components,
		};
		return canonicalJson(catalog);
	}
	const patPrefix = `data/${library}/patterns/`;
	const patternNames = [...files.keys()]
		.filter((path) => path.startsWith(patPrefix) && !path.slice(patPrefix.length).includes('/'))
		.map((path) => path.slice(patPrefix.length, -5))
		.sort();
	const patterns = patternNames.map((name) => {
		const path = patternPath(library, name);
		const bytes = files.get(path) as Uint8Array;
		const record = JSON.parse(new TextDecoder().decode(bytes)) as PackPattern;
		return {
			pattern: name,
			...(record.summary === undefined ? {} : { summary: record.summary }),
			status: record.status,
			...(record.replacedBy === undefined ? {} : { replacedBy: record.replacedBy }),
			scope: record.scope,
			facets: record.facets,
			digest: packDigest(bytes),
		};
	});
	const copyPairs = [...files.keys()]
		.filter((path) => {
			if (!path.startsWith(patPrefix) || !path.endsWith('.json')) return false;
			const rest = path.slice(patPrefix.length, -5);
			const parts = rest.split('/');
			return parts.length === 2;
		})
		.map((path) => {
			const [pat, name] = path.slice(patPrefix.length, -5).split('/') as [string, string];
			return [pat, name] as const;
		})
		.sort(comparePairs);
	const copies = copyPairs.map(([pat, name]) => {
		const path = copyPath(library, pat, name);
		const bytes = files.get(path) as Uint8Array;
		const record = JSON.parse(new TextDecoder().decode(bytes)) as PackCopy;
		return {
			pattern: pat,
			name,
			status: record.status,
			...(record.replacedBy === undefined ? {} : { replacedBy: record.replacedBy }),
			revision: record.revision,
			fingerprint: record.fingerprint,
			digest: packDigest(bytes),
		};
	});
	const catalog: PackLibrary = {
		format: PACK_FORMAT_VERSION,
		library,
		title: stamp.title,
		package: stamp.package,
		prefix: stamp.prefix,
		...(stamp.revision === undefined ? {} : { revision: stamp.revision }),
		digest: packContentDigest(files, library),
		rules: packDigest(rules),
		components,
		patterns,
		copies,
	};
	return canonicalJson(catalog);
}

/** Reads every file under a pack's root, keyed by its `/`-separated relative path. */
export async function readPackFiles(root: string): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const absolute = join(entry.parentPath, entry.name);
		files.set(relative(root, absolute).split(sep).join('/'), await readFile(absolute));
	}
	return files;
}
