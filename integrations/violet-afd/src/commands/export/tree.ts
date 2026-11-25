import { type CssValueMetadata, checkCssTokenValue } from '@lushly-dev/violet-core/css';
import {
	resolveAncestorTokenMap,
	resolveNodeTokenMap,
	validateTokenId,
} from '@lushly-dev/violet-core/engine';
import type {
	Constraint,
	Node,
	OperationRecord,
	TokenMetadata,
} from '@lushly-dev/violet-core/types';
import { ConstraintSchema, TokenMetadataSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { findDuplicateConstraintIds, validateConstraintSemantics } from '../constraints/set.js';
import { dtcgTypeToCategory } from '../import/flatten.js';
import { VIOLET_EXTENSION_KEY, nodeIdFromFileName } from '../import/tree.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for export.tree command
 */
const InputSchema = z.object({
	/** Subtree to write; defaults to every tree */
	rootId: z.string().min(1).optional(),
});

const FileSchema = z.object({
	/** File name, `<node>.tokens.json` */
	name: z.string(),
	/** The node the file holds */
	node: z.string(),
	/** DTCG JSON, two-space indented, ending in a newline */
	content: z.string(),
});

/**
 * Output schema for export.tree command
 */
const OutputSchema = z.object({
	files: z.array(FileSchema),
	/** Settings the files cannot carry, so a round trip through import.tree drops them */
	dropped: z.array(
		z.object({
			node: z.string(),
			token: z.string().optional(),
			fields: z.array(z.string()),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/** A node's own operation that a token file cannot hold */
interface Unwritable {
	node: string;
	token: string;
	why: string;
}

const TIER_GROUPS = new Set(['global', 'component']);
const ALL_TIERS = new Set(['global', 'semantic', 'component']);

/** Token metadata fields a file carries: `$type`, `$description`, and the tier group */
const WRITTEN_FIELDS = new Set(['type', 'description', 'tier', 'category']);

/** Metadata defaults, which a file need not carry since reading it back applies them */
const DEFAULT_METADATA = TokenMetadataSchema.parse({});

function parseJson(text: string | null): unknown {
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Fields of stored metadata a file would drop: set, not a default, and not written */
function droppedMetadataFields(metadata: Partial<TokenMetadata>): string[] {
	return Object.entries(metadata).flatMap(([field, value]) => {
		if (value === undefined) return [];
		if (WRITTEN_FIELDS.has(field)) return [];
		const fallback = (DEFAULT_METADATA as Record<string, unknown>)[field];
		return JSON.stringify(value) === JSON.stringify(fallback) ? [] : [field];
	});
}

/** Node settings a file's extension cannot carry */
function droppedNodeFields(node: Node): string[] {
	const fields: string[] = [];
	if (node.name !== node.id) fields.push('name');
	if (node.owner) fields.push('owner');
	if (node.status !== 'active') fields.push('status');
	if (node.sunsetAt) fields.push('sunsetAt');
	if (node.replacedBy) fields.push('replacedBy');
	if (node.tags.length > 0) fields.push('tags');
	return fields;
}

/** A file name for a node id, unique among `taken` */
function fileNameFor(id: string, taken: Set<string>): string {
	const base = id.replace(/[^A-Za-z0-9._-]/g, '_') || 'node';
	let name = `${base}.tokens.json`;
	for (let n = 2; taken.has(name); n++) name = `${base}-${n}.tokens.json`;
	taken.add(name);
	return name;
}

/** Code-point order, the same on every machine and locale */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** File names for node ids, given in id order so they never depend on display names */
function fileNames(ids: string[]): Map<string, string> {
	const taken = new Set<string>();
	const names = new Map<string, string>();
	for (const id of [...ids].sort(byCodePoint)) names.set(id, fileNameFor(id, taken));
	return names;
}

/** One token as the file holds it */
interface WrittenToken {
	id: string;
	value: unknown;
	type?: string;
	category?: string;
	description?: string;
	tier?: string;
}

/**
 * The tokens a node's own operations set, one per id, each at its last value.
 * An add and the overrides after it on the same node read back as one add.
 */
function ownTokens(
	node: Node,
	ops: OperationRecord[],
	inherited: ReadonlySet<string>,
	unwritable: Unwritable[],
	dropped: Output['dropped'],
): WrittenToken[] {
	const tokens = new Map<string, WrittenToken>();
	for (const op of [...ops].sort((a, b) => a.sequence - b.sequence)) {
		if (op.type !== 'add' && op.type !== 'override') {
			unwritable.push({ node: node.id, token: op.tokenId, why: `a ${op.type}` });
			continue;
		}
		// An add for a token an ancestor now provides does nothing (the ancestor's add
		// wins), and read back it would be an override that does; so it is left out
		if (op.type === 'add' && inherited.has(op.tokenId)) {
			dropped.push({ node: node.id, token: op.tokenId, fields: ['add shadowed by an ancestor'] });
			continue;
		}
		const value = parseJson(op.value);
		const existing = tokens.get(op.tokenId);
		if (op.type === 'override' || existing) {
			tokens.set(op.tokenId, { ...(existing ?? { id: op.tokenId }), value });
			continue;
		}
		const metadata = (parseJson(op.metadata) ?? {}) as Partial<TokenMetadata>;
		const fields = droppedMetadataFields(metadata);
		if (fields.length > 0) dropped.push({ node: node.id, token: op.tokenId, fields });
		const derivedCategory = metadata.type
			? dtcgTypeToCategory(metadata.type)
			: DEFAULT_METADATA.category;
		const explicitCategory =
			metadata.category &&
			metadata.category !== derivedCategory &&
			metadata.category !== DEFAULT_METADATA.category
				? metadata.category
				: undefined;
		tokens.set(op.tokenId, {
			id: op.tokenId,
			value,
			...(metadata.type ? { type: metadata.type } : {}),
			...(explicitCategory ? { category: explicitCategory } : {}),
			...(metadata.description ? { description: metadata.description } : {}),
			...(metadata.tier && TIER_GROUPS.has(metadata.tier) ? { tier: metadata.tier } : {}),
		});
	}
	return [...tokens.values()].sort((a, b) => byCodePoint(a.id, b.id));
}

type Group = Record<string, unknown>;

/** A group with no prototype, so no key can reach Object.prototype */
const newGroup = (): Group => Object.create(null) as Group;

/**
 * Nest tokens as DTCG groups. A token whose id runs on from another token's id
 * (`color.border` and `color.border.focus`) cannot sit inside it, since a DTCG
 * token has no children; the rest of its path is written as one dotted key
 * beside it (`"border.focus"`), which import.tree reads back to the same id.
 * Records a token the format cannot hold: a segment DTCG reads as a keyword.
 */
function nestTokens(
	nodeId: string,
	tokens: WrittenToken[],
	tiers: boolean,
	unwritable: Unwritable[],
): Group {
	const root = newGroup();
	const leaves = new Set<object>();
	for (const token of tokens) {
		const segments = token.id.split('.');
		if (segments.some((segment) => segment === '' || segment.startsWith('$'))) {
			unwritable.push({ node: nodeId, token: token.id, why: 'an id DTCG cannot name' });
			continue;
		}
		if (validateTokenId(token.id) !== null) {
			unwritable.push({ node: nodeId, token: token.id, why: 'an unsafe token id' });
			continue;
		}
		if (tiers && !token.tier && ALL_TIERS.has(segments[0] ?? '')) {
			unwritable.push({ node: nodeId, token: token.id, why: 'an id that reads as a tier group' });
			continue;
		}
		const path = token.tier ? [token.tier, ...segments] : segments;
		let group = root;
		let index = 0;
		// Descend while the next segment is a group (or free); stop at a token
		while (index < path.length - 1) {
			const segment = path[index] as string;
			const next = Object.hasOwn(group, segment) ? group[segment] : undefined;
			if (next !== undefined && leaves.has(next as object)) break;
			if (next === undefined) group[segment] = newGroup();
			group = group[segment] as Group;
			index += 1;
		}
		const key = path.slice(index).join('.');
		if (Object.hasOwn(group, key)) {
			unwritable.push({ node: nodeId, token: token.id, why: 'an id that is also a group' });
			continue;
		}
		const leaf = {
			...(token.type ? { $type: token.type } : {}),
			$value: token.value,
			...(token.description ? { $description: token.description } : {}),
			...(token.category
				? { $extensions: { [VIOLET_EXTENSION_KEY]: { category: token.category } } }
				: {}),
		};
		leaves.add(leaf);
		group[key] = leaf;
	}
	return root;
}

/** The value checks a file's tokens must pass, as import.tree will apply them (#1325) */
function unsafeWrittenValues(
	nodeId: string,
	tokens: WrittenToken[],
	resolved: Map<string, { metadata?: CssValueMetadata }>,
): string[] {
	return tokens.flatMap((token) => {
		const metadata = token.type ? { type: token.type } : resolved.get(token.id)?.metadata;
		const problem = checkCssTokenValue(token.value, metadata);
		return problem ? [`${nodeId}: '${token.id}' ${problem}`] : [];
	});
}

/** Validate and canonically sort a node's constraints so import.tree reads them back identically (#2330) */
function serializeConstraints(
	nodeId: string,
	rawConstraints: Constraint[],
	invalid: string[],
): Constraint[] {
	const parsed: Constraint[] = [];
	for (const constraint of rawConstraints) {
		const check = ConstraintSchema.safeParse(constraint);
		if (!check.success) {
			const issues = check.error.issues
				.map((issue) => `${issue.path.join('.')} ${issue.message}`.trim())
				.join('; ');
			invalid.push(`${nodeId}: invalid constraint (${issues})`);
			continue;
		}
		parsed.push(check.data);
	}
	const duplicateIds = findDuplicateConstraintIds(parsed);
	if (duplicateIds.length > 0) {
		invalid.push(`${nodeId}: duplicate constraint IDs: ${duplicateIds.join(', ')}`);
	}
	const semanticError = validateConstraintSemantics(parsed);
	if (semanticError) {
		invalid.push(`${nodeId}: ${semanticError.message}`);
	}
	return parsed.sort((a, b) => byCodePoint(a.id, b.id));
}

/**
 * export.tree command
 *
 * Write a tree as files, one per node, each holding only that node's own
 * operations and constraints: the inverse of import.tree (#1322, #2330).
 * Reading the files back with import.tree builds a tree that resolves and
 * validates the same, and exporting that tree again gives the same files.
 */
export const exportTreeCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'export.tree',
	description:
		"Write a node tree as DTCG token files, one per node with only that node's own tokens and constraints (the inverse of import.tree)",
	category: 'export',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const { db } = context;

		const nodes = await selectSubtree(db, input.rootId);
		if (!nodes) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.rootId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		const files: Output['files'] = [];
		const dropped: Output['dropped'] = [];
		const unwritable: Unwritable[] = [];
		const unsafe: string[] = [];
		const invalidConstraints: string[] = [];
		const names = fileNames(nodes.map((node) => node.id));

		for (const node of nodes) {
			const nodeFields = droppedNodeFields(node);
			if (nodeFields.length > 0) dropped.push({ node: node.id, fields: nodeFields });

			const inherited = new Set((await resolveAncestorTokenMap(db, node.parentId)).keys());
			const ops = await db.getOperations(node.id);
			const tokens = ownTokens(node, ops, inherited, unwritable, dropped);
			unsafe.push(...unsafeWrittenValues(node.id, tokens, await resolveNodeTokenMap(db, node.id)));
			const tiers = tokens.some((token) => token.tier);
			const groups = nestTokens(node.id, tokens, tiers, unwritable);
			const constraints = serializeConstraints(
				node.id,
				await db.getConstraints(node.id),
				invalidConstraints,
			);
			const name = names.get(node.id) as string;
			const extension = {
				...(nodeIdFromFileName(name) === node.id ? {} : { node: node.id }),
				...(node.parentId ? { parent: node.parentId } : {}),
				type: node.type,
				...(node.includes.length > 0 ? { includes: node.includes } : {}),
				...(node.includePolicy !== 'merge' ? { includePolicy: node.includePolicy } : {}),
				...(tiers ? { tiers: true } : {}),
				...(constraints.length > 0 ? { constraints } : {}),
			};
			const content = { $extensions: { [VIOLET_EXTENSION_KEY]: extension }, ...groups };
			files.push({ name, node: node.id, content: `${JSON.stringify(content, null, 2)}\n` });
		}
		files.sort((a, b) => byCodePoint(a.name, b.name));

		if (invalidConstraints.length > 0) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `${invalidConstraints.length} stored constraint(s) cannot be written as files import.tree would read: ${invalidConstraints.slice(0, 10).join('; ')}${invalidConstraints.length > 10 ? '; …' : ''}`,
				suggestion: "Fix each invalid constraint with 'constraints.set', then export again",
			});
		}

		if (unsafe.length > 0) {
			return failure({
				code: ErrorCodes.INVALID_TOKEN_VALUE,
				message: `${unsafe.length} value(s) stored before values were checked cannot be written as files import.tree would read: ${unsafe.slice(0, 10).join('; ')}${unsafe.length > 10 ? '; …' : ''}`,
				suggestion:
					"Fix each value with 'token.override' at the node that sets it, then export again",
			});
		}

		if (unwritable.length > 0) {
			const listed = unwritable
				.slice(0, 10)
				.map((entry) => `${entry.node}: ${entry.why} of '${entry.token}'`)
				.join('; ');
			const hasUnsafeId = unwritable.some(
				(entry) => entry.why === 'an unsafe token id' || entry.why === 'an id DTCG cannot name',
			);
			return failure({
				code: ErrorCodes.OPERATION_NOT_ALLOWED,
				message: `${unwritable.length} operation(s) cannot be written as token files: ${listed}${unwritable.length > 10 ? '; …' : ''}`,
				suggestion: hasUnsafeId
					? "Copy any token with an unsafe id to a safe name with 'token.copy' (using asTokenId) or add its replacement, then remove the legacy operation with 'token.remove' and export again"
					: "A file holds adds and overrides only: replace a subtract, reset or copy with 'token.override' or 'token.remove' (see node.get with includeOperations), then export again",
			});
		}

		return success(
			{ files, dropped },
			{
				reasoning: `Wrote ${files.length} file(s), one per node${dropped.length > 0 ? `; ${dropped.length} setting(s) the files cannot carry are listed in dropped` : ''}`,
			},
		);
	},

	examples: [
		{
			description: 'Write every tree as files',
			input: {},
		},
		{
			description: 'Write one subtree as files',
			input: { rootId: 'afd-site' },
		},
	],
};
