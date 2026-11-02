/**
 * The shared components on Loam's themes (2.4, D50). `violet-elements` may not depend on Violet,
 * so it takes Loam's themes as data: a committed export of the component ids per theme, which its
 * generator reads, and literal `var(--<id>, <literal>)` fallbacks that must equal the light
 * theme, so a component renders the same with no theme installed.
 *
 * - `renderComponentExport` gives `tokens/violet-theme.export.json`, which
 *   `theme:export-components` writes and `theme:check` compares.
 * - `scanFallbacks` finds every fallback of a component id whose literal differs from the light
 *   value after normalization; `fixFallbacks` rewrites them to it.
 */
import type { Contract, ResolvedTree, Token } from './outputs.js';
import { THEMES, type ThemeName, themeNode } from './tree/index.js';

export const COMPONENT_EXPORT_SOURCE = 'loam';

/** `foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json`. */
export interface ComponentExport {
	contractVersion: Contract['contractVersion'];
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
	return { contractVersion: contract.contractVersion, source: COMPONENT_EXPORT_SOURCE, presets };
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
}

/** Every fallback of a component id whose literal differs from its light value. */
export function scanFallbacks(
	files: ReadonlyArray<{ path: string; text: string }>,
	lightValues: ReadonlyMap<string, string>
): FallbackMismatch[] {
	const mismatches: FallbackMismatch[] = [];
	for (const { path, text } of files)
		for (const fallback of findFallbacks(text)) {
			const expected = lightValues.get(fallback.property);
			if (expected === undefined) continue;
			if (normalizeLiteral(fallback.literal) !== normalizeLiteral(expected))
				mismatches.push({ ...fallback, path, expected });
		}
	return mismatches;
}

/** `text` with each mismatching fallback replaced by its normalized light value. */
export function fixFallbacks(text: string, lightValues: ReadonlyMap<string, string>): string {
	let fixed = text;
	const fallbacks = findFallbacks(text).reverse();
	for (const fallback of fallbacks) {
		const expected = lightValues.get(fallback.property);
		if (expected === undefined) continue;
		if (normalizeLiteral(fallback.literal) === normalizeLiteral(expected)) continue;
		fixed = fixed.slice(0, fallback.start) + normalizeLiteral(expected) + fixed.slice(fallback.end);
	}
	return fixed;
}
