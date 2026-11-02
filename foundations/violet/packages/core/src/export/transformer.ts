import { isUnsafePathSegment } from '../types/token-id.js';
import type { ResolvedToken } from '../types/token.js';

/**
 * Transform options for export
 */
export interface TransformOptions {
	/** Prefix for variable names (e.g., 'vlt-' → --vlt-color-primary) */
	prefix?: string;

	/** Filter tokens by glob pattern */
	filter?: string;

	/** Group tokens by category in output */
	groupByCategory?: boolean;

	/** Include comments/metadata in output */
	includeComments?: boolean;

	/** CSS selector for variables (CSS only, default: ':root') */
	selector?: string;

	/**
	 * TypeScript export style: 'flat' emits one named constant per token;
	 * 'nested' (default) emits those plus a nested `tokens` object
	 */
	exportStyle?: 'flat' | 'nested';

	/**
	 * TypeScript export type: 'named' and 'both' (default) behave the same and
	 * use named exports only. 'default' makes the nested object the default
	 * export and, for the nested style, drops the named constants.
	 * transformMulti always uses named exports.
	 */
	exportType?: 'named' | 'default' | 'both';

	/** Pretty print output (JSON) */
	pretty?: boolean;

	// Mobile SDK options (Swift, Kotlin, Dart)

	/** Class name for generated code (default: 'DesignTokens') */
	className?: string;

	/** Access level for Swift/Kotlin (default: 'public') */
	accessLevel?: 'public' | 'internal' | 'private';

	/** Package name for Kotlin (e.g., 'com.example.tokens') */
	packageName?: string;

	// Tailwind options

	/** Use ESM export syntax in Tailwind config */
	esm?: boolean;

	// Lua options

	/** FenUI semantic name -> color token ID; emits a `RegisterTheme` config (Lua only) */
	themeMap?: Record<string, string>;

	// CSS options

	/** Emit alias tokens as `var(--target)` instead of their resolved value (CSS only) */
	outputReferences?: boolean;
}

/**
 * Transformer interface for export plugins
 *
 * Each transformer converts resolved tokens to a specific format.
 */
export interface Transformer {
	/** Format identifier (e.g., 'json', 'css', 'scss', 'typescript') */
	format: string;

	/** File extension without dot (e.g., 'css', 'json') */
	fileExtension: string;

	/** Human-readable name */
	name: string;

	/** Transform resolved tokens to output string */
	transform(tokens: ResolvedToken[], options?: TransformOptions): string;

	/** Optional: Generate multiple files (e.g., per category) */
	transformMulti?(tokens: ResolvedToken[], options?: TransformOptions): Map<string, string>;
}

/**
 * Convert token ID to variable name
 *
 * Examples:
 * - 'color.brand.primary' → 'color-brand-primary' (CSS)
 * - 'color.brand.primary' → 'colorBrandPrimary' (JS)
 */
export function tokenIdToKebab(tokenId: string): string {
	return tokenId.replace(/\./g, '-');
}

export function tokenIdToCamel(tokenId: string): string {
	const parts = tokenId.split('.');
	return parts
		.map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
		.join('');
}

/**
 * Group tokens by first segment of ID (category)
 */
export function groupByCategory(tokens: ResolvedToken[]): Map<string, ResolvedToken[]> {
	const groups = new Map<string, ResolvedToken[]>();

	for (const token of tokens) {
		const category = token.id.split('.')[0];
		if (!groups.has(category)) {
			groups.set(category, []);
		}
		groups.get(category)?.push(token);
	}

	return groups;
}

interface TokenTreeNode {
	value?: unknown;
	children: Map<string, TokenTreeNode>;
}

/**
 * Build a nested, prototype-free object from tokens.
 *
 * - Intermediate containers are built with a Map and materialised into
 *   `Object.create(null)` objects, so token path segments are never looked up
 *   on (or assigned through) Object.prototype.
 * - Tokens with an unsafe path segment (`__proto__`, `constructor`, `prototype`)
 *   are skipped, as are tokens with an empty path.
 * - Leaf/group collisions (e.g. `color.brand` and `color.brand.primary`) are
 *   resolved deterministically, independent of token order: the group wins and
 *   the colliding leaf value is dropped. Nothing throws.
 * - If the same path appears twice as a leaf, the last token wins.
 *
 * @param pathOf - Path segments for a token (default: its id split on '.')
 */
export function buildNestedTokenObject(
	tokens: ResolvedToken[],
	toLeaf: (token: ResolvedToken) => unknown,
	pathOf: (token: ResolvedToken) => string[] = (token) => token.id.split('.'),
): Record<string, unknown> {
	const root: TokenTreeNode = { children: new Map() };

	for (const token of tokens) {
		const parts = pathOf(token);
		if (parts.length === 0 || parts.some(isUnsafePathSegment)) {
			continue;
		}

		let node = root;
		for (const part of parts) {
			let child = node.children.get(part);
			if (!child) {
				child = { children: new Map() };
				node.children.set(part, child);
			}
			node = child;
		}
		node.value = toLeaf(token);
	}

	return materializeTokenTree(root);
}

function materializeTokenTree(node: TokenTreeNode): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null);
	for (const [key, child] of node.children) {
		result[key] = child.children.size > 0 ? materializeTokenTree(child) : child.value;
	}
	return result;
}

/**
 * Convert flat tokens to nested object structure
 *
 * Input: [{ id: 'color.brand.primary', value: '#0078D4' }]
 * Output: { color: { brand: { primary: '#0078D4' } } }
 */
export function tokensToNestedObject(tokens: ResolvedToken[]): Record<string, unknown> {
	return buildNestedTokenObject(tokens, (token) => token.resolvedValue);
}

/**
 * Convert flat tokens to Style Dictionary format
 *
 * Input: [{ id: 'color.brand.primary', value: '#0078D4' }]
 * Output: { color: { brand: { primary: { value: '#0078D4' } } } }
 */
export function tokensToStyleDictionary(
	tokens: ResolvedToken[],
	includeMetadata = false,
): Record<string, unknown> {
	return buildNestedTokenObject(tokens, (token) => {
		const leafValue: Record<string, unknown> = {
			value: token.resolvedValue,
		};

		if (includeMetadata && token.metadata) {
			if (token.metadata.description) {
				leafValue.comment = token.metadata.description;
			}
			if (token.metadata.category) {
				leafValue.category = token.metadata.category;
			}
		}

		return leafValue;
	});
}
