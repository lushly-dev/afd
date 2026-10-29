import type { TokenCategory, TokenMetadata, TokenTier } from '@lushly-dev/violet-core/types';
import { TokenTierSchema } from '@lushly-dev/violet-core/types';

/**
 * A token read from an import file
 */
export interface FlatToken {
	id: string;
	value: unknown;
	/** Metadata read from `$type` / `$description` (DTCG only) and the tier group */
	metadata?: Partial<TokenMetadata>;
}

interface FlattenOptions {
	/**
	 * Treat top-level `global` / `semantic` / `component` groups as tiers: the
	 * group is left out of the token ID and stored as `metadata.tier`.
	 */
	tiers?: boolean;
}

const TIERS = new Set<string>(TokenTierSchema.options);

/**
 * Flatten a token file, optionally reading top-level tier groups (see FlattenOptions)
 *
 * With `tiers`: `{ semantic: { color: { accent: { $value: "{color.gold}" } } } }`
 * -> [{ id: "color.accent", value: "{color.gold}", metadata: { tier: "semantic" } }]
 */
export function flattenTokenFile(
	obj: Record<string, unknown>,
	prefix?: string,
	options: FlattenOptions = {},
): FlatToken[] {
	if (!options.tiers) {
		return flattenTokenTree(obj, prefix);
	}

	const rootType = typeof obj.$type === 'string' ? obj.$type : undefined;
	const untiered: Record<string, unknown> = { $type: rootType };
	const result: FlatToken[] = [];

	for (const [key, val] of Object.entries(obj)) {
		if (TIERS.has(key) && typeof val === 'object' && val !== null) {
			const group = val as Record<string, unknown>;
			const groupType = typeof group.$type === 'string' ? group.$type : rootType;
			for (const token of flattenTokenTree(group, prefix, [], groupType)) {
				result.push({ ...token, metadata: { ...token.metadata, tier: key as TokenTier } });
			}
		} else {
			untiered[key] = val;
		}
	}

	return [...result, ...flattenTokenTree(untiered, prefix)];
}

/**
 * Token IDs that appear more than once (e.g. the same path in two tier groups)
 */
export function findDuplicateTokenIds(tokens: FlatToken[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const token of tokens) {
		if (seen.has(token.id)) duplicates.add(token.id);
		seen.add(token.id);
	}
	return [...duplicates];
}

/**
 * Flatten a token file to a token array.
 *
 * Accepts both formats:
 * - Style Dictionary: `{ color: { primary: { value: "#0078D4" } } }`
 * - DTCG: `{ color: { $type: "color", primary: { $value: "#0078D4", $description: "..." } } }`
 *
 * DTCG `$type` is inherited from the nearest group that sets it. Other `$`-prefixed
 * keys (`$schema`, `$extensions`, group `$description`) are not tokens and are skipped.
 *
 * Output: [{ id: "color.primary", value: "#0078D4", metadata: { type: "color", category: "color" } }]
 */
function flattenTokenTree(
	obj: Record<string, unknown>,
	prefix?: string,
	currentPath: string[] = [],
	inheritedType?: string,
): FlatToken[] {
	const result: FlatToken[] = [];
	const groupType = typeof obj.$type === 'string' ? obj.$type : inheritedType;

	for (const [key, val] of Object.entries(obj)) {
		if (key.startsWith('$') || typeof val !== 'object' || val === null) {
			continue;
		}

		const path = [...currentPath, key];
		const id = prefix ? `${prefix}.${path.join('.')}` : path.join('.');
		const node = val as Record<string, unknown>;

		if ('$value' in node) {
			result.push({ id, value: node.$value, metadata: readDtcgMetadata(node, groupType) });
		} else if (isStyleDictionaryLeaf(node)) {
			result.push({ id, value: node.value });
		} else {
			result.push(...flattenTokenTree(node, prefix, path, groupType));
		}
	}

	return result;
}

/**
 * A Style Dictionary leaf has a non-object `value` property. Objects under
 * `value` are treated as groups, since `value` is also a legal group name.
 */
function isStyleDictionaryLeaf(node: Record<string, unknown>): boolean {
	return 'value' in node && (typeof node.value !== 'object' || node.value === null);
}

function readDtcgMetadata(
	node: Record<string, unknown>,
	groupType: string | undefined,
): Partial<TokenMetadata> | undefined {
	const type = typeof node.$type === 'string' ? node.$type : groupType;
	const description = typeof node.$description === 'string' ? node.$description : undefined;

	if (!type && !description) {
		return undefined;
	}

	const metadata: Partial<TokenMetadata> = {};
	if (type) {
		metadata.type = type;
		metadata.category = dtcgTypeToCategory(type);
	}
	if (description) {
		metadata.description = description;
	}
	return metadata;
}

/**
 * Map a DTCG `$type` to the closest Violet token category
 */
function dtcgTypeToCategory(type: string): TokenCategory {
	switch (type) {
		case 'color':
			return 'color';
		case 'shadow':
			return 'shadow';
		case 'typography':
		case 'fontFamily':
		case 'fontWeight':
			return 'typography';
		case 'duration':
		case 'cubicBezier':
		case 'transition':
			return 'motion';
		default:
			return 'custom';
	}
}
