import { checkCssTokenValue } from '@lushly-dev/violet-core/css';
import {
	InheritanceResolutionError,
	resolveNodeTokenMap,
	withResolutionCache,
} from '@lushly-dev/violet-core/engine';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * A token interface: every token id a component library reads, as
 * `violet-elements`' `tokens/interface.json` publishes it
 */
const TokenInterfaceSchema = z.object({
	contractVersion: z.number().int().nonnegative(),
	package: z.string().optional(),
	/** The prefix of every property (`violet` from contract version 4): `--<cssPrefix>-<kebab id>` */
	cssPrefix: z.string().optional(),
	tokens: z.record(
		z.string().min(1),
		z.object({
			property: z.string().optional(),
			/** DTCG `$type` the value must hold */
			type: z.string().optional(),
			reserved: z.boolean().optional(),
		}),
	),
});

/**
 * Input schema for interface.check command
 */
const InputSchema = z.object({
	/** The interface file's content, such as violet-elements' tokens/interface.json */
	interface: TokenInterfaceSchema,
	/** Nodes to check; defaults to every theme node, or every node when the tree has none */
	nodes: z.array(z.string().min(1)).min(1).max(200).optional(),
	/** Token id prefixes forbidden in a public component interface (default: ['ref.']) */
	privatePrefixes: z.array(z.string().min(1)).default(['ref.']),
});

/**
 * Output schema for interface.check command
 */
const OutputSchema = z.object({
	interface: z.object({ version: z.number(), package: z.string().optional() }),
	/** Every id resolves, to a value its type can hold, with no leaked private/global tokens */
	complete: z.boolean(),
	nodes: z.array(z.string()),
	/** Ids a node does not resolve, or resolves only through a broken reference */
	missing: z.array(
		z.object({
			node: z.string(),
			token: z.string(),
			reason: z.enum(['absent', 'broken-reference']),
		}),
	),
	/** Ids a node resolves to a value the interface's type cannot hold */
	invalid: z.array(
		z.object({ node: z.string(), token: z.string(), type: z.string(), problem: z.string() }),
	),
	/** Private-prefix or global-tier tokens leaked into the public component interface */
	leaked: z.array(
		z.object({
			token: z.string(),
			reason: z.enum(['private-prefix', 'global-tier']),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * interface.check command
 *
 * Check that every token id of a component library's interface resolves in each
 * theme node, to a value its type can hold (#1323).
 */
export const interfaceCheckCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'interface.check',
	description:
		"Check that every token id of a component interface (such as violet-elements' tokens/interface.json) resolves in each theme node",
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const scoped = withResolutionCache(context);
		const { db } = scoped;

		let nodeIds: string[];
		if (input.nodes) {
			nodeIds = input.nodes;
			for (const nodeId of nodeIds) {
				const node = await db.getNode(nodeId);
				if (!node || node.deletedAt) {
					return failure({
						code: ErrorCodes.NODE_NOT_FOUND,
						message: `Node '${nodeId}' not found`,
						suggestion: `Use 'node.list' to see available nodes`,
					});
				}
			}
		} else {
			const live = (await db.listNodes()).filter((node) => !node.deletedAt);
			const themes = live.filter((node) => node.type === 'theme');
			nodeIds = (themes.length > 0 ? themes : live).map((node) => node.id).sort();
		}

		const ids = Object.keys(input.interface.tokens).sort();
		const missing: Output['missing'] = [];
		const invalid: Output['invalid'] = [];
		const leakedByToken = new Map<string, 'private-prefix' | 'global-tier'>();

		for (const id of ids) {
			if (input.privatePrefixes.some((prefix) => id.startsWith(prefix))) {
				leakedByToken.set(id, 'private-prefix');
			}
		}

		for (const nodeId of nodeIds) {
			let tokens: Awaited<ReturnType<typeof resolveNodeTokenMap>>;
			try {
				tokens = await resolveNodeTokenMap(db, nodeId, scoped.resolutionCache);
			} catch (error) {
				if (error instanceof InheritanceResolutionError) {
					return failure({
						code: ErrorCodes.CIRCULAR_REFERENCE,
						message: error.message,
						suggestion: `Remove the copy or include that creates the loop (see node.get for '${nodeId}')`,
					});
				}
				throw error;
			}
			for (const id of ids) {
				const token = tokens.get(id);
				if (!token) {
					missing.push({ node: nodeId, token: id, reason: 'absent' });
					continue;
				}
				if (token.metadata.tier === 'global' && !leakedByToken.has(id)) {
					leakedByToken.set(id, 'global-tier');
				}
				if (token.referenceError) {
					missing.push({ node: nodeId, token: id, reason: 'broken-reference' });
					continue;
				}
				const type = input.interface.tokens[id]?.type;
				const problem = type ? checkCssTokenValue(token.resolvedValue, { type }) : null;
				if (type && problem) invalid.push({ node: nodeId, token: id, type, problem });
			}
		}

		const leaked: Output['leaked'] = [...leakedByToken.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([token, reason]) => ({ token, reason }));
		const complete = missing.length === 0 && invalid.length === 0 && leaked.length === 0;
		return success(
			{
				interface: {
					version: input.interface.contractVersion,
					...(input.interface.package ? { package: input.interface.package } : {}),
				},
				complete,
				nodes: nodeIds,
				missing,
				invalid,
				leaked,
			},
			{
				reasoning: complete
					? `All ${ids.length} interface ids resolve in ${nodeIds.length} node(s)`
					: `${missing.length} missing, ${invalid.length} invalid and ${leaked.length} leaked across ${nodeIds.length} node(s), of ${ids.length} interface ids`,
				...(complete
					? {}
					: {
							suggestions: [
								"Add each missing id with 'token.add' on the node the themes share, or with 'token.override' in a theme that lacks it",
								"Fix each invalid value with 'token.override' at the node that sets it (see token.lineage)",
								...(leaked.length > 0
									? [
											'Replace leaked private-prefix or global-tier tokens in interface.json with purpose-named semantic tokens',
										]
									: []),
							],
						}),
			},
		);
	},

	examples: [
		{
			description: 'Check every theme node against an interface',
			input: {
				interface: {
					contractVersion: 2,
					tokens: { 'color.surface.page': { property: '--color-surface-page', type: 'color' } },
				},
			},
		},
		{
			description: 'Check two nodes',
			input: {
				interface: { contractVersion: 2, tokens: { 'size.focus.width': { type: 'dimension' } } },
				nodes: ['example/light', 'example/dark'],
			},
		},
	],
};
