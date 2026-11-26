import { type Dirent, existsSync, statSync } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	getDefaultPatternsPackDir,
	isBuiltinDefaultPatternSource,
	loadDefaultPatterns,
} from './defaults.js';
import { guidePatternRegExp, type LoadedGuides } from './guides.js';
import { canonicalJson, packDigest } from './pack.js';
import { PACK_PATTERNS } from './pack-schema.js';
import type { ImplementationContexts, PatternFile, PatternSetupBinding } from './pattern-types.js';
import { type StoryPatternBinding, sameFile } from './stories.js';
import type {
	SpecimenEntry,
	ValidationIssue,
	ValidationReport,
	ValidationTarget,
} from './types.js';

/**
 * Pattern files and external `patternSources`: authored reusable UI contracts and portable
 * gates checked statically with no browser. Problems never stop a bench from opening;
 * `specimen-validate` reports every issue with bracket field paths.
 */

export const DEFAULT_PATTERNS_DIRECTORY = 'specimens/patterns';
export const DEFAULT_PATTERNS_GLOB = 'specimens/patterns/*/pattern.json';

export type PatternProblemCode =
	| 'GATE_NOT_PORTABLE'
	| 'PATTERN_UNKNOWN'
	| 'SETUP_UNKNOWN'
	| 'GATE_UNKNOWN'
	| 'TARGET_UNKNOWN'
	| 'DUPLICATE_ID'
	| 'WAIVER_REASON_REQUIRED'
	| 'PATTERN_APPROVAL_MISMATCH'
	| 'PATTERN_SCHEMA_INVALID'
	| 'PATTERN_TEXT_TOO_LONG'
	| 'PATTERN_TEXT_INVALID'
	| 'PATTERN_JSON_INVALID'
	| 'PATTERN_UNREADABLE';

export interface PatternProblem {
	severity: 'error' | 'warning' | 'deferred';
	code: PatternProblemCode;
	message: string;
	id?: string;
	/** File relative to the bench root as `./path`, when attributable to a file. */
	file?: string;
	exportName?: string;
	/** Bracket-notation field path, e.g. `gates.shows-choice.scenario[0]`. */
	field?: string;
}

export type LoadedPatternFile = PatternFile & { file: string };

export interface ExternalPattern {
	library: string;
	pattern: string;
	file: string;
	source: string;
	data: PatternFile;
}

export interface LoadedPatterns {
	/** Local pattern files found, as `./path` from root, sorted. */
	files: string[];
	/** Valid local patterns (those with no fatal JSON/unreadable/schema/portability error). */
	patterns: LoadedPatternFile[];
	/** External patterns resolved offline from `patternSources`, keyed by `<library>/<pattern>`. */
	external: Record<string, ExternalPattern>;
	/** Resolved pack root directories from `patternSources`. */
	sources: string[];
	/** Validated story-level setup bindings and contexts (keyed by story id), for play-free stories. */
	storySetups: Record<
		string,
		{ patternSetup?: PatternSetupBinding; contexts?: ImplementationContexts }
	>;
	problems: PatternProblem[];
}

const SUGGESTIONS: Record<PatternProblemCode, string> = {
	GATE_NOT_PORTABLE:
		'Replace selectors, attribute/property checks, capture steps, and custom events with portable { role, name } targets, a11y/focus/layout/validity/form expectations, or standard DOM events (input, change, submit, reset).',
	PATTERN_UNKNOWN:
		'Use a pattern id present in specimens/patterns/ or add the owning library to patternSources in specimen.config.json.',
	SETUP_UNKNOWN:
		"Name one of the pattern's declared setups keys, or declare the setup in pattern.json.",
	GATE_UNKNOWN:
		'Declare the gate under gates in pattern.json or remove the gate link from the keep statement.',
	TARGET_UNKNOWN:
		'Declare the target alias in setups.<setup>.targets or fix the target name in the gate step.',
	DUPLICATE_ID:
		'Give each statement, pattern, step, and case id a unique id; a statement lives in a pattern or in a guide, never both.',
	WAIVER_REASON_REQUIRED:
		'Record a waiver reason in waivedKeep for every dropped upstream keep statement, or restore the keep statement from the upstream pattern.',
	PATTERN_APPROVAL_MISMATCH:
		'Re-approve modified copied patterns through specimen-pattern-merge and decision-record rather than editing approved files directly.',
	PATTERN_SCHEMA_INVALID: 'Match @lushly-dev/specimen/pattern.schema.json.',
	PATTERN_TEXT_TOO_LONG:
		'Shorten the text within the pack limit (160 summary, 240 statement/setup).',
	PATTERN_TEXT_INVALID: 'Remove control characters, line breaks, and bidirectional overrides.',
	PATTERN_JSON_INVALID: 'Fix JSON syntax in the pattern file.',
	PATTERN_UNREADABLE: 'Check the path and file permissions in specimen.config.json.',
};

const UNSUPPORTED_GLOB = /[[\]()!]/;
const WELL_FORMED_BRACES = /^(?:[^{}]|\{[^{}]*\})*$/;
const GLOB_SEGMENT = /[*?{]/;
const LIBRARY_ID = /^[a-z][a-z0-9-]{0,63}$/;
const STANDARD_DOM_EVENTS = new Set(['input', 'change', 'submit', 'reset']);
const UNPORTABLE_TARGET_KEYS = ['selector', 'css', 'xpath', 'testId'] as const;
const NODE_EXPORT_CONDITIONS = new Set(['node', 'import', 'require', 'default']);
const DEFAULT_LAYOUT_PATTERN = /^specimens\/patterns\/([^/]+)\/pattern\.json$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContained(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
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

function toRootPath(root: string, absolutePath: string): string {
	return `./${relative(root, absolutePath).split(sep).join('/')}`;
}

async function walk(
	root: string,
	directory: string,
	found: string[],
	problems: PatternProblem[]
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code;
		if (reason !== 'ENOENT')
			problems.push({
				severity: 'error',
				code: 'PATTERN_UNREADABLE',
				message: `${toRootPath(root, directory)}: ${reason ?? 'unreadable'}`,
			});
		return;
	}
	for (const entry of entries) {
		const full = join(directory, entry.name);
		if (entry.isFile()) found.push(full);
		else if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
			await walk(root, full, found, problems);
	}
}

async function findPatternFiles(
	root: string,
	base: string,
	globs: readonly string[]
): Promise<{ files: string[]; problems: PatternProblem[] }> {
	const files = new Set<string>();
	const problems: PatternProblem[] = [];
	const unreadable = (pattern: string, why: string, file?: string) =>
		problems.push({
			severity: 'error',
			code: 'PATTERN_UNREADABLE',
			message: `Patterns path '${pattern}' ${why}`,
			...(file === undefined ? {} : { file }),
		});
	for (const pattern of globs) {
		const normalized = process.platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
		const segments = normalized.split('/');
		if (
			UNSUPPORTED_GLOB.test(normalized) ||
			!segments.every(
				(part) => WELL_FORMED_BRACES.test(part) && (part === '**' || !part.includes('**'))
			)
		) {
			unreadable(
				pattern,
				'uses an unsupported glob form (use only `*`, whole-segment `**`, `?`, and `{a,b}` within a segment)'
			);
			continue;
		}
		const firstGlob = segments.findIndex((part) => GLOB_SEGMENT.test(part));
		if (firstGlob < 0) {
			const literal = resolve(base, normalized);
			const resolvedLiteral = await realpath(literal).catch(() => literal);
			if (!isContained(root, resolvedLiteral)) {
				unreadable(pattern, 'reaches outside the root');
				continue;
			}
			const rootFile = toRootPath(root, resolvedLiteral);
			if (!existsSync(resolvedLiteral)) {
				unreadable(pattern, 'does not exist', rootFile);
				continue;
			}
			if (!statSync(resolvedLiteral).isFile()) {
				unreadable(pattern, 'is not a regular file', rootFile);
				continue;
			}
			files.add(resolvedLiteral);
			continue;
		}
		const start = resolve(base, segments.slice(0, firstGlob).join('/') || '.');
		const directory = await realpath(start).catch(() => start);
		if (!isContained(root, directory)) {
			unreadable(pattern, 'reaches outside the root');
			continue;
		}
		const matcher = guidePatternRegExp(segments.slice(firstGlob).join('/'));
		const found: string[] = [];
		await walk(root, directory, found, problems);
		const matched = found.filter((path) =>
			matcher.test(relative(directory, path).split(sep).join('/'))
		);
		for (const path of matched) files.add(path);
	}
	return {
		problems,
		files: [...files]
			.map((path) => toRootPath(root, path))
			.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
	};
}

/**
 * Resolve a conditional export value following Node's key-insertion-order rule:
 * evaluate keys in the order written in `package.json`, picking the first matching
 * runtime condition (`node`, `import`, `require`, `default`).
 */
function extractExportTarget(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const resolved = extractExportTarget(item);
			if (resolved !== undefined) return resolved;
		}
		return undefined;
	}
	if (!isPlainObject(value)) return undefined;
	for (const [key, nestedValue] of Object.entries(value)) {
		if (!NODE_EXPORT_CONDITIONS.has(key)) continue;
		const resolved = extractExportTarget(nestedValue);
		if (resolved !== undefined) return resolved;
	}
	return undefined;
}

/** Resolve `./pack` from a package.json `exports` map, supporting exact, conditional, and wildcard entries. */
function resolvePackagePackExport(exportsField: unknown): string | undefined {
	if (!isPlainObject(exportsField)) return undefined;
	if ('./pack' in exportsField) {
		return extractExportTarget(exportsField['./pack']);
	}
	// Match pattern/wildcard keys (e.g. `"./*": "./*"` or `"./pack/*": "./pack/*"`).
	let bestKey: string | undefined;
	let bestMatch: string | undefined;
	for (const [key, target] of Object.entries(exportsField)) {
		const star = key.indexOf('*');
		if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
		const prefix = key.slice(0, star);
		const suffix = key.slice(star + 1);
		if (!'./pack'.startsWith(prefix) || !'./pack'.endsWith(suffix)) continue;
		if ('./pack'.length < prefix.length + suffix.length) continue;
		const matched = './pack'.slice(prefix.length, './pack'.length - suffix.length);
		const rawTarget = extractExportTarget(target);
		if (rawTarget === undefined) continue;
		if (bestKey === undefined || prefix.length > bestKey.indexOf('*')) {
			bestKey = key;
			bestMatch = rawTarget.replaceAll('*', matched);
		}
	}
	return bestMatch;
}

function findNodeModulesPackageJson(startDir: string, packageName: string): string | undefined {
	const parts = packageName.split('/');
	if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;
	let current = startDir;
	while (true) {
		const candidate = join(current, 'node_modules', ...parts, 'package.json');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** Resolve one `patternSources` entry offline to a pack root directory, or throw with a clear reason. */
export async function resolvePatternSource(configFile: string, source: string): Promise<string> {
	if (isBuiltinDefaultPatternSource(source)) {
		const defaultsPack = getDefaultPatternsPackDir();
		if (!existsSync(defaultsPack) || !statSync(defaultsPack).isDirectory())
			throw new Error(`Bundled defaults pack for '${source}' is missing`);
		return realpath(defaultsPack);
	}
	const base = dirname(configFile);
	const looksLikePath =
		source.startsWith('.') ||
		source.startsWith('/') ||
		isAbsolute(source) ||
		existsSync(resolve(base, source));
	if (looksLikePath) {
		const candidate = resolve(base, source);
		if (!existsSync(candidate) || !statSync(candidate).isDirectory())
			throw new Error(`patternSources path '${source}' is not a readable directory`);
		return realpath(candidate);
	}
	const req = createRequire(configFile);
	let pkgJsonPath: string | undefined;
	try {
		pkgJsonPath = req.resolve(`${source}/package.json`);
	} catch {
		pkgJsonPath = findNodeModulesPackageJson(base, source);
	}
	if (pkgJsonPath !== undefined) {
		const pkgRoot = await realpath(dirname(pkgJsonPath));
		const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8')) as {
			exports?: unknown;
		};
		const packExport = resolvePackagePackExport(pkg.exports);
		if (packExport === undefined)
			throw new Error(`Package '${source}' does not export './pack' in package.json`);
		const resolved = resolve(pkgRoot, packExport);
		if (!existsSync(resolved))
			throw new Error(
				`Package '${source}' exports './pack' -> '${packExport}', which does not exist`
			);
		const realTarget = await realpath(resolved);
		if (!isContained(pkgRoot, realTarget))
			throw new Error(
				`Package '${source}' exports './pack' -> '${packExport}', which escapes the package directory`
			);
		return statSync(realTarget).isDirectory() ? realTarget : dirname(realTarget);
	}
	try {
		const resolved = req.resolve(`${source}/pack`);
		const dir = statSync(resolved).isDirectory() ? resolved : dirname(resolved);
		return realpath(dir);
	} catch {
		throw new Error(
			`Cannot resolve patternSources package '${source}' offline (expected a local pack directory or an installed package exporting './pack')`
		);
	}
}

function unportableTargetReason(target: unknown): string | undefined {
	if (!isPlainObject(target)) return undefined;
	for (const key of UNPORTABLE_TARGET_KEYS) {
		if (key in target)
			return `uses non-portable '${key}' targeting instead of portable { role, name }`;
	}
	return undefined;
}

function stepHasSelector(step: Record<string, unknown>): string | undefined {
	const direct = unportableTargetReason(step);
	if (direct) return direct;
	if ('target' in step) {
		const targetReason = unportableTargetReason(step.target);
		if (targetReason) return targetReason;
	}
	if (isPlainObject(step.action)) {
		const actionReason = unportableTargetReason(step.action);
		if (actionReason) return actionReason;
		for (const key of ['click', 'focus', 'hover', 'fill', 'press', 'target']) {
			const nested = unportableTargetReason(step.action[key]);
			if (nested) return nested;
		}
	}
	if (isPlainObject(step.expect)) {
		const expectReason = unportableTargetReason(step.expect);
		if (expectReason) return expectReason;
		if ('target' in step.expect) {
			const nested = unportableTargetReason(step.expect.target);
			if (nested) return nested;
		}
	}
	return undefined;
}

function unportableStepReason(step: unknown): string | undefined {
	if (!isPlainObject(step)) return undefined;
	const selectorReason = stepHasSelector(step);
	if (selectorReason) return selectorReason;
	if ('command' in step)
		return 'uses a plugin `command` step, which is not portable across implementations';
	if ('capture' in step)
		return 'uses a `capture` step inside a gate; pass `capture` to specimen-run instead';
	if (isPlainObject(step.expect)) {
		if ('state' in step.expect)
			return 'uses a `state` expectation reading a DOM attribute or JS property';
		if (
			'event' in step.expect &&
			typeof step.expect.event === 'string' &&
			!STANDARD_DOM_EVENTS.has(step.expect.event)
		)
			return `expects custom event '${step.expect.event}'; only standard DOM events (input, change, submit, reset) are portable`;
	}
	return undefined;
}

type PatternMarkers = { TEXT_TOO_LONG: string; TEXT_INVALID: string };

interface RawZodIssue {
	code?: string;
	message: string;
	path: readonly PropertyKey[];
	params?: { pack?: string };
	errors?: readonly (readonly RawZodIssue[])[];
}

function schemaProblemCode(issue: RawZodIssue, markers: PatternMarkers): PatternProblemCode {
	const marker = issue.params?.pack;
	if (marker === markers.TEXT_TOO_LONG) return 'PATTERN_TEXT_TOO_LONG';
	if (marker === markers.TEXT_INVALID) return 'PATTERN_TEXT_INVALID';
	return 'PATTERN_SCHEMA_INVALID';
}

/**
 * Unwrap Zod 4 `invalid_union` issues when a union branch failed on a `packText` marker
 * (`TEXT_TOO_LONG` / `TEXT_INVALID`) so text-limit and control-character failures inside
 * gate steps keep their exact error code and full nested bracket path.
 */
function flattenZodIssues(
	issues: readonly RawZodIssue[],
	markers: PatternMarkers,
	prefix: readonly PropertyKey[] = []
): Array<{ code: PatternProblemCode; message: string; path: readonly PropertyKey[] }> {
	const out: Array<{ code: PatternProblemCode; message: string; path: readonly PropertyKey[] }> =
		[];
	const collectMarked = (
		issue: RawZodIssue,
		basePath: readonly PropertyKey[]
	): Array<{ code: PatternProblemCode; message: string; path: readonly PropertyKey[] }> => {
		const marker = issue.params?.pack;
		if (marker === markers.TEXT_TOO_LONG || marker === markers.TEXT_INVALID) {
			return [
				{
					code: schemaProblemCode(issue, markers),
					message: issue.message,
					path: [...basePath, ...issue.path],
				},
			];
		}
		if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
			const nested: Array<{
				code: PatternProblemCode;
				message: string;
				path: readonly PropertyKey[];
			}> = [];
			for (const branch of issue.errors) {
				for (const sub of branch) {
					nested.push(...collectMarked(sub, [...basePath, ...issue.path]));
				}
			}
			return nested;
		}
		return [];
	};
	for (const issue of issues) {
		if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
			const marked = collectMarked(issue, prefix);
			if (marked.length > 0) {
				const seen = new Set<string>();
				for (const item of marked) {
					const dedupKey = `${item.code}\0${fieldOf(item.path)}\0${item.message}`;
					if (seen.has(dedupKey)) continue;
					seen.add(dedupKey);
					out.push(item);
				}
				continue;
			}
		}
		out.push({
			code: schemaProblemCode(issue, markers),
			message: issue.message,
			path: [...prefix, ...issue.path],
		});
	}
	return out;
}

interface PortabilityScan {
	unportableTargets: Set<string>;
	unportableSteps: Set<string>;
}

function scanPortability(
	raw: unknown,
	label: string,
	file: string | undefined,
	problems: PatternProblem[]
): PortabilityScan {
	const unportableTargets = new Set<string>();
	const unportableSteps = new Set<string>();
	if (!isPlainObject(raw)) return { unportableTargets, unportableSteps };
	if (isPlainObject(raw.setups)) {
		for (const [setupKey, setupVal] of Object.entries(raw.setups)) {
			if (!isPlainObject(setupVal) || !isPlainObject(setupVal.targets)) continue;
			for (const [alias, targetVal] of Object.entries(setupVal.targets)) {
				const reason = unportableTargetReason(targetVal);
				if (reason) {
					unportableTargets.add(`${setupKey}\0${alias}`);
					problems.push({
						severity: 'error',
						code: 'GATE_NOT_PORTABLE',
						message: `${label}: target '${alias}' in setup '${setupKey}' ${reason}`,
						...(file === undefined ? {} : { file }),
						field: `setups.${setupKey}.targets.${alias}`,
					});
				}
			}
		}
	}
	if (isPlainObject(raw.gates)) {
		for (const [gateKey, gateVal] of Object.entries(raw.gates)) {
			if (!isPlainObject(gateVal) || !Array.isArray(gateVal.scenario)) continue;
			gateVal.scenario.forEach((step, index) => {
				const reason = unportableStepReason(step);
				if (reason) {
					unportableSteps.add(`${gateKey}\0${index}`);
					problems.push({
						severity: 'error',
						code: 'GATE_NOT_PORTABLE',
						message: `${label}: gate '${gateKey}' step ${index} ${reason}`,
						...(file === undefined ? {} : { file }),
						field: `gates.${gateKey}.scenario[${index}]`,
					});
				}
			});
		}
	}
	return { unportableTargets, unportableSteps };
}

function isSuppressedPath(path: readonly PropertyKey[], scan: PortabilityScan): boolean {
	if (
		path[0] === 'setups' &&
		typeof path[1] === 'string' &&
		path[2] === 'targets' &&
		typeof path[3] === 'string' &&
		scan.unportableTargets.has(`${path[1]}\0${path[3]}`)
	)
		return true;
	if (
		path[0] === 'gates' &&
		typeof path[1] === 'string' &&
		path[2] === 'scenario' &&
		typeof path[3] === 'number' &&
		scan.unportableSteps.has(`${path[1]}\0${path[3]}`)
	)
		return true;
	return false;
}

function checkGateSemantics(
	raw: Record<string, unknown>,
	label: string,
	file: string | undefined,
	scan: PortabilityScan,
	problems: PatternProblem[]
): number {
	const before = problems.length;
	const setups = isPlainObject(raw.setups) ? raw.setups : undefined;
	const gates = isPlainObject(raw.gates) ? raw.gates : undefined;
	if (Array.isArray(raw.keep)) {
		raw.keep.forEach((item, index) => {
			if (!isPlainObject(item) || typeof item.gate !== 'string') return;
			if (!gates || !Object.hasOwn(gates, item.gate)) {
				problems.push({
					severity: 'error',
					code: 'GATE_UNKNOWN',
					message: `${label}: keep[${index}] references undeclared gate '${item.gate}'`,
					...(file === undefined ? {} : { file }),
					field: `keep[${index}].gate`,
				});
			}
		});
	}
	if (!gates) return problems.length - before;
	for (const [gateKey, gateVal] of Object.entries(gates)) {
		if (!isPlainObject(gateVal)) continue;
		const setupKey = typeof gateVal.setup === 'string' ? gateVal.setup : undefined;
		const setupObj =
			setupKey !== undefined &&
			setups &&
			Object.hasOwn(setups, setupKey) &&
			isPlainObject(setups[setupKey])
				? (setups[setupKey] as Record<string, unknown>)
				: undefined;
		if (setupKey !== undefined && !setupObj) {
			problems.push({
				severity: 'error',
				code: 'SETUP_UNKNOWN',
				message: `${label}: gate '${gateKey}' references undeclared setup '${setupKey}'`,
				...(file === undefined ? {} : { file }),
				field: `gates.${gateKey}.setup`,
			});
		}
		const setupTargets = setupObj && isPlainObject(setupObj.targets) ? setupObj.targets : undefined;
		if (!Array.isArray(gateVal.scenario)) continue;
		const seenStepIds = new Set<string>();
		gateVal.scenario.forEach((step, index) => {
			if (scan.unportableSteps.has(`${gateKey}\0${index}`)) return;
			if (!isPlainObject(step)) return;
			const stepId = typeof step.id === 'string' ? step.id : undefined;
			if (stepId !== undefined && seenStepIds.has(stepId)) {
				problems.push({
					severity: 'error',
					code: 'DUPLICATE_ID',
					message: `${label}: gate '${gateKey}' declares duplicate step id '${stepId}'`,
					...(file === undefined ? {} : { file }),
					field: `gates.${gateKey}.scenario[${index}].id`,
				});
			}
			const checkAlias = (alias: unknown, field: string) => {
				if (typeof alias !== 'string' || !setupTargets) return;
				if (!Object.hasOwn(setupTargets, alias)) {
					problems.push({
						severity: 'error',
						code: 'TARGET_UNKNOWN',
						message: `${label}: gate '${gateKey}' references undeclared target '${alias}' (not in setup '${setupKey}')`,
						...(file === undefined ? {} : { file }),
						field,
					});
				}
			};
			if (isPlainObject(step.action)) {
				for (const actionKey of ['click', 'focus', 'hover', 'fill'] as const) {
					if (actionKey in step.action) {
						checkAlias(
							step.action[actionKey],
							`gates.${gateKey}.scenario[${index}].action.${actionKey}`
						);
					}
				}
				if ('press' in step.action && step.action.target !== undefined) {
					checkAlias(step.action.target, `gates.${gateKey}.scenario[${index}].action.target`);
				}
			}
			if (isPlainObject(step.expect)) {
				if (step.expect.target !== undefined) {
					checkAlias(step.expect.target, `gates.${gateKey}.scenario[${index}].expect.target`);
				}
				if ('event' in step.expect && typeof step.expect.since === 'string') {
					if (!seenStepIds.has(step.expect.since)) {
						problems.push({
							severity: 'error',
							code: 'PATTERN_SCHEMA_INVALID',
							message: `${label}: gate '${gateKey}' step ${index} event.since '${step.expect.since}' must reference an earlier step id in the same gate`,
							...(file === undefined ? {} : { file }),
							field: `gates.${gateKey}.scenario[${index}].expect.since`,
						});
					}
				}
			}
			if (stepId !== undefined) seenStepIds.add(stepId);
		});
	}
	return problems.length - before;
}

export interface LoadPatternsOptions {
	root: string;
	configFile: string;
	patterns?: readonly string[];
	patternSources?: readonly string[];
	localLibrary?: string;
	guides?: LoadedGuides;
	entries: readonly SpecimenEntry[];
	storyBindings?: readonly StoryPatternBinding[];
}

/**
 * Find, read, and statically validate local pattern files, offline `patternSources`,
 * guide `implements` links, and specimen/story setup bindings with no browser.
 */
export async function loadPatterns(options: LoadPatternsOptions): Promise<LoadedPatterns> {
	const { root, configFile, localLibrary, guides, entries, storyBindings = [] } = options;
	const base = dirname(configFile);
	const {
		patternFileSchema,
		patternMarkers,
		patternSetupBindingSchema,
		implementationContextsSchema,
	} = await import('./pattern-schema.js');

	let globs: readonly string[];
	if (options.patterns !== undefined) {
		globs = options.patterns;
	} else {
		const defaultDir = resolve(base, DEFAULT_PATTERNS_DIRECTORY);
		globs =
			existsSync(defaultDir) && statSync(defaultDir).isDirectory() ? [DEFAULT_PATTERNS_GLOB] : [];
	}

	const { files, problems } = await findPatternFiles(root, base, globs);
	const loaded: LoadedPatterns = {
		files,
		patterns: [],
		external: {},
		sources: [],
		storySetups: {},
		problems,
	};

	const knownExternalPatternIds = new Set<string>();

	// 1. Load and validate external `patternSources` offline.
	for (const source of options.patternSources ?? []) {
		let packRoot: string;
		try {
			packRoot = await resolvePatternSource(configFile, source);
		} catch (error) {
			problems.push({
				severity: 'error',
				code: 'PATTERN_UNREADABLE',
				message: (error as Error).message,
			});
			continue;
		}
		loaded.sources.push(packRoot);
		const dataDir = join(packRoot, 'data');
		let libEntries: Dirent[];
		try {
			libEntries = await readdir(dataDir, { withFileTypes: true });
		} catch {
			problems.push({
				severity: 'error',
				code: 'PATTERN_UNREADABLE',
				message: `patternSources '${source}' has no readable data/ directory`,
			});
			continue;
		}
		for (const libEntry of libEntries) {
			if (!libEntry.isDirectory() || !LIBRARY_ID.test(libEntry.name)) continue;
			const library = libEntry.name;
			const patternsDir = join(dataDir, library, 'patterns');
			if (!existsSync(patternsDir)) continue;
			let patternEntries: Dirent[];
			try {
				patternEntries = await readdir(patternsDir, { withFileTypes: true });
			} catch (error) {
				problems.push({
					severity: 'error',
					code: 'PATTERN_UNREADABLE',
					message: `patternSources '${source}' data/${library}/patterns: ${(error as Error).message}`,
				});
				continue;
			}
			for (const entry of patternEntries) {
				if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
				const full = join(patternsDir, entry.name);
				const expectedName = entry.name.slice(0, -5);
				const label = `${source}:data/${library}/patterns/${entry.name}`;
				const fileRef = isContained(root, full) ? toRootPath(root, full) : undefined;
				let raw: unknown;
				try {
					const bytes = await readFile(full);
					raw = JSON.parse(decoder.decode(bytes));
				} catch (error) {
					problems.push({
						severity: 'error',
						code:
							error instanceof SyntaxError || error instanceof TypeError
								? 'PATTERN_JSON_INVALID'
								: 'PATTERN_UNREADABLE',
						message: `${label}: ${(error as Error).message}`,
						...(fileRef === undefined ? {} : { file: fileRef }),
					});
					continue;
				}
				// Strip Pack Format 2 record envelope fields (`format`, `implementations`) if present.
				const candidate = isPlainObject(raw)
					? Object.fromEntries(
							Object.entries(raw).filter(([key]) => key !== 'format' && key !== 'implementations')
						)
					: raw;
				const scan = scanPortability(candidate, label, fileRef, problems);
				const parsed = patternFileSchema.safeParse(candidate);
				let hasSchemaErrors = false;
				if (!parsed.success) {
					const flattened = flattenZodIssues(
						parsed.error.issues as unknown as RawZodIssue[],
						patternMarkers
					);
					for (const issue of flattened) {
						if (isSuppressedPath(issue.path, scan)) continue;
						hasSchemaErrors = true;
						problems.push({
							severity: 'error',
							code: issue.code,
							message: `${label}: ${issue.message}`,
							...(fileRef === undefined ? {} : { file: fileRef }),
							field: fieldOf(issue.path),
						});
					}
				}
				const semanticErrors = isPlainObject(candidate)
					? checkGateSemantics(candidate, label, fileRef, scan, problems)
					: 0;
				const rawPatternId =
					isPlainObject(candidate) && typeof candidate.pattern === 'string'
						? candidate.pattern
						: undefined;
				if (rawPatternId !== undefined) knownExternalPatternIds.add(`${library}/${rawPatternId}`);
				if (
					!parsed.success ||
					hasSchemaErrors ||
					scan.unportableTargets.size > 0 ||
					scan.unportableSteps.size > 0 ||
					semanticErrors > 0
				)
					continue;
				if (parsed.data.pattern !== expectedName) {
					problems.push({
						severity: 'error',
						code: 'PATTERN_SCHEMA_INVALID',
						message: `${label}: pattern '${parsed.data.pattern}' does not match filename '${expectedName}.json'`,
						...(fileRef === undefined ? {} : { file: fileRef }),
						field: 'pattern',
					});
					continue;
				}
				const key = `${library}/${parsed.data.pattern}`;
				const existing = loaded.external[key];
				if (existing) {
					problems.push({
						severity: 'error',
						code: 'DUPLICATE_ID',
						message: `${label}: external pattern '${key}' is also provided by ${existing.source}`,
						...(fileRef === undefined ? {} : { file: fileRef }),
						field: 'pattern',
					});
					continue;
				}
				loaded.external[key] = {
					library,
					pattern: parsed.data.pattern,
					file: full,
					source,
					data: parsed.data as PatternFile,
				};
			}
		}
	}

	// 2. Load and validate local pattern files.
	const statementIds = new Map<string, string>();
	for (const guide of guides?.components ?? []) {
		for (const section of ['usage', 'a11y'] as const) {
			for (const statement of guide[section] ?? []) {
				if (!statementIds.has(statement.id)) statementIds.set(statement.id, guide.file);
			}
		}
	}
	for (const rule of guides?.rules ?? []) {
		if (!statementIds.has(rule.id)) statementIds.set(rule.id, rule.file);
	}

	const patternIds = new Map<string, string>();
	const validLocalPatternsById = new Map<string, LoadedPatternFile>();
	const knownLocalPatternIds = new Set<string>();

	for (const file of files) {
		let bytes: Uint8Array;
		try {
			bytes = await readFile(resolve(root, file));
		} catch (error) {
			problems.push({
				severity: 'error',
				code: 'PATTERN_UNREADABLE',
				message: `${file}: ${(error as Error).message}`,
				file,
			});
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(decoder.decode(bytes));
		} catch (error) {
			problems.push({
				severity: 'error',
				code: 'PATTERN_JSON_INVALID',
				message: `${file}: ${(error as Error).message}`,
				file,
			});
			continue;
		}

		const scan = scanPortability(raw, file, file, problems);
		const parsed = patternFileSchema.safeParse(raw);
		let hasOtherSchemaErrors = false;
		if (!parsed.success) {
			const flattened = flattenZodIssues(
				parsed.error.issues as unknown as RawZodIssue[],
				patternMarkers
			);
			for (const issue of flattened) {
				if (isSuppressedPath(issue.path, scan)) continue;
				hasOtherSchemaErrors = true;
				problems.push({
					severity: 'error',
					code: issue.code,
					message: `${file}: ${issue.message}`,
					file,
					field: fieldOf(issue.path),
				});
			}
		}

		if (isPlainObject(raw)) {
			// Default layout parent directory rule: applies only to `specimens/patterns/<dir>/pattern.json` relative to config dir.
			if (typeof raw.pattern === 'string') {
				const relFromBase = relative(base, resolve(root, file)).split(sep).join('/');
				const defaultLayout = DEFAULT_LAYOUT_PATTERN.exec(relFromBase);
				if (defaultLayout && defaultLayout[1] !== raw.pattern) {
					problems.push({
						severity: 'error',
						code: 'PATTERN_SCHEMA_INVALID',
						message: `${file}: pattern id '${raw.pattern}' must equal its parent directory '${defaultLayout[1]}'`,
						file,
						field: 'pattern',
					});
				}
			}

			// Pattern id uniqueness.
			if (typeof raw.pattern === 'string') {
				knownLocalPatternIds.add(raw.pattern);
				const first = patternIds.get(raw.pattern);
				if (first !== undefined) {
					problems.push({
						severity: 'error',
						code: 'DUPLICATE_ID',
						message: `${file}: pattern id '${raw.pattern}' is also declared in ${first}`,
						file,
						field: 'pattern',
					});
				} else {
					patternIds.set(raw.pattern, file);
				}
			}

			// Statement id uniqueness across patterns, component guides, and shared rules.
			for (const section of ['useWhen', 'avoidWhen', 'keep', 'customize'] as const) {
				const list = raw[section];
				if (!Array.isArray(list)) continue;
				list.forEach((item, index) => {
					if (!isPlainObject(item) || typeof item.id !== 'string') return;
					const first = statementIds.get(item.id);
					if (first !== undefined) {
						problems.push({
							severity: 'error',
							code: 'DUPLICATE_ID',
							message: `${file}: statement id '${item.id}' is also used in ${first}`,
							file,
							field: `${section}[${index}].id`,
						});
					} else {
						statementIds.set(item.id, file);
					}
				});
			}

			// Gate/setup/target/step-id/since semantic checks.
			checkGateSemantics(raw, file, file, scan, problems);
		}

		if (
			parsed.success &&
			scan.unportableTargets.size === 0 &&
			scan.unportableSteps.size === 0 &&
			!hasOtherSchemaErrors
		) {
			const record: LoadedPatternFile = { ...(parsed.data as PatternFile), file };
			loaded.patterns.push(record);
			if (!validLocalPatternsById.has(record.pattern))
				validLocalPatternsById.set(record.pattern, record);
		}
	}

	// 3. Same-library `replacedBy` references and copied-pattern waiver / approval integrity checks.
	let cachedDefaultPatterns: Record<string, PatternFile> | undefined;
	const getDefaultPatterns = async () => {
		if (!cachedDefaultPatterns) {
			cachedDefaultPatterns = await loadDefaultPatterns().catch(() => ({}));
		}
		return cachedDefaultPatterns;
	};

	const hasDerivedPatterns = loaded.patterns.some((p) => p.derivedFrom !== undefined);
	const latestApprovedPatternDigest = new Map<
		string,
		{ decidedAt: string; id: string; digest: string }
	>();
	const openForkCardPatterns = new Set<string>();
	if (hasDerivedPatterns) {
		const decDir = join(root, 'specimens', 'decisions');
		if (existsSync(decDir)) {
			const decEntries = await readdir(decDir, { withFileTypes: true }).catch(() => [] as Dirent[]);
			const parsedDecisions: Array<{
				id: string;
				kind?: string;
				chosen?: string;
				decidedAt: string;
				decidedByKind?: string;
				supersedes?: string | string[];
				patternDigests?: Record<string, string>;
			}> = [];
			const supersededIds = new Set<string>();
			for (const entry of decEntries) {
				if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
				try {
					const dec = JSON.parse(await readFile(join(decDir, entry.name), 'utf8')) as {
						id?: string;
						kind?: string;
						chosen?: string;
						decidedAt?: string;
						decidedBy?: { kind?: string };
						supersedes?: unknown;
						patternDigests?: Record<string, string>;
					};
					const decId = typeof dec.id === 'string' ? dec.id : entry.name;
					if (typeof dec.supersedes === 'string') {
						supersededIds.add(dec.supersedes);
					} else if (Array.isArray(dec.supersedes)) {
						for (const item of dec.supersedes) {
							if (typeof item === 'string') supersededIds.add(item);
						}
					}
					parsedDecisions.push({
						id: decId,
						kind: dec.kind,
						chosen: dec.chosen,
						decidedAt: typeof dec.decidedAt === 'string' ? dec.decidedAt : '',
						decidedByKind: dec.decidedBy?.kind,
						patternDigests: isPlainObject(dec.patternDigests)
							? (dec.patternDigests as Record<string, string>)
							: undefined,
					});
				} catch {
					// Ignore unreadable/non-decision files here; decision-check validates them separately.
				}
			}
			for (const dec of parsedDecisions) {
				if (
					dec.kind !== 'card' ||
					dec.chosen !== 'approve' ||
					supersededIds.has(dec.id) ||
					(dec.decidedByKind !== 'person' && dec.decidedByKind !== 'test') ||
					!dec.patternDigests
				) {
					continue;
				}
				for (const [qualKey, digestVal] of Object.entries(dec.patternDigests)) {
					if (typeof digestVal !== 'string') continue;
					const prev = latestApprovedPatternDigest.get(qualKey);
					if (
						!prev ||
						dec.decidedAt > prev.decidedAt ||
						(dec.decidedAt === prev.decidedAt && dec.id > prev.id)
					) {
						latestApprovedPatternDigest.set(qualKey, {
							decidedAt: dec.decidedAt,
							id: dec.id,
							digest: digestVal,
						});
					}
				}
			}
		}
		const cardDir = join(root, 'specimens', 'cards');
		if (existsSync(cardDir)) {
			const cardEntries = await readdir(cardDir, { withFileTypes: true }).catch(
				() => [] as Dirent[]
			);
			for (const entry of cardEntries) {
				if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
				try {
					const card = JSON.parse(await readFile(join(cardDir, entry.name), 'utf8')) as {
						status?: string;
						patternAction?: { kind?: string; pattern?: string };
					};
					if (
						(card.status === 'open' ||
							card.status === 'changes-requested' ||
							card.status === 'deferred' ||
							card.status === 'provisional') &&
						card.patternAction?.kind === 'fork' &&
						typeof card.patternAction.pattern === 'string'
					) {
						openForkCardPatterns.add(card.patternAction.pattern);
					}
				} catch {
					// Ignore malformed cards here.
				}
			}
		}
	}

	for (const pattern of loaded.patterns) {
		if (pattern.replacedBy !== undefined && !pattern.replacedBy.includes('/')) {
			if (!knownLocalPatternIds.has(pattern.replacedBy)) {
				problems.push({
					severity: 'error',
					code: 'PATTERN_UNKNOWN',
					message: `${pattern.file}: replacedBy references unknown same-library pattern '${pattern.replacedBy}'`,
					file: pattern.file,
					field: 'replacedBy',
				});
			}
		}

		// Duplicate `waivedKeep` ids.
		const seenWaivers = new Set<string>();
		(pattern.waivedKeep ?? []).forEach((waiver, index) => {
			if (seenWaivers.has(waiver.id)) {
				problems.push({
					severity: 'error',
					code: 'DUPLICATE_ID',
					message: `${pattern.file}: waivedKeep[${index}] duplicates keep statement id '${waiver.id}'`,
					file: pattern.file,
					field: `waivedKeep[${index}].id`,
				});
			} else {
				seenWaivers.add(waiver.id);
			}
		});

		// Copied-pattern `WAIVER_REASON_REQUIRED` check for dropped upstream `keep` statements.
		if (pattern.derivedFrom) {
			const extKey = `${pattern.derivedFrom.library}/${pattern.derivedFrom.pattern}`;
			const extPattern =
				loaded.external[extKey]?.data ??
				(pattern.derivedFrom.library === 'afd-defaults'
					? (await getDefaultPatterns())[pattern.derivedFrom.pattern]
					: undefined);
			const upstreamKeepIds = new Set<string>();
			const upstreamNonKeepIds = new Set<string>();
			if (extPattern) {
				for (const item of extPattern.keep ?? []) {
					if (Object.hasOwn(pattern.derivedFrom.statements, item.id)) {
						upstreamKeepIds.add(item.id);
					}
				}
				for (const section of ['useWhen', 'avoidWhen', 'customize'] as const) {
					for (const item of extPattern[section] ?? []) {
						upstreamNonKeepIds.add(item.id);
					}
				}
			}
			const localKeepIds = new Set((pattern.keep ?? []).map((item) => item.id));
			const allLocalIds = new Set<string>([
				...localKeepIds,
				...(pattern.useWhen ?? []).map((item) => item.id),
				...(pattern.avoidWhen ?? []).map((item) => item.id),
				...(pattern.customize ?? []).map((item) => item.id),
			]);
			const validWaivedIds = new Set(
				(pattern.waivedKeep ?? [])
					.filter((item) => item.reason.trim().length > 0)
					.map((item) => item.id)
			);
			const mustBeWaived = new Set<string>();
			for (const stmtId of Object.keys(pattern.derivedFrom.statements)) {
				const knownKeep = upstreamKeepIds.has(stmtId) || stmtId.includes('.keep.');
				if (knownKeep && !localKeepIds.has(stmtId)) {
					mustBeWaived.add(stmtId);
					continue;
				}
				// Fail closed when a derived statement is dropped locally and its original section
				// cannot be confirmed as non-keep from the resolved upstream pattern.
				if (!allLocalIds.has(stmtId) && !upstreamNonKeepIds.has(stmtId)) {
					mustBeWaived.add(stmtId);
				}
			}
			for (const keepId of [...mustBeWaived].sort()) {
				if (!validWaivedIds.has(keepId)) {
					problems.push({
						severity: 'error',
						code: 'WAIVER_REASON_REQUIRED',
						message: `${pattern.file}: dropped upstream keep statement '${keepId}' requires a waiver reason in waivedKeep`,
						file: pattern.file,
						field: 'waivedKeep',
					});
				}
			}

			// Approval digest integrity check when a copied pattern claims approved (or omits approvalStatus while fork card is open).
			if (pattern.approvalStatus !== 'proposed' && openForkCardPatterns.has(pattern.pattern)) {
				problems.push({
					severity: 'error',
					code: 'PATTERN_APPROVAL_MISMATCH',
					message: `${pattern.file}: pattern '${pattern.pattern}' cannot be approved while its fork approval card is still open`,
					file: pattern.file,
					field: 'approvalStatus',
				});
			} else if (pattern.approvalStatus === 'approved') {
				const primaryKey = `${localLibrary ?? 'local'}/${pattern.pattern}`;
				const approvedEntry = latestApprovedPatternDigest.get(primaryKey);
				if (!approvedEntry) {
					problems.push({
						severity: 'error',
						code: 'PATTERN_APPROVAL_MISMATCH',
						message: `${pattern.file}: approved copied pattern '${primaryKey}' has no matching person approval decision in specimens/decisions/`,
						file: pattern.file,
						field: 'approvalStatus',
					});
				} else {
					const { file: _ignoredFile, ...patternWithoutFile } = pattern;
					const currentDigest = packDigest(canonicalJson(patternWithoutFile));
					if (currentDigest !== approvedEntry.digest) {
						problems.push({
							severity: 'error',
							code: 'PATTERN_APPROVAL_MISMATCH',
							message: `${pattern.file}: approved pattern '${pattern.pattern}' was modified after approval decision '${approvedEntry.id}'`,
							file: pattern.file,
							field: 'approvalStatus',
						});
					}
				}
			}
		}
	}

	// 4. Component guide `implements` links (existence and resolved-identity uniqueness).
	const isKnownPattern = (library: string | undefined, patternId: string): boolean => {
		if (library === undefined) return knownLocalPatternIds.has(patternId);
		if (localLibrary !== undefined && library === localLibrary)
			return (
				knownLocalPatternIds.has(patternId) ||
				knownExternalPatternIds.has(`${library}/${patternId}`)
			);
		return knownExternalPatternIds.has(`${library}/${patternId}`);
	};
	const resolveValidPattern = (
		library: string | undefined,
		patternId: string
	): PatternFile | undefined => {
		if (library === undefined) return validLocalPatternsById.get(patternId);
		if (localLibrary !== undefined && library === localLibrary)
			return (
				validLocalPatternsById.get(patternId) ?? loaded.external[`${library}/${patternId}`]?.data
			);
		return loaded.external[`${library}/${patternId}`]?.data;
	};

	for (const guide of guides?.components ?? []) {
		const seenResolved = new Set<string>();
		guide.implements?.forEach((claim, index) => {
			const library = typeof claim === 'string' ? undefined : claim.library;
			const patternId = typeof claim === 'string' ? claim : claim.pattern;
			const resolvedKey = `${library ?? localLibrary ?? ''}\0${patternId}`;
			if (seenResolved.has(resolvedKey)) {
				problems.push({
					severity: 'error',
					code: 'DUPLICATE_ID',
					message: `${guide.file}: implements[${index}] duplicates pattern '${library ? `${library}/${patternId}` : patternId}'`,
					file: guide.file,
					field: `implements[${index}]`,
				});
			} else {
				seenResolved.add(resolvedKey);
			}
			if (!isKnownPattern(library, patternId)) {
				const ref = library ? `${library}/${patternId}` : patternId;
				problems.push({
					severity: 'error',
					code: 'PATTERN_UNKNOWN',
					message: `${guide.file}: implements[${index}] references unknown pattern '${ref}'`,
					file: guide.file,
					field: `implements[${index}]`,
				});
			}
		});
	}

	// 5. Setup bindings (native specimens and retained stories) and synthesized gate id collisions.
	const storyBindingById = new Map<string, StoryPatternBinding>();
	for (const binding of storyBindings) storyBindingById.set(binding.id, binding);

	const explicitIds = new Set(entries.map((entry) => entry.id));
	const synthesizedIds = new Map<string, string>();

	for (const entry of entries) {
		const rawBinding = storyBindingById.get(entry.id);
		let resolvedBinding: PatternSetupBinding | undefined = entry.patternSetup;
		const isStory = entry.story !== undefined;
		const entryFile = isStory ? entry.module : toRootPath(root, resolve(base, entry.module));
		const setupField = isStory ? 'parameters.specimen.patternSetup' : 'patternSetup';
		const contextsField = isStory ? 'parameters.specimen.contexts' : 'contexts';

		const isPlayFreeStory = entry.story === undefined || entry.story.play === 'absent';
		if (rawBinding !== undefined) {
			let parsedStoryContexts: ImplementationContexts | undefined;
			if (rawBinding.contexts !== undefined && entry.contexts === undefined) {
				const parsedContexts = implementationContextsSchema.safeParse(rawBinding.contexts);
				if (!parsedContexts.success) {
					for (const issue of flattenZodIssues(
						parsedContexts.error.issues as unknown as RawZodIssue[],
						patternMarkers
					)) {
						problems.push({
							severity: 'error',
							code: issue.code,
							message: `${entry.id}: invalid ${contextsField}: ${issue.message}`,
							id: entry.id,
							file: entryFile,
							exportName: entry.exportName,
							field: issue.path.length ? `${contextsField}.${fieldOf(issue.path)}` : contextsField,
						});
					}
				} else {
					parsedStoryContexts = parsedContexts.data;
				}
			}
			let parsedStorySetup: PatternSetupBinding | undefined;
			if (rawBinding.patternSetup !== undefined && entry.patternSetup === undefined) {
				const parsedSetup = patternSetupBindingSchema.safeParse(rawBinding.patternSetup);
				if (!parsedSetup.success) {
					resolvedBinding = undefined;
					for (const issue of flattenZodIssues(
						parsedSetup.error.issues as unknown as RawZodIssue[],
						patternMarkers
					)) {
						problems.push({
							severity: 'error',
							code: issue.code,
							message: `${entry.id}: invalid ${setupField}: ${issue.message}`,
							id: entry.id,
							file: entryFile,
							exportName: entry.exportName,
							field: issue.path.length ? `${setupField}.${fieldOf(issue.path)}` : setupField,
						});
					}
				} else {
					resolvedBinding = parsedSetup.data;
					if (isPlayFreeStory) {
						parsedStorySetup = parsedSetup.data;
					}
				}
			}
			if (parsedStorySetup !== undefined || parsedStoryContexts !== undefined) {
				loaded.storySetups[entry.id] = {
					...(parsedStorySetup !== undefined ? { patternSetup: parsedStorySetup } : {}),
					...(parsedStoryContexts !== undefined ? { contexts: parsedStoryContexts } : {}),
				};
			}
		}

		if (!resolvedBinding) continue;

		if (!isPlayFreeStory) {
			problems.push({
				severity: 'error',
				code: 'PATTERN_SCHEMA_INVALID',
				message:
					entry.story?.play === 'present'
						? `${entry.id}: stories with a play function cannot serve as pattern setups`
						: `${entry.id}: stories whose play function cannot be statically confirmed absent cannot serve as pattern setups; make the story plainly play-free or use a native specimen setup`,
				id: entry.id,
				file: entryFile,
				exportName: entry.exportName,
				field: setupField,
			});
		}

		if (!isKnownPattern(resolvedBinding.library, resolvedBinding.pattern)) {
			const ref = resolvedBinding.library
				? `${resolvedBinding.library}/${resolvedBinding.pattern}`
				: resolvedBinding.pattern;
			problems.push({
				severity: 'error',
				code: 'PATTERN_UNKNOWN',
				message: `${entry.id}: ${setupField} references unknown pattern '${ref}'`,
				id: entry.id,
				file: entryFile,
				...(isStory ? { exportName: entry.exportName } : {}),
				field: setupField,
			});
			continue;
		}
		const targetPattern = resolveValidPattern(resolvedBinding.library, resolvedBinding.pattern);
		// If the pattern exists but failed its own validation, skip cascading setup/gate checks.
		if (!targetPattern) continue;

		if (
			!isPlainObject(targetPattern.setups) ||
			!Object.hasOwn(targetPattern.setups, resolvedBinding.setup)
		) {
			problems.push({
				severity: 'error',
				code: 'SETUP_UNKNOWN',
				message: `${entry.id}: ${setupField} references undeclared setup '${resolvedBinding.setup}' on pattern '${resolvedBinding.pattern}'`,
				id: entry.id,
				file: entryFile,
				...(isStory ? { exportName: entry.exportName } : {}),
				field: `${setupField}.setup`,
			});
			continue;
		}
		if (!isPlainObject(targetPattern.gates)) continue;
		for (const [gateKey, gate] of Object.entries(targetPattern.gates)) {
			if (!isPlainObject(gate) || gate.setup !== resolvedBinding.setup) continue;
			const synthesized = `${entry.id}--gate--${gateKey}`;
			if (!PACK_PATTERNS.story.test(synthesized) || synthesized.length > 200) {
				problems.push({
					severity: 'error',
					code: 'PATTERN_SCHEMA_INVALID',
					message: `${entry.id}: synthesized gate case id '${synthesized}' must match lowercase PACK_PATTERNS.story (^[a-z0-9][a-z0-9._-]*$) and be at most 200 characters; give the bound setup a shorter lowercase id`,
					id: entry.id,
					file: entryFile,
					...(isStory ? { exportName: entry.exportName } : {}),
					field: setupField,
				});
				continue;
			}
			if (explicitIds.has(synthesized) || synthesizedIds.has(synthesized)) {
				problems.push({
					severity: 'error',
					code: 'DUPLICATE_ID',
					message: `${entry.id}: synthesized gate case id '${synthesized}' collides with an existing specimen or story id`,
					id: entry.id,
					file: entryFile,
					...(isStory ? { exportName: entry.exportName } : {}),
					field: setupField,
				});
			} else {
				synthesizedIds.set(synthesized, entry.id);
			}
		}
	}

	return loaded;
}

/** Add pattern file and binding problems to a validation report. */
export function withPatterns(
	report: ValidationReport,
	patterns: LoadedPatterns | undefined,
	root: string,
	target?: ValidationTarget
): ValidationReport {
	if (!patterns) return report;
	const matchesProblem = (problem: PatternProblem): boolean => {
		if (target?.id !== undefined) return problem.id === target.id;
		if (target?.file !== undefined)
			return problem.file !== undefined && sameFile(problem.file, target.file, root);
		return true;
	};
	const matchesFile = (file: string): boolean =>
		target?.id === undefined && (target?.file === undefined || sameFile(file, target.file, root));
	const issues: ValidationIssue[] = patterns.problems
		.filter(matchesProblem)
		.map(({ severity, code, message, id, file, exportName, field }) => ({
			severity,
			code,
			message,
			suggestion: SUGGESTIONS[code],
			...(id === undefined ? {} : { id }),
			...(file === undefined ? {} : { importPath: file }),
			...(exportName === undefined ? {} : { exportName }),
			...(field === undefined ? {} : { field }),
		}));
	const all = [...report.issues, ...issues];
	return {
		...report,
		valid: !all.some((issue) => issue.severity === 'error'),
		checked: report.checked + patterns.files.filter(matchesFile).length,
		issues: all,
	};
}
