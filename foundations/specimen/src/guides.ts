import type { Dirent } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { GuideComponent, GuideRules } from './guide-schema.js';
import { runGuideSource } from './guide-source.js';
import type { ComponentSchema } from './plugin.js';
import { sameFile } from './stories.js';
import type { ValidationIssue, ValidationReport, ValidationTarget } from './types.js';

/**
 * Guide files: authored statements about a library's components, found through the `guides`
 * configuration key and checked with no browser. A problem never stops a bench from opening;
 * `specimen-validate` reports it.
 */
export type GuideProblemCode =
	| 'GUIDE_PATTERN_INVALID'
	| 'GUIDE_NO_FILES'
	| 'GUIDE_UNREADABLE'
	| 'GUIDE_JSON_INVALID'
	| 'GUIDE_SCHEMA_INVALID'
	| 'GUIDE_TEXT_TOO_LONG'
	| 'GUIDE_TEXT_INVALID'
	| 'GUIDE_UNKNOWN_TAG'
	| 'GUIDE_UNKNOWN_MEMBER'
	| 'GUIDE_DUPLICATE_TAG'
	| 'GUIDE_DUPLICATE_ID'
	| 'GUIDE_SOURCE_FAILED';

export interface GuideProblem {
	/** `deferred`: a plugin's schema source, which runs in the page, could settle it. */
	severity: 'error' | 'warning' | 'deferred';
	code: GuideProblemCode;
	message: string;
	/** The guide file or guide source module, as `./path` from the root. */
	file?: string;
	/** Where in the file, such as `usage[1].id`. */
	field?: string;
}
export type LoadedComponentGuide = GuideComponent & { file: string };
export type LoadedGuideRule = GuideRules['rules'][number] & { file: string; index: number };
export interface LoadedGuides {
	/** Every guide file found, as `./path` from the root, sorted. */
	files: string[];
	/** The guide source modules, as `./path` from the root, in configuration order. */
	sources?: string[];
	/** The guides with no problem in their own file, in file order. */
	components: LoadedComponentGuide[];
	rules: LoadedGuideRule[];
	problems: GuideProblem[];
}

const SUGGESTIONS: Record<GuideProblemCode, string> = {
	GUIDE_PATTERN_INVALID:
		'Write the pattern inside the root using only `*`, a whole-segment `**`, `?` and `{a,b}` within one path segment.',
	GUIDE_NO_FILES: 'Check the pattern in the `guides` key, or remove it.',
	GUIDE_UNREADABLE: 'Check the path and file permissions, then validate again.',
	GUIDE_JSON_INVALID: 'Fix the file so it parses as JSON.',
	GUIDE_SCHEMA_INVALID:
		'Match the guide schema: `@lushly-dev/specimen/guide/component.schema.json`, or `rules.schema.json` for a file of shared rules.',
	GUIDE_TEXT_TOO_LONG:
		'Shorten it: a summary is at most 160 characters and a statement at most 240, so a reader can drop whole facts and never cut one.',
	GUIDE_TEXT_INVALID: 'Remove control characters, bidirectional controls and line breaks.',
	GUIDE_UNKNOWN_TAG:
		'Use a tag the custom elements manifest describes, or regenerate the manifest.',
	GUIDE_UNKNOWN_MEMBER:
		'Name a member the component has, or regenerate the manifest if the component gained it.',
	GUIDE_DUPLICATE_TAG: 'Keep one guide file per component.',
	GUIDE_DUPLICATE_ID: 'Give each statement and rule an id of its own; a claim names it by that id.',
	GUIDE_SOURCE_FAILED:
		'Fix the guide source module: its default export is a guide source (an id and rules()) or an array of them, and rules() returns an array of rules.',
};

const UNSUPPORTED = /[[\]()!]/;
const WELL_FORMED_BRACES = /^(?:[^{}]|\{[^{}]*\})*$/;
const GLOB_SEGMENT = /[*?{]/;

/** `*`, `**`, `?` and `{a,b}` over `/`-separated paths; the caller has refused anything else. */
export function guidePatternRegExp(pattern: string): RegExp {
	let source = '';
	let group = false;
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index] as string;
		if (character === '*' && pattern[index + 1] === '*') {
			if (pattern[index + 2] === '/') {
				source += '(?:[^/]+/)*';
				index += 2;
			} else {
				source += '.*';
				index += 1;
			}
		} else if (character === '*') source += '[^/]*';
		else if (character === '?') source += '[^/]';
		else if (character === '{') {
			source += '(?:';
			group = true;
		} else if (character === '}') {
			source += ')';
			group = false;
		} else if (character === ',' && group) source += '|';
		else source += character.replace(/[.+^$|\\/]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

/** Every file below `directory`. A directory that cannot be read is a problem, not a failure. */
async function walk(
	root: string,
	directory: string,
	found: string[],
	problems: GuideProblem[]
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code;
		if (reason !== 'ENOENT')
			problems.push({
				severity: 'error',
				code: 'GUIDE_UNREADABLE',
				message: `./${relative(root, directory).split(sep).join('/')}: ${reason ?? 'unreadable'}`,
			});
		return;
	}
	for (const entry of entries) {
		const path = join(directory, entry.name);
		// Links below the start are not followed, and `findFiles` resolves the start itself.
		if (entry.isFile()) found.push(path);
		else if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
			await walk(root, path, found, problems);
	}
}

async function findFiles(root: string, base: string, patterns: readonly string[]) {
	const files = new Set<string>();
	const problems: GuideProblem[] = [];
	const invalid = (pattern: string, why: string) =>
		problems.push({
			severity: 'error',
			code: 'GUIDE_PATTERN_INVALID',
			message: `Guides pattern '${pattern}' ${why}`,
		});
	for (const pattern of patterns) {
		const segments = pattern.split('/');
		if (
			UNSUPPORTED.test(pattern) ||
			!segments.every(
				(part) => WELL_FORMED_BRACES.test(part) && (part === '**' || !part.includes('**'))
			)
		) {
			invalid(
				pattern,
				'uses a form other than `*`, a whole-segment `**`, `?` and `{a,b}` within a segment'
			);
			continue;
		}
		const firstGlob = segments.findIndex((part) => GLOB_SEGMENT.test(part));
		const split = firstGlob < 0 ? segments.length - 1 : firstGlob;
		// The real path, so a link in the fixed part of a pattern cannot lead outside the root.
		const start = resolve(base, segments.slice(0, split).join('/') || '.');
		const directory = await realpath(start).catch(() => start);
		const fromRoot = relative(root, directory);
		if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
			invalid(pattern, 'reaches outside the root');
			continue;
		}
		const matcher = guidePatternRegExp(segments.slice(split).join('/'));
		const found: string[] = [];
		await walk(root, directory, found, problems);
		const matched = found.filter((path) =>
			matcher.test(relative(directory, path).split(sep).join('/'))
		);
		if (!matched.length)
			problems.push({
				severity: 'warning',
				code: 'GUIDE_NO_FILES',
				message: `Guides pattern '${pattern}' matched no file`,
			});
		for (const path of matched) files.add(path);
	}
	return {
		problems,
		files: [...files]
			.map((path) => `./${relative(root, path).split(sep).join('/')}`)
			.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
	};
}

/** Every name a statement may give for one component's members. */
function memberNames(schema: ComponentSchema): Set<string> {
	return new Set(
		[
			...schema.properties.flatMap((item) => [item.name, item.attribute]),
			...schema.attributes.map((item) => item.name),
			...schema.slots.map((item) => item.name),
			...schema.events.map((item) => item.name),
			...schema.cssProperties.map((item) => item.name),
			...schema.commands.map((item) => item.id),
		].filter((name): name is string => Boolean(name))
	);
}
/** The attributes a component has, which a rule's `appliesTo.attributes` names. */
export function attributeNames(schema: ComponentSchema): string[] {
	return [
		...schema.properties.flatMap((item) => (item.attribute ? [item.attribute] : [])),
		...schema.attributes.map((item) => item.name),
	];
}

/** The checks across files, against the manifest. */
function checkGuides(
	guides: LoadedGuides,
	schemas: Record<string, ComponentSchema>,
	pluginsMayAdd: boolean
): void {
	const report = (code: GuideProblemCode, message: string, file: string, field: string) =>
		guides.problems.push({ severity: 'error', code, message, file, field });
	// A plugin's schema source can add members only a browser can see.
	const unknownMember = (message: string, file: string, field: string) =>
		guides.problems.push({
			severity: pluginsMayAdd ? 'deferred' : 'error',
			code: 'GUIDE_UNKNOWN_MEMBER',
			message,
			file,
			field,
		});
	const ids = new Map<string, string>();
	const claim = (id: string, file: string, field: string) => {
		const first = ids.get(id);
		if (first !== undefined)
			report('GUIDE_DUPLICATE_ID', `Statement id '${id}' is also used in ${first}`, file, field);
		else ids.set(id, file);
	};
	const tags = new Map<string, string>();
	for (const guide of guides.components) {
		const { file, tag } = guide;
		const first = tags.get(tag);
		if (first !== undefined)
			report('GUIDE_DUPLICATE_TAG', `Component '${tag}' also has ${first}`, file, 'tag');
		else tags.set(tag, file);
		const schema = schemas[tag];
		if (!schema)
			report('GUIDE_UNKNOWN_TAG', `The manifest does not describe '${tag}'`, file, 'tag');
		if (guide.replacedBy !== undefined && !schemas[guide.replacedBy])
			report(
				'GUIDE_UNKNOWN_TAG',
				`The manifest does not describe '${guide.replacedBy}'`,
				file,
				'replacedBy'
			);
		const names = schema ? memberNames(schema) : undefined;
		for (const section of ['usage', 'a11y'] as const)
			guide[section]?.forEach((statement, index) => {
				claim(statement.id, file, `${section}[${index}].id`);
				if (names)
					statement.members?.forEach((member, position) => {
						if (!names.has(member))
							unknownMember(
								`'${tag}' has no member '${member}'`,
								file,
								`${section}[${index}].members[${position}]`
							);
					});
			});
	}
	const attributes = new Set(Object.values(schemas).flatMap(attributeNames));
	for (const rule of guides.rules) {
		const at = `rules[${rule.index}]`;
		claim(rule.id, rule.file, `${at}.id`);
		rule.appliesTo.tags?.forEach((tag, position) => {
			if (!schemas[tag])
				report(
					'GUIDE_UNKNOWN_TAG',
					`The manifest does not describe '${tag}'`,
					rule.file,
					`${at}.appliesTo.tags[${position}]`
				);
		});
		rule.appliesTo.attributes?.forEach((attribute, position) => {
			if (!attributes.has(attribute))
				unknownMember(
					`No component in the manifest has attribute '${attribute}'`,
					rule.file,
					`${at}.appliesTo.attributes[${position}]`
				);
		});
	}
}

type GuideMarkers = { TEXT_TOO_LONG: string; TEXT_INVALID: string };
function problemCode(issue: object, markers: GuideMarkers): GuideProblemCode {
	const marker = (issue as { params?: { pack?: string } }).params?.pack;
	if (marker === markers.TEXT_TOO_LONG) return 'GUIDE_TEXT_TOO_LONG';
	if (marker === markers.TEXT_INVALID) return 'GUIDE_TEXT_INVALID';
	return 'GUIDE_SCHEMA_INVALID';
}
function fieldOf(path: readonly PropertyKey[]): string {
	return path.reduce<string>(
		(text, part) =>
			typeof part === 'number'
				? `${text}[${part}]`
				: text
					? `${text}.${String(part)}`
					: String(part),
		''
	);
}

/**
 * Find, read and check the configured guide files, and run the guide source modules (absolute
 * paths inside the root), whose rules are checked as a file of rules is.
 */
export async function loadGuides(
	root: string,
	base: string,
	patterns: readonly string[],
	schemas: Record<string, ComponentSchema>,
	pluginsMayAdd: boolean,
	sources: readonly string[] = []
): Promise<LoadedGuides> {
	// Dynamic: a project with no guides never loads Zod.
	const { guideComponentSchema, guideRulesSchema, guideMarkers } = await import(
		'./guide-schema.js'
	);
	const { files, problems } = await findFiles(root, base, patterns);
	const guides: LoadedGuides = { files, components: [], rules: [], problems };
	for (const file of files) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(resolve(root, file), 'utf8'));
		} catch (error) {
			problems.push({
				severity: 'error',
				code: error instanceof SyntaxError ? 'GUIDE_JSON_INVALID' : 'GUIDE_UNREADABLE',
				message: `${file}: ${(error as Error).message}`,
				file,
			});
			continue;
		}
		// A file of shared rules is the one kind with a top-level `rules`.
		const isRules = typeof parsed === 'object' && parsed !== null && 'rules' in parsed;
		const result = (isRules ? guideRulesSchema : guideComponentSchema).safeParse(parsed);
		if (!result.success) {
			for (const issue of result.error.issues)
				problems.push({
					severity: 'error',
					code: problemCode(issue, guideMarkers),
					message: `${file}: ${issue.message}`,
					file,
					field: fieldOf(issue.path),
				});
			continue;
		}
		if (isRules)
			guides.rules.push(
				...(result.data as GuideRules).rules.map((rule, index) => ({ ...rule, file, index }))
			);
		else guides.components.push({ ...(result.data as GuideComponent), file });
	}
	if (sources.length) guides.sources = [];
	for (const module of sources) {
		const file = `./${relative(root, module).split(sep).join('/')}`;
		guides.sources?.push(file);
		let rules: unknown[];
		try {
			rules = await runGuideSource(root, base, module, schemas);
		} catch (error) {
			problems.push({
				severity: 'error',
				code: 'GUIDE_SOURCE_FAILED',
				message: `${file}: ${(error as Error).message}`,
				file,
			});
			continue;
		}
		const result = guideRulesSchema.safeParse({ rules });
		if (!result.success) {
			for (const issue of result.error.issues)
				problems.push({
					severity: 'error',
					code: problemCode(issue, guideMarkers),
					message: `${file}: ${issue.message}`,
					file,
					field: fieldOf(issue.path),
				});
			continue;
		}
		guides.rules.push(...result.data.rules.map((rule, index) => ({ ...rule, file, index })));
	}
	checkGuides(guides, schemas, pluginsMayAdd);
	return guides;
}

/** Add the guide files' problems to a validation report; a request for one story has none. */
export function withGuides(
	report: ValidationReport,
	guides: LoadedGuides | undefined,
	root: string,
	target?: ValidationTarget
): ValidationReport {
	if (!guides || target?.id !== undefined) return report;
	const inScope = (file?: string) =>
		target?.file === undefined || (file !== undefined && sameFile(file, target.file, root));
	const issues: ValidationIssue[] = guides.problems
		.filter((problem) => inScope(problem.file))
		.map(({ severity, code, message, file, field }) => ({
			severity,
			code,
			message,
			suggestion: SUGGESTIONS[code],
			...(file === undefined ? {} : { importPath: file }),
			...(field === undefined ? {} : { field }),
		}));
	const all = [...report.issues, ...issues];
	return {
		...report,
		valid: !all.some((issue) => issue.severity === 'error'),
		checked: report.checked + [...guides.files, ...(guides.sources ?? [])].filter(inScope).length,
		issues: all,
	};
}
