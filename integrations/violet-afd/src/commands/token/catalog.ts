import type { OperationRecord } from '@lushly-dev/violet-core/types';
import {
	TokenCategorySchema,
	TokenStatusSchema,
	TokenTierSchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { collectDefinitions, definitionOrder, operationTarget } from './definitions.js';

/**
 * Input schema for tokens.catalog command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree to count customizations in; defaults to every tree
	query: z.string().optional(), // Words that must all appear in the id, description or category
	category: TokenCategorySchema.optional(),
	tier: TokenTierSchema.optional(),
	status: TokenStatusSchema.optional(),
	sort: z.enum(['id', 'customized']).optional().default('id'),
	limit: z.number().int().min(1).max(5000).optional(),
});

const CatalogTokenSchema = z.object({
	id: z.string(),
	category: z.string(),
	tier: z.string(),
	status: z.string(),
	description: z.string().optional(),
	owner: z.string().optional(),
	deprecatedBy: z.string().optional(),
	/** Node whose `add` defines the token */
	definedAt: z.string(),
	/** Nodes in scope that set their own value: override, copy, reset, or a mixin */
	customizedOn: z.array(z.string()),
	/** Nodes in scope that subtract the token */
	removedOn: z.array(z.string()),
});

/**
 * Output schema for tokens.catalog command
 */
const OutputSchema = z.object({
	tokens: z.array(CatalogTokenSchema),
	/** Matching tokens before `limit` */
	total: z.number(),
	summary: z.object({
		categories: z.record(z.string(), z.number()),
		customized: z.number(),
		removed: z.number(),
	}),
});

type Output = z.infer<typeof OutputSchema>;
type CatalogToken = Output['tokens'][number];

function matchesQuery(token: CatalogToken, words: string[]): boolean {
	if (words.length === 0) return true;
	const haystack = `${token.id} ${token.description ?? ''} ${token.category}`.toLowerCase();
	return words.every((word) => haystack.includes(word));
}

/**
 * tokens.catalog command
 *
 * Every token with its metadata, where it is defined, and which nodes customize
 * or remove it. Powers token search, browsing by category, and "most
 * customized" lists without needing to know token ids up front.
 */
export const tokensCatalogCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'tokens.catalog',
	description:
		'List tokens with metadata, where each is defined, and which nodes customize or remove it',
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const scope = await selectSubtree(db, input.rootId);
		if (!scope) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.rootId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}
		const scopeIds = scope.map((node) => node.id);

		// Definitions come from the scope, its ancestors (a subtree inherits their
		// tokens) and the mixins it includes
		const ancestors = input.rootId ? await db.getAncestryChain(input.rootId) : [];
		const mixins = [
			...new Set(
				scope.flatMap((node) => node.includes ?? []).filter((id) => !scopeIds.includes(id)),
			),
		];
		const definingIds = definitionOrder(ancestors, scope, mixins);
		const opsByNode = new Map<string, OperationRecord[]>();
		for (const nodeId of definingIds) {
			opsByNode.set(nodeId, await db.getOperations(nodeId));
		}
		const definitions = collectDefinitions(definingIds, opsByNode);

		// Customizations and removals inside the scope
		const customizedOn = new Map<string, Set<string>>();
		const removedOn = new Map<string, Set<string>>();
		const note = (map: Map<string, Set<string>>, tokenId: string, nodeId: string) => {
			const nodes = map.get(tokenId) ?? new Set<string>();
			nodes.add(nodeId);
			map.set(tokenId, nodes);
		};
		for (const node of scope) {
			for (const op of opsByNode.get(node.id) ?? []) {
				if (op.type === 'subtract') note(removedOn, op.tokenId, node.id);
				else if (op.type !== 'add') note(customizedOn, operationTarget(op), node.id);
			}
			// With the override policy, a mixin's tokens replace inherited values here
			const mixinsOverride = node.includePolicy === 'override';
			for (const mixinId of mixinsOverride ? (node.includes ?? []) : []) {
				for (const op of opsByNode.get(mixinId) ?? (await db.getOperations(mixinId))) {
					if (op.type !== 'subtract') note(customizedOn, operationTarget(op), node.id);
				}
			}
		}

		const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
		const matching: CatalogToken[] = [];
		for (const definition of definitions.values()) {
			const { metadata } = definition;
			const token: CatalogToken = {
				id: definition.id,
				category: metadata.category,
				tier: metadata.tier,
				status: metadata.status,
				definedAt: definition.definedAt,
				customizedOn: [...(customizedOn.get(definition.id) ?? [])].sort(),
				removedOn: [...(removedOn.get(definition.id) ?? [])].sort(),
			};
			if (metadata.description) token.description = metadata.description;
			if (metadata.owner) token.owner = metadata.owner;
			if (metadata.deprecatedBy) token.deprecatedBy = metadata.deprecatedBy;

			if (input.category && token.category !== input.category) continue;
			if (input.tier && token.tier !== input.tier) continue;
			if (input.status && token.status !== input.status) continue;
			if (!matchesQuery(token, words)) continue;
			matching.push(token);
		}

		const changes = (token: CatalogToken) => token.customizedOn.length + token.removedOn.length;
		matching.sort((a, b) =>
			input.sort === 'customized'
				? changes(b) - changes(a) || a.id.localeCompare(b.id)
				: a.id.localeCompare(b.id),
		);

		const categories: Record<string, number> = {};
		for (const token of matching) {
			categories[token.category] = (categories[token.category] ?? 0) + 1;
		}
		const tokens = input.limit ? matching.slice(0, input.limit) : matching;

		return success(
			{
				tokens,
				total: matching.length,
				summary: {
					categories,
					customized: matching.filter((token) => token.customizedOn.length > 0).length,
					removed: matching.filter((token) => token.removedOn.length > 0).length,
				},
			},
			{
				reasoning: `${matching.length} token(s) match${tokens.length < matching.length ? `; showing ${tokens.length}` : ''}`,
			},
		);
	},

	examples: [
		{
			description: 'Search tokens by words in their id or description',
			input: { query: 'accent' },
		},
		{
			description: 'Colour tokens customized most within the xbox subtree',
			input: { rootId: 'xbox', category: 'color', sort: 'customized', limit: 10 },
		},
	],
};
