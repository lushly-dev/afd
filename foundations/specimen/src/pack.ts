import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { z } from 'zod';
import {
	PACK_FORMAT_VERSION,
	PACK_PATTERNS,
	type PackComponent,
	type PackLibrary,
	type PackRules,
	packComponentSchema,
	packLibrarySchema,
	packRulesSchema,
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
	| 'DIGEST_MISMATCH';

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

/**
 * A library's pack digest: the SHA-256 of one line per committed file, `<path> <digest>\n`, sorted
 * by path. It covers the rules and every record, and not the catalog that states it.
 */
export function packContentDigest(files: PackFiles, library: string): string {
	const lines = [...files.keys()]
		.filter((path) => path === rulesPath(library) || path.startsWith(`data/${library}/components/`))
		.sort()
		.map((path) => `${path} ${packDigest(files.get(path) as Uint8Array)}\n`);
	return packDigest(lines.join(''));
}

type Located =
	| { kind: 'rules'; library: string }
	| { kind: 'library'; library: string }
	| { kind: 'component'; library: string; tag: string };

const isLibrary = (value: string | undefined): value is string =>
	value !== undefined && PACK_PATTERNS.library.test(value);
const isTag = (value: string | undefined): value is string =>
	value !== undefined && value.length <= 100 && PACK_PATTERNS.tag.test(value);

/** Where a path sits in the layout; a library or tag that fails its pattern sits nowhere. */
const locate = (path: string): Located | undefined => {
	const rules = /^rules\/([^/]+)\.json$/.exec(path);
	if (isLibrary(rules?.[1])) return { kind: 'rules', library: rules[1] };
	const catalog = /^data\/([^/]+)\/library\.json$/.exec(path);
	if (isLibrary(catalog?.[1])) return { kind: 'library', library: catalog[1] };
	const component = /^data\/([^/]+)\/components\/([^/]+)\.json$/.exec(path);
	if (isLibrary(component?.[1]) && isTag(component[2]))
		return { kind: 'component', library: component[1], tag: component[2] };
	return undefined;
};

/**
 * A path the layout does not place, shown only as far as its segments look like the format's own
 * names: the first segment that does not is cut, with what follows it, so no free text is shown.
 */
const shownPath = (path: string) => {
	const segments = path.split('/');
	const kept: string[] = [];
	for (const segment of segments) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(segment)) break;
		kept.push(segment);
	}
	return kept.length === segments.length ? path : [...kept, '…'].join('/');
};

const pointer = (path: readonly PropertyKey[]) =>
	path.length === 0
		? undefined
		: `/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;

const issueCode = (issue: z.core.$ZodIssue): PackProblemCode => {
	if (issue.code === 'custom') {
		const marker = (issue.params as { pack?: string } | undefined)?.pack;
		if (marker === TEXT_TOO_LONG) return 'TEXT_TOO_LONG';
		if (marker === TEXT_INVALID) return 'TEXT_INVALID';
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

class Checker {
	readonly problems: PackProblem[] = [];
	constructor(readonly files: PackFiles) {}

	add(code: PackProblemCode, path: string, message: string, at?: string) {
		this.problems.push(at === undefined ? { code, path, message } : { code, path, at, message });
	}

	/** Reads one file against its schema; reports and returns nothing when it does not hold. */
	parse<T>(path: string, schema: z.ZodType<T>): Parsed<T> | undefined {
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
		if (version !== PACK_FORMAT_VERSION) {
			this.add(
				'FORMAT_UNSUPPORTED',
				path,
				`Not a JSON object whose format is ${PACK_FORMAT_VERSION}`,
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
}

const memberLists = ['attributes', 'slots', 'events', 'commands', 'cssProperties'] as const;

function checkComponent(checker: Checker, { path, value }: Parsed<PackComponent>, tag: string) {
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
}

function checkLibrary(
	checker: Checker,
	library: string,
	form: PackForm,
	components: Parsed<PackComponent>[],
	rules: Parsed<PackRules> | undefined
) {
	// A tag exists when its record's file does, so one unreadable record is reported once.
	const tags = new Set(
		[...checker.files.keys()].flatMap((path) => {
			const located = locate(path);
			return located?.kind === 'component' && located.library === library ? [located.tag] : [];
		})
	);
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
	}
	if (form === 'exported') checkCatalog(checker, library, components);
}

function checkCatalog(checker: Checker, library: string, components: Parsed<PackComponent>[]) {
	const { files } = checker;
	const path = libraryPath(library);
	if (!files.has(path)) {
		checker.add('LAYOUT_INVALID', path, 'An exported pack has a catalog for each library');
		return;
	}
	const parsed = checker.parse<PackLibrary>(path, packLibrarySchema);
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
 * rules that span files. The exported form's catalog is checked against the records it lists.
 */
export function checkPack(files: PackFiles, options: { form: PackForm }): PackCheck {
	const checker = new Checker(files);
	const libraries = new Map<string, { components: string[]; rules?: string }>();
	const entry = (library: string) => {
		const found = libraries.get(library) ?? { components: [] };
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
				'Not a file a pack holds, or a library or tag that fails its pattern'
			);
			continue;
		}
		if (located.kind === 'rules') entry(located.library).rules = path;
		else if (located.kind === 'component') entry(located.library).components.push(path);
		else {
			entry(located.library);
			if (options.form === 'committed')
				checker.add('LAYOUT_INVALID', path, 'The committed form has no catalog; export writes it');
		}
	}
	for (const [library, found] of [...libraries].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (!found.rules)
			checker.add('LAYOUT_INVALID', rulesPath(library), 'Each library has a rules file');
		const rules = found.rules ? checker.parse<PackRules>(found.rules, packRulesSchema) : undefined;
		const components: Parsed<PackComponent>[] = [];
		for (const path of found.components) {
			const parsed = checker.parse<PackComponent>(path, packComponentSchema);
			if (!parsed) continue;
			checkComponent(checker, parsed, (locate(path) as { tag: string }).tag);
			components.push(parsed);
		}
		checkLibrary(checker, library, options.form, components, rules);
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
	const prefix = `data/${library}/components/`;
	const components = [...files.keys()]
		.filter((path) => path.startsWith(prefix))
		.sort()
		.map((path) => {
			const bytes = files.get(path) as Uint8Array;
			const record = JSON.parse(new TextDecoder().decode(bytes)) as PackComponent;
			return {
				tag: path.slice(prefix.length, -5),
				...(record.summary === undefined ? {} : { summary: record.summary }),
				status: record.status,
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
