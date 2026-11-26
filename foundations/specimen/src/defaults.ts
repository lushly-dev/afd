import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_DEFAULT_PATTERNS,
	type CanonicalDefaultPatternId,
	DEFAULT_PATTERNS_LIBRARY,
	DEFAULT_PATTERNS_SEMVER,
	DEFAULT_PATTERNS_VERSION,
} from './design-types.js';
import { canonicalJson, packCatalog, packDigest } from './pack.js';
import { PACK_FORMAT_VERSION, type PackPattern, type PackRules } from './pack-schema.js';
import type { PatternFile } from './pattern-types.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directory containing the 10 canonical `afd-defaults@1.0.0` source `pattern.json` files. */
export function getDefaultPatternsDir(): string {
	return join(PACKAGE_ROOT, 'defaults', 'patterns');
}

/** Directory containing the bundled `afd-defaults@1.0.0` Pack Format 2 library. */
export function getDefaultPatternsPackDir(): string {
	return join(PACKAGE_ROOT, 'defaults', 'pack');
}

/** Whether a `patternSources` or `defaults` entry names the bundled `afd-defaults` library. */
export function isBuiltinDefaultPatternSource(specifier: string): boolean {
	return specifier === DEFAULT_PATTERNS_LIBRARY || specifier === DEFAULT_PATTERNS_VERSION;
}

/** Parse and validate a `defaults` version string (e.g. `afd-defaults@1.0.0`). */
export function resolveDefaultsVersion(configured?: string): string {
	if (configured === undefined) return DEFAULT_PATTERNS_VERSION;
	if (configured === DEFAULT_PATTERNS_LIBRARY) return DEFAULT_PATTERNS_VERSION;
	if (configured === DEFAULT_PATTERNS_VERSION) return DEFAULT_PATTERNS_VERSION;
	throw Object.assign(
		new Error(
			`Unsupported defaults library version '${configured}'; bundled version is '${DEFAULT_PATTERNS_VERSION}'.`
		),
		{
			code: 'VALIDATION_ERROR',
			suggestion: `Set defaults to '${DEFAULT_PATTERNS_VERSION}' or omit defaults in specimen.config.json.`,
		}
	);
}

/** Load all 10 canonical `afd-defaults@1.0.0` pattern files from the bundled package assets. */
export async function loadDefaultPatterns(): Promise<
	Record<CanonicalDefaultPatternId, PatternFile>
> {
	const dir = getDefaultPatternsDir();
	const entries = await Promise.all(
		CANONICAL_DEFAULT_PATTERNS.map(async (id) => {
			const file = join(dir, id, 'pattern.json');
			const parsed = JSON.parse(await readFile(file, 'utf8')) as PatternFile;
			return [id, parsed] as const;
		})
	);
	return Object.fromEntries(entries) as Record<CanonicalDefaultPatternId, PatternFile>;
}

/**
 * Build the deterministic Pack Format 2 files for `afd-defaults@1.0.0` from the 10 source
 * `pattern.json` files. Used both to materialize `defaults/pack/` and to verify zero drift.
 */
export async function buildDefaultPatternsPackFiles(): Promise<Map<string, string>> {
	const loaded = await loadDefaultPatterns();
	const committed = new Map<string, Uint8Array>();
	const textFiles = new Map<string, string>();
	const encoder = new TextEncoder();

	const rules: PackRules = {
		format: PACK_FORMAT_VERSION,
		library: DEFAULT_PATTERNS_LIBRARY,
		rules: [],
	};
	const rulesPath = `rules/${DEFAULT_PATTERNS_LIBRARY}.json`;
	const rulesJson = canonicalJson(rules);
	textFiles.set(rulesPath, rulesJson);
	committed.set(rulesPath, encoder.encode(rulesJson));

	for (const id of CANONICAL_DEFAULT_PATTERNS) {
		const source = loaded[id];
		const record: PackPattern = {
			format: PACK_FORMAT_VERSION,
			pattern: source.pattern,
			...(source.summary === undefined ? {} : { summary: source.summary }),
			status: source.status ?? 'stable',
			...(source.replacedBy === undefined ? {} : { replacedBy: source.replacedBy }),
			scope: source.scope,
			facets: source.facets ?? {},
			useWhen: source.useWhen ?? [],
			avoidWhen: source.avoidWhen ?? [],
			keep: source.keep ?? [],
			customize: source.customize ?? [],
			setups: source.setups ?? {},
			gates: source.gates ?? {},
			implementations: [],
		};
		const path = `data/${DEFAULT_PATTERNS_LIBRARY}/patterns/${id}.json`;
		const json = canonicalJson(record);
		textFiles.set(path, json);
		committed.set(path, encoder.encode(json));
	}

	const catalogJson = packCatalog(committed, DEFAULT_PATTERNS_LIBRARY, {
		title: 'AFD default result-state patterns',
		package: {
			name: '@lushly-dev/specimen',
			version: DEFAULT_PATTERNS_SEMVER,
		},
		prefix: 'afd-',
	});
	textFiles.set(`data/${DEFAULT_PATTERNS_LIBRARY}/library.json`, catalogJson);
	return textFiles;
}

/** Check whether the bundled `defaults/pack` directory exists on disk. */
export function hasBundledDefaultsPack(): boolean {
	return existsSync(join(getDefaultPatternsPackDir(), 'data', DEFAULT_PATTERNS_LIBRARY));
}

/** Compute the sha256 digest of a canonical JSON pattern object. */
export function patternContentDigest(pattern: PatternFile): string {
	return packDigest(canonicalJson(pattern));
}
