/**
 * Copied-pattern lifecycle commands (`specimen-pattern-fork`, `specimen-pattern-compare`,
 * `specimen-pattern-merge`), shared statement digest calculation, upstream resolution, and
 * pure-read `keep-waiver` card derivation (Agent-First Design Phase B2, #2559).
 */

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DesignCardRecord } from './card-types.js';
import { generateCardId, readAllCards, waiverReasonHash, writeCardRecord } from './cards.js';
import type { LoadedConfig } from './config.js';
import { compareCodeUnits, typedError } from './decisions-store.js';
import { getDefaultPatternsPackDir, isBuiltinDefaultPatternSource } from './defaults.js';
import {
	DEFAULT_PATTERNS_LIBRARY,
	DEFAULT_PATTERNS_SEMVER,
	type UnmeasuredEntry,
} from './design-types.js';
import { canonicalJson, packDigest } from './pack.js';
import { PACK_PATTERNS } from './pack-atoms.js';
import type {
	PatternCompareBulkEntry,
	PatternCompareBulkResult,
	PatternCompareRequest,
	PatternCompareResult,
	PatternCompareSingleResult,
	PatternCompareStatement,
	PatternCompareStatus,
	PatternForkRequest,
	PatternForkResult,
	PatternMergeRequest,
	PatternMergeResult,
	PatternStatementSection,
} from './pattern-fork-types.js';
import {
	parsePatternCompareRequest,
	parsePatternForkRequest,
	parsePatternMergeRequest,
} from './pattern-fork-validate.js';
import { DEFAULT_PATTERN_LIBRARY } from './pattern-gates.js';
import { patternFileSchema } from './pattern-schema.js';
import type {
	PatternDerivedFrom,
	PatternFile,
	PatternKeepStatement,
	PatternStatement,
	WaivedKeepEntry,
} from './pattern-types.js';
import { DEFAULT_PATTERNS_DIRECTORY, resolvePatternSource } from './patterns.js';
import { assertRealContained, assertRealFileContained, writeFileAtomic } from './sets.js';
import { parseConfig } from './validate.js';

export const BUILTIN_DEFAULTS_UPSTREAM_PREFIX = 'builtin:afd-defaults/';
const STATEMENT_SECTIONS: readonly PatternStatementSection[] = [
	'useWhen',
	'avoidWhen',
	'keep',
	'customize',
];

export function digestPatternText(text: string): string {
	return packDigest(text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainedPath(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Compute the canonical sha256 digest for a single pattern statement, covering its `text` and
 * (for gated `keep` statements) its paired `gate` and `setup` definitions so gate/setup edits
 * are detected during `specimen-pattern-compare` and `specimen-pattern-merge`.
 */
export function computeSingleStatementDigest(
	pattern: PatternFile,
	section: PatternStatementSection,
	statement: PatternStatement | PatternKeepStatement
): string {
	if (section !== 'keep') return digestPatternText(statement.text);
	const gateKey = (statement as PatternKeepStatement).gate;
	if (!gateKey) return digestPatternText(statement.text);
	const gateDef = pattern.gates?.[gateKey] ?? null;
	const setupDef = gateDef ? (pattern.setups?.[gateDef.setup] ?? null) : null;
	return digestPatternText(
		canonicalJson({
			text: statement.text,
			gate: gateKey,
			gateDef,
			setupDef,
		})
	);
}

/**
 * Compute the `derivedFrom.statements` digest map (strictly keyed by `PACK_PATTERNS.id`)
 * for every statement in a pattern file.
 */
export function computePatternStatementDigests(pattern: PatternFile): Record<string, string> {
	const digests: Record<string, string> = {};
	for (const section of STATEMENT_SECTIONS) {
		for (const stmt of pattern[section] ?? []) {
			digests[stmt.id] = computeSingleStatementDigest(pattern, section, stmt);
		}
	}
	return digests;
}

/**
 * Extract statement + paired `#gate`/`#setup` digests from an upstream pattern JSON object
 * for merge-card staleness verification (`card-decisions.ts` `UPSTREAM_CHANGED`).
 */
export function extractCardUpstreamDigests(
	patternObj: Record<string, unknown>
): Record<string, string> {
	const digests: Record<string, string> = {};
	const gates = isPlainObject(patternObj.gates) ? patternObj.gates : undefined;
	const setups = isPlainObject(patternObj.setups) ? patternObj.setups : undefined;

	for (const section of STATEMENT_SECTIONS) {
		const list = patternObj[section];
		if (!Array.isArray(list)) continue;
		for (const item of list) {
			if (
				typeof item === 'object' &&
				item !== null &&
				typeof (item as { id?: unknown }).id === 'string' &&
				typeof (item as { text?: unknown }).text === 'string'
			) {
				const rec = item as { id: string; text: string; gate?: unknown; setup?: unknown };
				const id = rec.id;
				digests[id] = digestPatternText(rec.text);
				if (rec.gate !== undefined) {
					const gateDef = typeof rec.gate === 'string' && gates ? gates[rec.gate] : undefined;
					digests[`${id}#gate`] =
						gateDef !== undefined
							? digestPatternText(canonicalJson({ gate: rec.gate, def: gateDef }))
							: digestPatternText(JSON.stringify(rec.gate));
					if (isPlainObject(gateDef) && typeof gateDef.setup === 'string' && setups) {
						const setupDef = setups[gateDef.setup];
						if (setupDef !== undefined) {
							digests[`${id}#setup`] = digestPatternText(
								canonicalJson({ setup: gateDef.setup, def: setupDef })
							);
						}
					}
				}
				if (rec.setup !== undefined) {
					digests[`${id}#setup`] = digestPatternText(JSON.stringify(rec.setup));
				}
			}
		}
	}
	return digests;
}

export interface ResolvedUpstreamPattern {
	library: string;
	pattern: string;
	version: string;
	revision: string;
	/** File path stored on merge cards (`relative/to/root` or `builtin:afd-defaults/<pattern>`). */
	cardUpstreamPath: string;
	/** Authoritative absolute path on disk. */
	absolutePath: string;
	raw: Record<string, unknown>;
	data: PatternFile;
}

interface PackLibraryMeta {
	version?: string;
	revision?: string;
}

async function readPackLibraryMeta(packRoot: string, library: string): Promise<PackLibraryMeta> {
	const catalogFile = join(packRoot, 'data', library, 'library.json');
	try {
		await assertRealFileContained(
			packRoot,
			catalogFile,
			`Upstream catalog escapes pack root: ${library}/library.json`
		);
		const raw = JSON.parse(await readFile(catalogFile, 'utf8')) as {
			package?: { version?: unknown };
			revision?: unknown;
		};
		return {
			...(typeof raw.package?.version === 'string' ? { version: raw.package.version } : {}),
			...(typeof raw.revision === 'string' ? { revision: raw.revision } : {}),
		};
	} catch {
		return {};
	}
}

function stripPackEnvelope(raw: Record<string, unknown>): PatternFile {
	const stripped = Object.fromEntries(
		Object.entries(raw).filter(([key]) => key !== 'format' && key !== 'implementations')
	);
	const parsed = patternFileSchema.safeParse(stripped);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Upstream pattern failed schema validation: ${parsed.error.message}`,
			'Verify that the upstream pattern pack conforms to Pack Format 2.'
		);
	}
	return parsed.data as PatternFile;
}

async function loadUpstreamCandidateFromPack(
	root: string,
	packRoot: string,
	library: string,
	pattern: string,
	isBuiltinDefaults: boolean
): Promise<ResolvedUpstreamPattern | undefined> {
	const patternFile = join(packRoot, 'data', library, 'patterns', `${pattern}.json`);
	if (!existsSync(patternFile) || !statSync(patternFile).isFile()) return undefined;
	await assertRealFileContained(
		packRoot,
		patternFile,
		`Upstream pattern file escapes pack root: ${library}/${pattern}`
	);
	const rawBytes = await readFile(patternFile);
	const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)) as Record<
		string,
		unknown
	>;
	const data = stripPackEnvelope(raw);
	const meta = await readPackLibraryMeta(packRoot, library);
	const version =
		meta.version ??
		(typeof raw.version === 'string' ? raw.version : undefined) ??
		(library === DEFAULT_PATTERNS_LIBRARY ? DEFAULT_PATTERNS_SEMVER : '0.0.0');
	const revision = meta.revision ?? packDigest(canonicalJson(data));
	const cardUpstreamPath = isBuiltinDefaults
		? `${BUILTIN_DEFAULTS_UPSTREAM_PREFIX}${pattern}`
		: isContainedPath(root, patternFile)
			? relative(root, patternFile).split(sep).join('/')
			: patternFile;
	return {
		library,
		pattern,
		version,
		revision,
		cardUpstreamPath,
		absolutePath: patternFile,
		raw,
		data,
	};
}

/**
 * Resolve `<library>/<pattern>` across configured `patternSources` and the bundled
 * `afd-defaults@1.0.0` pack, optionally matching a specific `upstreamVersion`.
 */
export async function resolveUpstreamPattern(
	config: LoadedConfig,
	library: string,
	pattern: string,
	upstreamVersion?: string
): Promise<ResolvedUpstreamPattern> {
	const candidates: ResolvedUpstreamPattern[] = [];
	const seenDirs = new Set<string>();

	// 1. Check configured patternSources in order (external packs can ship newer versions like 1.1.0).
	for (const source of config.config.patternSources ?? []) {
		let packRoot: string;
		try {
			packRoot = await resolvePatternSource(config.file, source);
		} catch {
			continue;
		}
		if (seenDirs.has(packRoot)) continue;
		seenDirs.add(packRoot);
		const isBuiltin = isBuiltinDefaultPatternSource(source);
		const found = await loadUpstreamCandidateFromPack(
			config.root,
			packRoot,
			library,
			pattern,
			isBuiltin
		);
		if (found) candidates.push(found);
	}

	// 2. Always fall back to bundled `afd-defaults@1.0.0` when library is `afd-defaults`.
	if (library === DEFAULT_PATTERNS_LIBRARY) {
		const builtinPack = getDefaultPatternsPackDir();
		if (!seenDirs.has(builtinPack) && existsSync(builtinPack)) {
			const found = await loadUpstreamCandidateFromPack(
				config.root,
				builtinPack,
				library,
				pattern,
				true
			);
			if (found) candidates.push(found);
		}
	}

	if (upstreamVersion !== undefined) {
		const exact = candidates.find((c) => c.version === upstreamVersion);
		if (exact) return exact;
		const available = candidates.map((c) => c.version).join(', ');
		throw typedError(
			'PATTERN_UNKNOWN',
			`Upstream pattern '${library}/${pattern}' at version '${upstreamVersion}' was not found${available ? ` (available versions: ${available})` : ''}.`,
			'Check the library, pattern id, and upstreamVersion in patternSources or omit upstreamVersion to use the configured default.'
		);
	}

	const first = candidates[0];
	if (first) return first;

	throw typedError(
		'PATTERN_UNKNOWN',
		`Upstream pattern '${library}/${pattern}' was not found in configured pattern libraries.`,
		'Check the library and pattern id in patternSources in specimen.config.json (or list installed packs via umbel: components-pattern-list).'
	);
}

function localPatternRelPath(pattern: string): string {
	return `${DEFAULT_PATTERNS_DIRECTORY}/${pattern}/pattern.json`;
}

function localPatternAbsPath(config: LoadedConfig, pattern: string): string {
	return resolve(dirname(config.file), localPatternRelPath(pattern));
}

async function readLocalPatternFile(
	config: LoadedConfig,
	pattern: string
): Promise<{ filePath: string; relPath: string; data: PatternFile }> {
	const absPath = localPatternAbsPath(config, pattern);
	const patternsRoot = resolve(dirname(config.file), DEFAULT_PATTERNS_DIRECTORY);
	if (existsSync(patternsRoot)) {
		await assertRealContained(
			config.root,
			patternsRoot,
			`Patterns directory escapes workspace root: ${DEFAULT_PATTERNS_DIRECTORY}`
		);
	}
	if (!existsSync(absPath)) {
		throw typedError(
			'PATTERN_UNKNOWN',
			`Local pattern '${pattern}' was not found under ${DEFAULT_PATTERNS_DIRECTORY}/.`,
			`Create a local copy first with specimen-pattern-fork or check pattern ids under ${DEFAULT_PATTERNS_DIRECTORY}/.`
		);
	}
	await assertRealFileContained(
		patternsRoot,
		absPath,
		`Pattern file escapes ${DEFAULT_PATTERNS_DIRECTORY}/: ${pattern}`
	);
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(absPath, 'utf8'));
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Local pattern '${pattern}' contains invalid JSON.`,
			`Fix JSON syntax in ${localPatternRelPath(pattern)} and retry.`
		);
	}
	const parsed = patternFileSchema.safeParse(raw);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Local pattern '${pattern}' failed schema validation: ${parsed.error.message}`,
			`Run specimen-validate on ${localPatternRelPath(pattern)} to inspect schema issues.`
		);
	}
	return {
		filePath: absPath,
		relPath: relative(config.root, absPath).split(sep).join('/'),
		data: parsed.data as PatternFile,
	};
}

function localLibraryOf(config: LoadedConfig): string {
	return config.config.pack?.library ?? DEFAULT_PATTERN_LIBRARY;
}

function defaultPatternUnmeasured(): UnmeasuredEntry[] {
	return [
		{
			area: 'screen-gates',
			reason:
				'Pattern comparison checks guidance statements statically and does not run browser gates.',
			addToMeasure: 'Run specimen-run against bound pattern setups to verify portable gates.',
		},
	];
}

/**
 * Copy an upstream pattern into `specimens/patterns/<target>/pattern.json` with `derivedFrom`
 * statement digests, mark it `approvalStatus: 'proposed'`, and open a guidance decision card
 * for person approval. Never overwrites an existing local pattern.
 */
export async function runPatternFork(
	config: LoadedConfig,
	rawRequest: PatternForkRequest
): Promise<PatternForkResult> {
	const request = parsePatternForkRequest(rawRequest);
	const slash = request.source.indexOf('/');
	const sourceLibrary = request.source.slice(0, slash);
	const sourcePattern = request.source.slice(slash + 1);
	const target = request.target ?? sourcePattern;

	const upstream = await resolveUpstreamPattern(config, sourceLibrary, sourcePattern);
	const targetAbs = localPatternAbsPath(config, target);
	const targetRel = relative(config.root, targetAbs).split(sep).join('/');
	const patternsRoot = resolve(dirname(config.file), DEFAULT_PATTERNS_DIRECTORY);
	await assertRealContained(
		config.root,
		targetAbs,
		`Target pattern path escapes workspace root: ${targetRel}`
	);
	if (existsSync(patternsRoot)) {
		await assertRealContained(
			config.root,
			patternsRoot,
			`Patterns directory escapes workspace root: ${DEFAULT_PATTERNS_DIRECTORY}`
		);
		await assertRealContained(
			patternsRoot,
			targetAbs,
			`Target pattern path must reside under ${DEFAULT_PATTERNS_DIRECTORY}/: ${targetRel}`
		);
	}

	if (existsSync(targetAbs)) {
		throw typedError(
			'ALREADY_EXISTS',
			`Local pattern '${target}' already exists at ${targetRel}.`,
			`Choose a different target id or inspect the existing copy with specimen-pattern-compare (pattern: '${target}').`,
			{ pattern: target, path: targetRel }
		);
	}

	const localLibrary = localLibraryOf(config);
	const bind = request.bind === true;
	const configRel = relative(config.root, config.file).split(sep).join('/');

	// Preflight pending `patternBindings` update before writing any file when `bind: true`.
	let origConfigText: string | undefined;
	let nextConfigText: string | undefined;
	if (bind) {
		await assertRealFileContained(
			config.root,
			config.file,
			`Config path escapes workspace root: ${configRel}`
		);
		origConfigText = await readFile(config.file, 'utf8');
		let configRaw: unknown;
		try {
			configRaw = JSON.parse(origConfigText);
		} catch {
			throw typedError(
				'VALIDATION_ERROR',
				`Specimen config '${configRel}' contains invalid JSON.`,
				'Fix JSON syntax in specimen.config.json before forking with bind: true.'
			);
		}
		if (!isPlainObject(configRaw)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Specimen config '${configRel}' must be a JSON object.`,
				'Fix specimen.config.json before forking with bind: true.'
			);
		}
		const bindings = isPlainObject(configRaw.patternBindings)
			? { ...(configRaw.patternBindings as Record<string, string>) }
			: {};
		bindings[request.source] = `${localLibrary}/${target}`;
		const nextConfig = {
			...configRaw,
			patternBindings: bindings,
		};
		try {
			parseConfig(nextConfig);
		} catch (error) {
			throw typedError(
				'VALIDATION_ERROR',
				`Recording pending patternBindings in '${configRel}' failed config validation: ${error instanceof Error ? error.message : String(error)}`,
				'Fix specimen.config.json before forking with bind: true.'
			);
		}
		nextConfigText = `${JSON.stringify(nextConfig, null, '\t')}\n`;
	}

	const statements = computePatternStatementDigests(upstream.data);
	const derivedFrom: PatternDerivedFrom = {
		library: upstream.library,
		pattern: upstream.pattern,
		version: upstream.version,
		revision: upstream.revision,
		statements,
	};

	const forked: PatternFile = {
		pattern: target,
		...(upstream.data.summary === undefined ? {} : { summary: upstream.data.summary }),
		...(upstream.data.status === undefined ? {} : { status: upstream.data.status }),
		approvalStatus: 'proposed',
		derivedFrom,
		scope: upstream.data.scope,
		...(upstream.data.facets === undefined ? {} : { facets: upstream.data.facets }),
		...(upstream.data.useWhen === undefined ? {} : { useWhen: upstream.data.useWhen }),
		...(upstream.data.avoidWhen === undefined ? {} : { avoidWhen: upstream.data.avoidWhen }),
		...(upstream.data.keep === undefined ? {} : { keep: upstream.data.keep }),
		...(upstream.data.customize === undefined ? {} : { customize: upstream.data.customize }),
		...(upstream.data.setups === undefined ? {} : { setups: upstream.data.setups }),
		...(upstream.data.gates === undefined ? {} : { gates: upstream.data.gates }),
	};

	await mkdir(dirname(targetAbs), { recursive: true });
	await assertRealContained(
		config.root,
		patternsRoot,
		`Patterns directory escapes workspace root: ${DEFAULT_PATTERNS_DIRECTORY}`
	);
	await assertRealContained(
		patternsRoot,
		targetAbs,
		`Target pattern path must reside under ${DEFAULT_PATTERNS_DIRECTORY}/: ${targetRel}`
	);

	const cardId = generateCardId();
	const cardRecord: DesignCardRecord = {
		card: cardId,
		scope: 'guidance',
		what: `Approve copied pattern ${localLibrary}/${target} forked from ${request.source}@${upstream.version}`,
		owner: 'product',
		touches: [targetRel, ...(bind ? [configRel] : [])],
		severity: 'major',
		visual: {
			kind: 'diff',
			summary: `Proposed local copy '${localLibrary}/${target}' forked from '${request.source}@${upstream.version}'${bind ? ' with pending patternBindings override' : ''}.`,
		},
		why: {
			findings: [
				{
					summary: `Forked ${Object.keys(statements).length} statements from ${request.source}@${upstream.version}; approval required before agents receive it by default.`,
					evidence: 'observed',
				},
			],
			reviewerCount: 1,
			split: '1-0',
			trigger: 'guidance-change',
		},
		effect: {
			gatesBefore: { passed: 0, failed: 0 },
			gatesAfter: { passed: 0, failed: 0 },
			checksSummary: `Staged ${Object.keys(statements).length} forked statement(s) as proposed.`,
			regression: false,
		},
		risk: {
			affects: [request.source, `${localLibrary}/${target}`],
			undoable: true,
		},
		status: 'open',
		patternAction: {
			kind: 'fork',
			library: localLibrary,
			pattern: target,
			patternPath: targetRel,
			source: request.source,
			bind,
			configPath: configRel,
		},
		createdAt: new Date().toISOString(),
	};

	let wrotePattern = false;
	let wroteConfig = false;
	try {
		await writeFileAtomic(targetAbs, `${JSON.stringify(forked, null, '\t')}\n`);
		wrotePattern = true;
		if (nextConfigText !== undefined) {
			await writeFileAtomic(config.file, nextConfigText);
			wroteConfig = true;
		}
		await writeCardRecord(config.root, cardRecord);
	} catch (error) {
		if (wroteConfig && origConfigText !== undefined) {
			await writeFileAtomic(config.file, origConfigText).catch(() => {});
		}
		if (wrotePattern) {
			await unlink(targetAbs).catch(() => {});
		}
		throw error;
	}

	return {
		pattern: target,
		path: targetRel,
		approvalStatus: 'proposed',
		derivedFrom,
		bindingStatus: bind ? 'pending-approval' : 'unbound',
		card: cardId,
		nextSteps: [
			`Have a person approve card '${cardId}' via decision-record to flip ${localLibrary}/${target} to approved${bind ? ` and activate patternBindings['${request.source}']` : ''}.`,
			`Edit ${targetRel} before approval if customizing statements, then run specimen-validate.`,
		],
	};
}

interface IndexedStatement {
	id: string;
	section: PatternStatementSection;
	statement: PatternStatement | PatternKeepStatement;
	digest: string;
	textDigest: string;
}

function indexPatternStatements(pattern: PatternFile): {
	byId: Map<string, IndexedStatement>;
	order: string[];
} {
	const byId = new Map<string, IndexedStatement>();
	const order: string[] = [];
	for (const section of STATEMENT_SECTIONS) {
		for (const stmt of pattern[section] ?? []) {
			order.push(stmt.id);
			byId.set(stmt.id, {
				id: stmt.id,
				section,
				statement: stmt,
				digest: computeSingleStatementDigest(pattern, section, stmt),
				textDigest: digestPatternText(stmt.text),
			});
		}
	}
	return { byId, order };
}

function inferSectionFromId(id: string): PatternStatementSection {
	if (id.includes('.keep.')) return 'keep';
	if (id.includes('.avoidWhen.') || id.includes('.avoid-when.')) return 'avoidWhen';
	if (id.includes('.useWhen.') || id.includes('.use-when.')) return 'useWhen';
	return 'customize';
}

interface ClassifiedStatement extends PatternCompareStatement {
	upstreamStatement?: PatternStatement | PatternKeepStatement;
	upstreamDigest?: string;
}

function matchesBaseDigest(
	entry: IndexedStatement,
	baseDigest: string,
	other?: IndexedStatement
): boolean {
	if (entry.digest === baseDigest) return true;
	// Compatibility for hand-authored fixtures that recorded text-only sha256 digests on gated keep statements.
	if (entry.section === 'keep' && entry.textDigest === baseDigest) {
		if (!other || entry.digest === other.digest) return true;
	}
	return false;
}

function classifyCopiedPattern(
	local: PatternFile,
	upstream: PatternFile
): {
	all: ClassifiedStatement[];
	waivers: WaivedKeepEntry[];
} {
	const derivedFrom = local.derivedFrom as PatternDerivedFrom;
	const localIndex = indexPatternStatements(local);
	const upstreamIndex = indexPatternStatements(upstream);
	const waiverMap = new Map((local.waivedKeep ?? []).map((w) => [w.id, w.reason]));
	const declinedMap = derivedFrom.declined ?? {};

	// Deterministic statement order: upstream section order first, then any local-only or dropped-only ids.
	const orderedIds: string[] = [];
	const seen = new Set<string>();
	const addId = (id: string) => {
		if (!seen.has(id)) {
			seen.add(id);
			orderedIds.push(id);
		}
	};
	for (const id of upstreamIndex.order) addId(id);
	for (const id of localIndex.order) addId(id);
	for (const id of Object.keys(derivedFrom.statements).sort(compareCodeUnits)) addId(id);

	const all: ClassifiedStatement[] = [];
	for (const id of orderedIds) {
		const loc = localIndex.byId.get(id);
		const up = upstreamIndex.byId.get(id);
		const baseDigest = derivedFrom.statements[id];
		const section: PatternStatementSection = up?.section ?? loc?.section ?? inferSectionFromId(id);

		let status: PatternCompareStatus;
		let waiverReason: string | undefined;

		const isDeclinedUpstream = (upEntry: IndexedStatement): boolean => {
			const declinedDigest = declinedMap[id];
			return (
				declinedDigest !== undefined &&
				(declinedDigest === upEntry.digest || declinedDigest === upEntry.textDigest)
			);
		};

		if (loc && up) {
			if (baseDigest !== undefined) {
				const localUnchanged = matchesBaseDigest(loc, baseDigest, up);
				const upstreamUnchanged = matchesBaseDigest(up, baseDigest, loc);
				if (localUnchanged && upstreamUnchanged) {
					status = 'unchanged';
				} else if (!localUnchanged && upstreamUnchanged) {
					status = 'changed-here';
				} else if (localUnchanged && !upstreamUnchanged) {
					status = isDeclinedUpstream(up) ? 'declined' : 'changed-upstream';
				} else {
					status =
						loc.digest === up.digest
							? 'unchanged'
							: isDeclinedUpstream(up)
								? 'declined'
								: 'changed-both';
				}
			} else {
				status =
					loc.digest === up.digest
						? 'unchanged'
						: isDeclinedUpstream(up)
							? 'declined'
							: 'changed-both';
			}
		} else if (loc && !up) {
			status = 'changed-here';
		} else if (!loc && baseDigest !== undefined) {
			if (section !== 'keep' && up && isDeclinedUpstream(up)) {
				status = 'declined';
			} else {
				status = 'dropped-here';
				if (section === 'keep') {
					waiverReason = waiverMap.get(id);
				}
			}
		} else if (!loc && up) {
			if (isDeclinedUpstream(up)) {
				status = 'declined';
			} else if (section === 'keep' && waiverMap.has(id)) {
				status = 'dropped-here';
				waiverReason = waiverMap.get(id);
			} else {
				status = 'added-upstream';
			}
		} else {
			continue;
		}

		all.push({
			id,
			section,
			status,
			...(waiverReason === undefined ? {} : { waiverReason }),
			...(loc ? { localText: loc.statement.text } : {}),
			...(up ? { upstreamText: up.statement.text } : {}),
			...(up ? { upstreamStatement: up.statement, upstreamDigest: up.digest } : {}),
		});
	}

	const waivers = (local.waivedKeep ?? []).map(({ id, reason }) => ({ id, reason }));
	return { all, waivers };
}

function stripInternalClassified(item: ClassifiedStatement): PatternCompareStatement {
	const { upstreamStatement: _, upstreamDigest: __, ...publicItem } = item;
	return publicItem;
}

async function listLocalPatternIds(config: LoadedConfig): Promise<string[]> {
	const dir = resolve(dirname(config.file), DEFAULT_PATTERNS_DIRECTORY);
	if (!existsSync(dir)) return [];
	await assertRealContained(
		config.root,
		dir,
		`Patterns directory escapes workspace root: ${DEFAULT_PATTERNS_DIRECTORY}`
	);
	const entries = await readdir(dir, { withFileTypes: true });
	const ids: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !PACK_PATTERNS.pattern.test(entry.name)) continue;
		const file = join(dir, entry.name, 'pattern.json');
		if (existsSync(file) && statSync(file).isFile()) {
			ids.push(entry.name);
		}
	}
	return ids.sort(compareCodeUnits);
}

/**
 * Compare one copied pattern (or all copied patterns in bulk summary mode when `pattern` is
 * omitted) statement-by-statement against its recorded `derivedFrom` upstream source.
 */
export async function runPatternCompare(
	config: LoadedConfig,
	rawRequest: PatternCompareRequest = {}
): Promise<PatternCompareResult> {
	const request = parsePatternCompareRequest(rawRequest);
	const onlyChanged = request.onlyChanged ?? true;
	const unmeasured = defaultPatternUnmeasured();

	if (request.pattern !== undefined) {
		const { data: local } = await readLocalPatternFile(config, request.pattern);
		if (!local.derivedFrom) {
			throw typedError(
				'NOT_A_COPIED_PATTERN',
				`Pattern '${request.pattern}' has no derivedFrom source and cannot be compared upstream.`,
				'Only patterns with derivedFrom (created by specimen-pattern-fork) can be compared or merged upstream.',
				{ pattern: request.pattern }
			);
		}
		const upstream = await resolveUpstreamPattern(
			config,
			local.derivedFrom.library,
			local.derivedFrom.pattern,
			request.upstreamVersion
		);
		const { all, waivers } = classifyCopiedPattern(local, upstream.data);
		const visible = (onlyChanged ? all.filter((s) => s.status !== 'unchanged') : all).map(
			stripInternalClassified
		);
		const hasUpstreamActionable = all.some(
			(s) =>
				s.status === 'changed-upstream' ||
				s.status === 'changed-both' ||
				s.status === 'added-upstream'
		);
		const nextSteps = hasUpstreamActionable
			? [
					`Run specimen-pattern-merge for '${request.pattern}' (upstreamVersion: '${upstream.version}') to stage chosen accept/decline updates onto a guidance card.`,
				]
			: [
					`No unmerged upstream changes for '${request.pattern}' against ${upstream.library}/${upstream.pattern}@${upstream.version}.`,
				];

		const result: PatternCompareSingleResult = {
			pattern: request.pattern,
			source: {
				library: local.derivedFrom.library,
				pattern: local.derivedFrom.pattern,
				baseVersion: local.derivedFrom.version,
				currentVersion: upstream.version,
			},
			statements: visible,
			waivers,
			nextSteps,
			unmeasured,
		};
		return result;
	}

	// Bulk summary mode across all copied patterns under `specimens/patterns/`.
	const patternIds = await listLocalPatternIds(config);
	const summaries: PatternCompareBulkEntry[] = [];
	for (const id of patternIds) {
		let local: PatternFile;
		try {
			local = (await readLocalPatternFile(config, id)).data;
		} catch {
			continue;
		}
		if (!local.derivedFrom) continue;
		const upstream = await resolveUpstreamPattern(
			config,
			local.derivedFrom.library,
			local.derivedFrom.pattern,
			request.upstreamVersion
		);
		const { all, waivers } = classifyCopiedPattern(local, upstream.data);
		const counts = {
			changedHere: 0,
			changedUpstream: 0,
			changedBoth: 0,
			droppedHere: 0,
			addedUpstream: 0,
			declined: 0,
		};
		for (const stmt of all) {
			if (stmt.status === 'changed-here') counts.changedHere += 1;
			else if (stmt.status === 'changed-upstream') counts.changedUpstream += 1;
			else if (stmt.status === 'changed-both') counts.changedBoth += 1;
			else if (stmt.status === 'dropped-here') counts.droppedHere += 1;
			else if (stmt.status === 'added-upstream') counts.addedUpstream += 1;
			else if (stmt.status === 'declined') counts.declined += 1;
		}
		summaries.push({
			pattern: id,
			source: {
				library: local.derivedFrom.library,
				pattern: local.derivedFrom.pattern,
				baseVersion: local.derivedFrom.version,
				currentVersion: upstream.version,
			},
			counts,
			waivers: waivers.length,
		});
	}

	const actionable = summaries.filter(
		(entry) =>
			entry.counts.changedUpstream > 0 ||
			entry.counts.changedBoth > 0 ||
			entry.counts.addedUpstream > 0
	);
	const nextSteps =
		actionable.length > 0
			? actionable.map(
					(entry) =>
						`Run specimen-pattern-compare and specimen-pattern-merge for '${entry.pattern}' to review upstream updates from ${entry.source.library}/${entry.source.pattern}@${entry.source.currentVersion}.`
				)
			: ['All copied patterns are up to date with their configured upstream sources.'];

	const bulkResult: PatternCompareBulkResult = {
		patterns: summaries,
		nextSteps,
		unmeasured,
	};
	return bulkResult;
}

function upsertStatement(
	list: PatternStatement[] | undefined,
	next: PatternStatement | PatternKeepStatement
): PatternStatement[] {
	const copy = [...(list ?? [])];
	const idx = copy.findIndex((item) => item.id === next.id);
	if (idx >= 0) {
		copy[idx] = next;
	} else {
		copy.push(next);
	}
	return copy;
}

/**
 * Stage selected upstream statement updates and explicit declines onto a guidance decision card
 * pinned to `upstreamVersion` and `upstreamDigests`. The live `pattern.json` stays untouched
 * until a person approves the card via `decision-record`.
 */
export async function runPatternMerge(
	config: LoadedConfig,
	rawRequest: PatternMergeRequest
): Promise<PatternMergeResult> {
	const request = parsePatternMergeRequest(rawRequest);
	const { relPath, data: local } = await readLocalPatternFile(config, request.pattern);
	if (!local.derivedFrom) {
		throw typedError(
			'NOT_A_COPIED_PATTERN',
			`Pattern '${request.pattern}' has no derivedFrom source and cannot be merged upstream.`,
			'Only patterns with derivedFrom (created by specimen-pattern-fork) can be compared or merged upstream.',
			{ pattern: request.pattern }
		);
	}

	const accept = request.accept ?? [];
	const decline = request.decline ?? [];
	const waivers = request.waivers ?? [];
	const resolutions = request.resolutions ?? [];

	const acceptSet = new Set<string>();
	for (const id of accept) {
		if (acceptSet.has(id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Duplicate statement id '${id}' in accept.`,
				'List each statement id at most once in accept.'
			);
		}
		acceptSet.add(id);
	}
	const declineSet = new Set<string>();
	for (const id of decline) {
		if (declineSet.has(id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Duplicate statement id '${id}' in decline.`,
				'List each statement id at most once in decline.'
			);
		}
		if (acceptSet.has(id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Statement id '${id}' cannot appear in both accept and decline.`,
				'Put each statement id in either accept or decline, not both.'
			);
		}
		declineSet.add(id);
	}

	const waiverMap = new Map<string, string>();
	for (const w of waivers) {
		if (waiverMap.has(w.id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Duplicate waiver id '${w.id}' in waivers.`,
				'Provide at most one waiver reason per declined keep statement.'
			);
		}
		waiverMap.set(w.id, w.reason);
	}

	const resolutionMap = new Map<string, (typeof resolutions)[number]>();
	for (const r of resolutions) {
		if (resolutionMap.has(r.id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Duplicate resolution id '${r.id}' in resolutions.`,
				'Provide at most one resolution entry per conflicted statement.'
			);
		}
		resolutionMap.set(r.id, r);
	}

	const upstream = await resolveUpstreamPattern(
		config,
		local.derivedFrom.library,
		local.derivedFrom.pattern,
		request.upstreamVersion
	);
	const { all } = classifyCopiedPattern(local, upstream.data);
	const classifiedById = new Map(all.map((item) => [item.id, item]));

	// Validate every referenced id, conflict resolution, and keep waiver BEFORE staging.
	for (const id of [...accept, ...decline]) {
		const entry = classifiedById.get(id);
		if (!entry?.upstreamStatement) {
			throw typedError(
				'VALIDATION_ERROR',
				`Statement id '${id}' does not exist in upstream pattern '${upstream.library}/${upstream.pattern}@${upstream.version}'.`,
				`Run specimen-pattern-compare for '${request.pattern}' to inspect valid upstream statement ids.`
			);
		}
	}

	for (const r of resolutions) {
		const entry = classifiedById.get(r.id);
		if (!acceptSet.has(r.id) || entry?.status !== 'changed-both') {
			throw typedError(
				'VALIDATION_ERROR',
				`Resolution for '${r.id}' is only allowed for a changed-both statement included in accept.`,
				`Remove resolutions['${r.id}'] or include a changed-both statement in accept.`
			);
		}
		if (entry.section !== 'keep' && (r.gate !== undefined || r.setup !== undefined)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Resolution for non-keep statement '${r.id}' cannot specify gate or setup.`,
				`Remove gate and setup from resolutions['${r.id}'].`
			);
		}
	}

	const localKeepById = new Map((local.keep ?? []).map((item) => [item.id, item]));
	const pairedGateSetupSnapshot = (
		pattern: PatternFile,
		gateKey: string | undefined
	): { gateKey: string | null; gateDef: unknown; setupKey: string | null; setupDef: unknown } => {
		if (!gateKey) return { gateKey: null, gateDef: null, setupKey: null, setupDef: null };
		const gateDef = pattern.gates?.[gateKey] ?? null;
		const setupKey = gateDef?.setup ?? null;
		const setupDef = setupKey ? (pattern.setups?.[setupKey] ?? null) : null;
		return { gateKey, gateDef, setupKey, setupDef };
	};

	for (const id of accept) {
		const entry = classifiedById.get(id) as ClassifiedStatement;
		if (entry.status === 'changed-both') {
			const res = resolutionMap.get(id);
			if (!res) {
				throw typedError(
					'STATEMENT_CONFLICT',
					`Statement '${id}' changed both locally and upstream; accepting it requires an explicit merged entry in resolutions.`,
					`Provide a resolutions entry with merged text (and gate/setup when paired) for '${id}'.`,
					{ pattern: request.pattern, statement: id }
				);
			}
			if (entry.section === 'keep') {
				const locKeep = localKeepById.get(id);
				const upKeep = entry.upstreamStatement as PatternKeepStatement;
				const locPair = pairedGateSetupSnapshot(local, locKeep?.gate);
				const upPair = pairedGateSetupSnapshot(upstream.data, upKeep.gate);
				const gateDiverged =
					locPair.gateKey !== upPair.gateKey ||
					canonicalJson(locPair.gateDef) !== canonicalJson(upPair.gateDef);
				const setupDiverged =
					locPair.setupKey !== upPair.setupKey ||
					canonicalJson(locPair.setupDef) !== canonicalJson(upPair.setupDef);
				if ((gateDiverged || setupDiverged) && res.gate === undefined) {
					throw typedError(
						'STATEMENT_CONFLICT',
						`Statement '${id}' has conflicting paired gate/setup definitions between local and upstream; resolution must name an explicit gate${setupDiverged ? ' (and setup)' : ''}.`,
						`Add gate${setupDiverged ? ' and setup' : ''} to resolutions['${id}'] so paired definitions are not silently overwritten.`,
						{ pattern: request.pattern, statement: id }
					);
				}
			}
		}
	}

	for (const w of waivers) {
		const entry = classifiedById.get(w.id);
		if (!declineSet.has(w.id) || entry?.section !== 'keep') {
			throw typedError(
				'VALIDATION_ERROR',
				`Waiver for '${w.id}' must correspond to a keep statement listed in decline.`,
				'Only provide waivers for upstream keep statements being declined.'
			);
		}
	}

	for (const id of decline) {
		const entry = classifiedById.get(id) as ClassifiedStatement;
		if (entry.section === 'keep' && !waiverMap.has(id)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Declining upstream keep statement '${id}' requires a matching reason in waivers.`,
				`Provide waivers: [{ id: '${id}', reason: '...' }] when declining an upstream keep statement.`
			);
		}
	}

	// Track gates and setups used by untouched local `keep` statements so accepting one keep
	// never silently rewrites a shared gate or setup relied upon by another local statement.
	const untouchedGateUsers = new Map<string, string[]>();
	const untouchedSetupUsers = new Map<string, string[]>();
	for (const locKeep of local.keep ?? []) {
		if (acceptSet.has(locKeep.id) || declineSet.has(locKeep.id)) continue;
		if (!locKeep.gate) continue;
		const gateUsers = untouchedGateUsers.get(locKeep.gate) ?? [];
		gateUsers.push(locKeep.id);
		untouchedGateUsers.set(locKeep.gate, gateUsers);
		const gateDef = local.gates?.[locKeep.gate];
		if (gateDef?.setup) {
			const setupUsers = untouchedSetupUsers.get(gateDef.setup) ?? [];
			setupUsers.push(locKeep.id);
			untouchedSetupUsers.set(gateDef.setup, setupUsers);
		}
	}

	// Construct the staged pattern purely in memory (live file stays undisturbed).
	const staged: PatternFile = structuredClone(local);
	const nextStatements: Record<string, string> = { ...local.derivedFrom.statements };
	const nextDeclined: Record<string, string> = { ...(local.derivedFrom.declined ?? {}) };
	const nextWaivedKeep: WaivedKeepEntry[] = [...(local.waivedKeep ?? [])];
	const nextSetups = { ...(staged.setups ?? {}) };
	const nextGates = { ...(staged.gates ?? {}) };

	const applyGateAndSetup = (stmtId: string, gateKey: string, overrideSetup?: string) => {
		const upGate = upstream.data.gates?.[gateKey];
		const locGate = nextGates[gateKey];
		if (!upGate && !locGate) {
			throw typedError(
				'VALIDATION_ERROR',
				`Gate '${gateKey}' referenced by resolution for '${stmtId}' does not exist in upstream or local pattern.`,
				`Use an existing gate key from upstream or local pattern for '${stmtId}'.`
			);
		}
		const sourceGate = upGate ?? locGate;
		const nextGate = structuredClone(sourceGate as NonNullable<typeof sourceGate>);
		if (overrideSetup !== undefined) {
			const hasSetup =
				Object.hasOwn(upstream.data.setups ?? {}, overrideSetup) ||
				Object.hasOwn(nextSetups, overrideSetup);
			if (!hasSetup) {
				throw typedError(
					'VALIDATION_ERROR',
					`Setup '${overrideSetup}' referenced by resolution for '${stmtId}' does not exist in upstream or local pattern.`,
					`Use an existing setup key from upstream or local pattern for '${stmtId}'.`
				);
			}
			nextGate.setup = overrideSetup;
		}
		const setupKey = nextGate.setup;
		const upSetup = upstream.data.setups?.[setupKey];
		const locSetup = nextSetups[setupKey];
		if (!upSetup && !locSetup) {
			throw typedError(
				'VALIDATION_ERROR',
				`Setup '${setupKey}' required by gate '${gateKey}' does not exist in upstream or local pattern.`,
				`Ensure setup '${setupKey}' exists before accepting '${stmtId}'.`
			);
		}
		// Prevent silently mutating a shared gate or setup used by untouched local keep statements.
		if (locGate && canonicalJson(locGate) !== canonicalJson(nextGate)) {
			const sharedUsers = untouchedGateUsers.get(gateKey);
			if (sharedUsers && sharedUsers.length > 0) {
				throw typedError(
					'STATEMENT_CONFLICT',
					`Accepting '${stmtId}' would overwrite shared gate '${gateKey}' used by untouched local keep statement(s): ${sharedUsers.join(', ')}.`,
					`Include the affected statements in accept with explicit resolutions or resolve gate '${gateKey}' explicitly.`,
					{
						pattern: request.pattern,
						statement: stmtId,
						gate: gateKey,
						sharedStatements: sharedUsers,
					}
				);
			}
		}
		if (upSetup && locSetup && canonicalJson(locSetup) !== canonicalJson(upSetup)) {
			const sharedUsers = untouchedSetupUsers.get(setupKey);
			if (sharedUsers && sharedUsers.length > 0) {
				throw typedError(
					'STATEMENT_CONFLICT',
					`Accepting '${stmtId}' would overwrite shared setup '${setupKey}' used by untouched local keep statement(s): ${sharedUsers.join(', ')}.`,
					`Include the affected statements in accept with explicit resolutions or use a non-conflicting setup.`,
					{
						pattern: request.pattern,
						statement: stmtId,
						setup: setupKey,
						sharedStatements: sharedUsers,
					}
				);
			}
		}
		nextGates[gateKey] = nextGate;
		if (upSetup && (overrideSetup === undefined || !locSetup || upGate !== undefined)) {
			nextSetups[setupKey] = structuredClone(upSetup);
		}
	};

	for (const id of accept) {
		const entry = classifiedById.get(id) as ClassifiedStatement;
		const upStmt = entry.upstreamStatement as PatternStatement | PatternKeepStatement;
		const resolution = resolutionMap.get(id);

		if (entry.section === 'keep') {
			const upKeep = upStmt as PatternKeepStatement;
			const resolvedGate = resolution?.gate ?? upKeep.gate;
			const nextKeep: PatternKeepStatement = {
				id,
				text: resolution?.text ?? upKeep.text,
				...(resolvedGate !== undefined ? { gate: resolvedGate } : {}),
			};
			staged.keep = upsertStatement(staged.keep, nextKeep) as PatternKeepStatement[];
			if (resolvedGate !== undefined) {
				applyGateAndSetup(id, resolvedGate, resolution?.setup);
			} else if (resolution?.setup !== undefined) {
				throw typedError(
					'VALIDATION_ERROR',
					`Resolution for ungated keep statement '${id}' cannot specify setup without a gate.`,
					`Provide a gate alongside setup in resolutions['${id}'], or omit setup.`
				);
			}
		} else {
			const nextStmt: PatternStatement = {
				id,
				text: resolution?.text ?? upStmt.text,
			};
			staged[entry.section] = upsertStatement(staged[entry.section], nextStmt);
		}

		// Record the upstream digest accepted so future compares treat this upstream revision as integrated.
		if (entry.upstreamDigest) {
			nextStatements[id] = entry.upstreamDigest;
		}
		delete nextDeclined[id];
		const waiverIdx = nextWaivedKeep.findIndex((w) => w.id === id);
		if (waiverIdx >= 0) nextWaivedKeep.splice(waiverIdx, 1);
	}

	for (const id of decline) {
		const entry = classifiedById.get(id) as ClassifiedStatement;
		if (entry.section === 'keep') {
			const reason = waiverMap.get(id) as string;
			const existingIdx = nextWaivedKeep.findIndex((w) => w.id === id);
			if (existingIdx >= 0) {
				nextWaivedKeep[existingIdx] = { id, reason };
			} else {
				nextWaivedKeep.push({ id, reason });
			}
			// Remove from local keep if present and record upstream digest in statements so compare classifies dropped-here.
			if (staged.keep) {
				staged.keep = staged.keep.filter((item) => item.id !== id);
			}
			if (entry.upstreamDigest) {
				nextStatements[id] = entry.upstreamDigest;
			}
		} else if (entry.upstreamDigest) {
			nextDeclined[id] = entry.upstreamDigest;
		}
	}

	staged.approvalStatus = 'proposed';
	staged.derivedFrom = {
		library: upstream.library,
		pattern: upstream.pattern,
		version: upstream.version,
		revision: upstream.revision,
		statements: nextStatements,
		...(Object.keys(nextDeclined).length > 0 ? { declined: nextDeclined } : {}),
	};
	if (nextWaivedKeep.length > 0) {
		staged.waivedKeep = nextWaivedKeep;
	} else {
		delete staged.waivedKeep;
	}
	if (Object.keys(nextSetups).length > 0) staged.setups = nextSetups;
	if (Object.keys(nextGates).length > 0) staged.gates = nextGates;

	// Verify all staged gate and setup cross-references before persisting the card.
	for (const k of staged.keep ?? []) {
		if (k.gate !== undefined && !Object.hasOwn(staged.gates ?? {}, k.gate)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Staged keep statement '${k.id}' references unknown gate '${k.gate}'.`,
				'Verify gate keys in resolutions before staging the merge.'
			);
		}
	}
	for (const [gKey, gDef] of Object.entries(staged.gates ?? {})) {
		if (!Object.hasOwn(staged.setups ?? {}, gDef.setup)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Staged gate '${gKey}' references unknown setup '${gDef.setup}'.`,
				'Verify setup keys in resolutions before staging the merge.'
			);
		}
	}

	const validatedStaged = patternFileSchema.safeParse(staged);
	if (!validatedStaged.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Staged merge for '${request.pattern}' failed pattern schema validation: ${validatedStaged.error.message}`,
			'Check resolution text, gate, and setup identifiers before staging the merge.'
		);
	}

	const localLibrary = localLibraryOf(config);
	const upstreamDigests = extractCardUpstreamDigests(upstream.raw);
	const localDigest = packDigest(canonicalJson(local));
	const configRel = relative(config.root, config.file).split(sep).join('/');

	// Supersede any earlier open merge card for this same pattern cleanly.
	const existingCards = await readAllCards(config.root);
	for (const existing of existingCards) {
		if (
			(existing.status === 'open' || existing.status === 'changes-requested') &&
			existing.patternAction?.kind === 'merge' &&
			existing.patternAction.library === localLibrary &&
			existing.patternAction.pattern === request.pattern
		) {
			await writeCardRecord(config.root, { ...existing, status: 'withdrawn' });
		}
	}

	const cardId = generateCardId();
	const hasKeepWaiver = waivers.length > 0;
	const waiverTouches = waivers.flatMap((w) => [
		`${relPath}#${w.id}`,
		`${relPath}#${w.id}@${waiverReasonHash(w.reason)}`,
	]);
	const cardRecord: DesignCardRecord = {
		card: cardId,
		scope: 'guidance',
		what: `Merge upstream updates from ${upstream.library}/${upstream.pattern}@${upstream.version} into ${localLibrary}/${request.pattern}`,
		owner: 'product',
		touches: [relPath, ...waiverTouches],
		severity: 'major',
		visual: {
			kind: 'diff',
			summary: `Staged merge into '${localLibrary}/${request.pattern}': accept ${accept.length}, decline ${decline.length} from ${upstream.library}/${upstream.pattern}@${upstream.version}.`,
		},
		why: {
			findings: [
				{
					summary: `Pinned to ${upstream.library}/${upstream.pattern}@${upstream.version} (${accept.length} accepted, ${decline.length} declined${hasKeepWaiver ? `, ${waivers.length} keep waiver(s)` : ''}).`,
					evidence: 'observed',
				},
			],
			reviewerCount: 1,
			split: '1-0',
			trigger: hasKeepWaiver ? 'keep-waiver' : 'guidance-change',
		},
		effect: {
			gatesBefore: { passed: 0, failed: 0 },
			gatesAfter: { passed: 0, failed: 0 },
			checksSummary: `Live ${relPath} remains unchanged until person approves this card.`,
			regression: false,
		},
		risk: {
			affects: [`${upstream.library}/${upstream.pattern}`, `${localLibrary}/${request.pattern}`],
			undoable: true,
		},
		status: 'open',
		patternAction: {
			kind: 'merge',
			library: localLibrary,
			pattern: request.pattern,
			patternPath: relPath,
			upstreamLibrary: upstream.library,
			upstreamPattern: upstream.pattern,
			upstreamVersion: upstream.version,
			upstreamDigests,
			upstreamPath: upstream.cardUpstreamPath,
			localDigest,
			configPath: configRel,
			stagedPattern: validatedStaged.data as Record<string, unknown>,
		},
		createdAt: new Date().toISOString(),
	};
	await writeCardRecord(config.root, cardRecord);

	return {
		pattern: request.pattern,
		card: cardId,
		upstreamVersion: upstream.version,
		upstreamDigests,
		accepted: [...accept],
		declined: [...decline],
		stagedStatus: 'proposed',
		nextSteps: [
			`Have a person review and approve card '${cardId}' via decision-record to apply the staged merge to ${relPath}.`,
		],
	};
}
