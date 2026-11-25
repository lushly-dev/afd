/**
 * The shared components on Loam's themes (2.4, D50). `violet-elements` may not depend on Violet,
 * so it takes Loam's themes as data: a committed export of the component ids per theme, which its
 * generator reads, and literal `var(--<id>, <literal>)` fallbacks that must equal the light
 * theme, so a component renders the same with no theme installed.
 *
 * - `compareInterface` checks the tree against `tokens/interface.json`, every custom property the
 *   components read, which `violet-elements` owns: Loam supplies each as a component id with the
 *   same property and type, and may export ids the interface does not list.
 * - `renderComponentExport` gives `tokens/violet-theme.export.json`, which
 *   `theme:export-components` writes and `theme:check` compares.
 * - `scanFallbacks` finds every fallback of a component id whose literal differs from the light
 *   value after normalization; `fixFallbacks` rewrites them to it.
 */
import type { Contract, ResolvedTree, Token } from './outputs.js';
import { THEMES, type ThemeName, themeNode } from './tree/index.js';

export const COMPONENT_EXPORT_SOURCE = 'loam';
/**
 * The export's own format version, which `violet-elements`' `theme:build` checks. Version 2
 * retired the 16 makeshift ladder tokens, added `space.inline.hairline` and renamed the 25
 * positional semantic tokens to purpose-named ids (#2197).
 */
export const COMPONENT_EXPORT_VERSION = 2;

/** `foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json`. */
export interface ComponentExport {
	contractVersion: typeof COMPONENT_EXPORT_VERSION;
	source: typeof COMPONENT_EXPORT_SOURCE;
	/** Per theme, at comfortable density, every component id (no `shell.*`) in id order. */
	presets: Record<ThemeName, Token[]>;
}

export function renderComponentExport(resolved: ResolvedTree, contract: Contract): ComponentExport {
	const presets = {} as Record<ThemeName, Token[]>;
	for (const theme of THEMES) {
		const tokens = resolved.nodes.get(themeNode(theme));
		if (!tokens) throw new Error(`Node '${themeNode(theme)}' is not in the tree`);
		presets[theme] = [...tokens]
			.filter(([id]) => contract.tokens[id]?.kind === 'component')
			.map(([id, value]) => ({ id, value }));
	}
	return { contractVersion: COMPONENT_EXPORT_VERSION, source: COMPONENT_EXPORT_SOURCE, presets };
}

/** `violet-elements`' `tokens/interface.json`. */
export interface TokenInterface {
	contractVersion: number;
	tokens: Record<string, { property: string; type: string; reserved?: boolean }>;
}

const INTERFACE_FIX =
	'add the id to tree/loam.tokens.json, run `pnpm -F @lushly-dev/loam-theme theme:check --write` and `theme:export-components`, then `pnpm -F @lushly-dev/violet-elements theme:build`';

/**
 * Every id of the components' token interface that Loam's contract does not hold as a component
 * id with the same custom property and type. Ids Loam has and the interface lacks are Loam's own.
 */
export function compareInterface(tokenInterface: unknown, contract: Contract): string[] {
	const file = tokenInterface as Partial<TokenInterface> | null;
	if (
		typeof file !== 'object' ||
		file === null ||
		typeof file.contractVersion !== 'number' ||
		typeof file.tokens !== 'object' ||
		file.tokens === null
	)
		return ['interface.json has no numeric contractVersion or no tokens object'];
	const errors: string[] = [];
	for (const [id, wanted] of Object.entries(file.tokens)) {
		const entry = contract.tokens[id];
		if (entry?.kind !== 'component')
			errors.push(
				`interface.json (contractVersion ${file.contractVersion}) lists '${id}', which Loam's tree does not supply as a component id; ${INTERFACE_FIX}`
			);
		else if (entry.property !== wanted.property || entry.type !== wanted.type)
			errors.push(
				`interface.json lists '${id}' as ${wanted.property} (${wanted.type}), Loam's contract as ${entry.property} (${entry.type})`
			);
	}
	return errors;
}

/** The light value of each component id, by custom property. */
export function lightValuesByProperty(
	exported: ComponentExport,
	contract: Contract
): Map<string, string> {
	const values = new Map<string, string>();
	for (const { id, value } of exported.presets.light) {
		const entry = contract.tokens[id];
		if (entry) values.set(entry.property, value);
	}
	return values;
}

/** Lowercase hex colors and trimmed, collapsed whitespace: the form literals are compared in. */
export const normalizeLiteral = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => hex.toLowerCase());

/** One `var(--<property>, <literal>)`, with the literal's offsets in the text. */
export interface Fallback {
	property: string;
	literal: string;
	start: number;
	end: number;
	line: number;
}

const VAR_START = /var\(\s*(--[A-Za-z0-9_-]+)\s*,/g;
const PRIVATE_ALIAS_DECL = /(--_[A-Za-z0-9_-]+)\s*:\s*var\(\s*(--[A-Za-z0-9_-]+)/g;
const TOKEN_DEFAULTS_BLOCK = /export const (\w+): ElementStyles = css`([\s\S]*?)`;/g;
const VALUE_IMPORT = /import\s+(?!type\b)[^"';]+?\s+from\s+"\.\/([\w.-]+)"/g;

/**
 * Intentionally unbound hooks in `violet-elements` whose fallback is tied to a specific light
 * token (mirrors `HOOKS` in `violet-private-properties.spec.ts`, tracked in #1436).
 */
const HOOK_TOKEN_TARGETS: Readonly<Record<string, string>> = {
	'--_radius-round': '--violet-radius-round',
	'--_space-xs': '--violet-space-stack-tight',
	'--_text-link': '--violet-color-accent-text',
};

/**
 * Every `var(--x, <literal>)` in `text`. A fallback that is not a literal, because it holds
 * another `var()` or a template interpolation, is skipped, as is an unbalanced one.
 */
export function findFallbacks(text: string): Fallback[] {
	const found: Fallback[] = [];
	for (const match of text.matchAll(VAR_START)) {
		const property = match[1] as string;
		const start = match.index + match[0].length;
		let depth = 0;
		let end = -1;
		for (let index = start; index < text.length; index++) {
			const char = text[index];
			if (char === '(') depth++;
			else if (char === ')') {
				if (depth === 0) {
					end = index;
					break;
				}
				depth--;
			}
		}
		if (end < 0) continue;
		const raw = text.slice(start, end);
		if (raw.includes('var(') || raw.includes('${')) continue;
		const leading = raw.length - raw.trimStart().length;
		const literal = raw.trim();
		const literalStart = start + leading;
		found.push({
			property,
			literal,
			start: literalStart,
			end: literalStart + literal.length,
			line: text.slice(0, literalStart).split('\n').length,
		});
	}
	return found;
}

export interface FallbackMismatch extends Fallback {
	path: string;
	expected: string;
	/** True when an alias binds to multiple distinct light values and needs manual review. */
	ambiguous?: boolean;
}

const stripComments = (text: string): string =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
		.replace(/^[ \t]*\/\/.*$/gm, (match) => ' '.repeat(match.length));

const fileDirectory = (path: string): string => {
	const index = path.lastIndexOf('/');
	return index < 0 ? '' : path.slice(0, index);
};

function addAliasTarget(map: Map<string, Set<string>>, alias: string, target: string): void {
	let targets = map.get(alias);
	if (!targets) {
		targets = new Set<string>();
		map.set(alias, targets);
	}
	targets.add(target);
}

/** Extracts `--_alias -> --target` definitions from a CSS-carrying TypeScript chunk. */
function privateAliasTargets(text: string): Map<string, Set<string>> {
	const targets = new Map<string, Set<string>>();
	for (const match of stripComments(text).matchAll(PRIVATE_ALIAS_DECL)) {
		addAliasTarget(targets, match[1] as string, match[2] as string);
	}
	return targets;
}

/** Resolves a private `--_*` alias to all underlying theme tokens' light values, if any. */
function resolveAliasLightValues(
	property: string,
	aliases: ReadonlyMap<string, ReadonlySet<string>>,
	lightValues: ReadonlyMap<string, string>
): Set<string> {
	const resolved = new Set<string>();
	const seen = new Set<string>();
	const queue = [property];
	while (queue.length > 0) {
		const current = queue.shift() as string;
		if (seen.has(current)) continue;
		seen.add(current);
		const direct = lightValues.get(current);
		if (direct !== undefined) {
			resolved.add(direct);
			continue;
		}
		for (const next of aliases.get(current) ?? []) {
			if (!seen.has(next)) queue.push(next);
		}
	}
	return resolved;
}

/**
 * Every fallback of a component id — or of a private `--_*` alias bound to a component id
 * (directly, through an included token-default block, through a sibling `.styles.ts` import, or
 * via `HOOK_TOKEN_TARGETS`) — whose literal differs from its light value.
 */
export function scanFallbacks(
	files: ReadonlyArray<{ path: string; text: string }>,
	lightValues: ReadonlyMap<string, string>
): FallbackMismatch[] {
	const byPath = new Map(files.map((file) => [file.path, file.text]));
	const defaultBlocks = new Map<string, Map<string, Set<string>>>();
	const defaultsFile = files.find((file) => file.path.endsWith('violet-token-defaults.ts'));
	if (defaultsFile) {
		for (const match of stripComments(defaultsFile.text).matchAll(TOKEN_DEFAULTS_BLOCK)) {
			defaultBlocks.set(match[1] as string, privateAliasTargets(match[2] as string));
		}
	}

	const ownAliases = new Map<string, Map<string, Set<string>>>();
	const styleImports = new Map<string, string[]>();
	for (const { path, text } of files) {
		const aliases = new Map<string, Set<string>>();
		for (const [blockName, blockAliases] of defaultBlocks) {
			if (text.includes(`\${${blockName}}`)) {
				for (const [alias, targets] of blockAliases) {
					for (const target of targets) addAliasTarget(aliases, alias, target);
				}
			}
		}
		for (const [alias, targets] of privateAliasTargets(text)) {
			for (const target of targets) addAliasTarget(aliases, alias, target);
		}
		ownAliases.set(path, aliases);
		const dir = fileDirectory(path);
		styleImports.set(
			path,
			[...stripComments(text).matchAll(VALUE_IMPORT)]
				.map((match) => (dir ? `${dir}/${match[1]}.ts` : `${match[1]}.ts`))
				.filter((target) => target.endsWith('.styles.ts') && byPath.has(target))
		);
	}

	const mismatches: FallbackMismatch[] = [];
	for (const { path, text } of files) {
		const aliases = new Map<string, Set<string>>();
		for (const [alias, targets] of ownAliases.get(path) ?? []) {
			aliases.set(alias, new Set(targets));
		}
		for (const target of styleImports.get(path) ?? []) {
			for (const [alias, refs] of ownAliases.get(target) ?? []) {
				for (const ref of refs) addAliasTarget(aliases, alias, ref);
			}
		}

		for (const fallback of findFallbacks(stripComments(text))) {
			const direct = lightValues.get(fallback.property);
			if (direct !== undefined) {
				if (normalizeLiteral(fallback.literal) !== normalizeLiteral(direct))
					mismatches.push({ ...fallback, path, expected: direct });
				continue;
			}
			if (!fallback.property.startsWith('--_')) continue;
			const expectedSet = resolveAliasLightValues(fallback.property, aliases, lightValues);
			if (expectedSet.size === 0) {
				const hookToken = HOOK_TOKEN_TARGETS[fallback.property];
				const hookValue = hookToken ? lightValues.get(hookToken) : undefined;
				if (hookValue !== undefined) expectedSet.add(hookValue);
			}
			if (expectedSet.size === 0) continue;
			const normalized = normalizeLiteral(fallback.literal);
			const matchesAny = [...expectedSet].some((value) => normalizeLiteral(value) === normalized);
			if (!matchesAny) {
				mismatches.push({
					...fallback,
					path,
					expected: [...expectedSet].join(' | '),
					...(expectedSet.size > 1 ? { ambiguous: true } : {}),
				});
			}
		}
	}
	return mismatches;
}

/**
 * `text` with each unambiguous mismatching fallback replaced by its normalized light value.
 * Pass `mismatches` from `scanFallbacks` to also rewrite cross-file private-alias fallbacks.
 */
export function fixFallbacks(
	text: string,
	lightValues: ReadonlyMap<string, string>,
	mismatches?: ReadonlyArray<FallbackMismatch>
): string {
	const edits =
		mismatches !== undefined
			? [...mismatches]
					.filter((mismatch) => !mismatch.ambiguous)
					.sort((left, right) => right.start - left.start)
			: scanFallbacks([{ path: '', text }], lightValues)
					.filter((mismatch) => !mismatch.ambiguous)
					.sort((left, right) => right.start - left.start);
	let fixed = text;
	for (const mismatch of edits) {
		fixed =
			fixed.slice(0, mismatch.start) +
			normalizeLiteral(mismatch.expected) +
			fixed.slice(mismatch.end);
	}
	return fixed;
}
