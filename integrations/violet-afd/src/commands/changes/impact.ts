import { OverlayDatabase } from '@lushly-dev/violet-core/engine';
import { withResolutionCache } from '@lushly-dev/violet-core/engine';
import type { Node } from '@lushly-dev/violet-core/types';
import { TokenMetadataSchema, TokenValueSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { type CommandResult, ErrorCodes, failure, success } from '../../types/command-result.js';
import { type NodeViolation, NodeViolationSchema, nodeViolations } from '../analyze/violations.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import {
	MAX_MATRIX_NODES,
	type MatrixCell,
	MatrixCellSchema,
	computeTokenMatrix,
} from '../token/matrix.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenResetCommand } from '../token/reset.js';
import { tokenSubtractCommand } from '../token/subtract.js';

/** Upper bound on proposed changes in one preview */
export const MAX_IMPACT_CHANGES = 50;

const tokenId = z.string().min(1);

/**
 * A proposed token operation on the previewed node. Copies are left out: they
 * add a dependency edge rather than change a value.
 */
export const ImpactChangeSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('add'),
		tokenId,
		value: TokenValueSchema,
		metadata: TokenMetadataSchema.optional(),
	}),
	z.object({ type: z.literal('override'), tokenId, value: TokenValueSchema }),
	z.object({ type: z.literal('subtract'), tokenId }),
	z.object({ type: z.literal('reset'), tokenId, toAncestor: z.string().min(1).optional() }),
]);

export type ImpactChange = z.infer<typeof ImpactChangeSchema>;

/**
 * Input schema for changes.impact command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	changes: z.array(ImpactChangeSchema).min(1).max(MAX_IMPACT_CHANGES),
	includeViolations: z.boolean().optional().default(true), // Diff constraint violations per node
});

/**
 * What a change does to one token at one node.
 *
 * - changes: the value differs afterwards
 * - added / removed: the token appears or disappears
 * - shielded: the value stays because a customization closer to the node
 *   (its own, an ancestor's, or a mixed-in set's) wins; see `shieldedBy`
 * - unaffected: the value stays and nothing shields it (e.g. a no-op change,
 *   or a node that never had the token)
 * - unresolved: the node could not be resolved (e.g. a copy/include cycle)
 */
export const ImpactEffectSchema = z.enum([
	'changes',
	'added',
	'removed',
	'shielded',
	'unaffected',
	'unresolved',
]);

export type ImpactEffect = z.infer<typeof ImpactEffectSchema>;

/**
 * How the change reaches a node: it is the changed node, a descendant, a node
 * that mixes in an affected node, or one that borrows (copies) from one.
 */
export const ImpactViaSchema = z.enum(['direct', 'inheritance', 'include', 'copy']);

export type ImpactVia = z.infer<typeof ImpactViaSchema>;

const ImpactTokenSchema = z.object({
	tokenId: z.string(),
	effect: ImpactEffectSchema,
	before: MatrixCellSchema,
	after: MatrixCellSchema,
	/** Shielded: the node whose customization keeps the value (or removal) in place */
	shieldedBy: z.string().optional(),
	/** The node this one copied the token from, when the change removes the copy's source */
	copySourceRemoved: z.string().optional(),
	/** False for tokens that change only because they refer to a changed token */
	direct: z.boolean(),
});

const ImpactNodeSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	status: z.string(),
	parentId: z.string().nullable(),
	depth: z.number(),
	via: ImpactViaSchema,
	/** Include or copy: the affected node that is mixed in or copied from */
	through: z.string().optional(),
	/** The strongest effect across this node's tokens */
	effect: ImpactEffectSchema,
	tokens: z.array(ImpactTokenSchema),
	violations: z.object({
		introduced: z.array(NodeViolationSchema),
		resolved: z.array(NodeViolationSchema),
	}),
	error: z.string().optional(),
});

const ApplyStepSchema = z.object({
	command: z.string(),
	input: z.record(z.string(), z.unknown()),
	/** The `violet` command line that applies this step */
	cli: z.string(),
});

/**
 * Output schema for changes.impact command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	changes: z.array(ImpactChangeSchema),
	nodes: z.array(ImpactNodeSchema),
	/** The commands that would apply the previewed changes, in order */
	apply: z.array(ApplyStepSchema),
	summary: z.object({
		nodes: z.number(),
		/** Affected nodes per effect */
		effects: z.object({
			changes: z.number(),
			added: z.number(),
			removed: z.number(),
			shielded: z.number(),
			unaffected: z.number(),
			unresolved: z.number(),
		}),
		violationsIntroduced: z.number(),
		violationsResolved: z.number(),
		/** Nodes with at least one introduced violation */
		breakingNodes: z.number(),
		violationsChecked: z.boolean(),
	}),
});

type Output = z.infer<typeof OutputSchema>;
type ImpactNode = Output['nodes'][number];
type ImpactToken = ImpactNode['tokens'][number];
type ApplyStep = Output['apply'][number];

/** Strongest first: a node's effect is the first of these any of its tokens has */
const EFFECT_PRIORITY: ImpactEffect[] = [
	'unresolved',
	'changes',
	'removed',
	'added',
	'shielded',
	'unaffected',
];

/**
 * A node's effect: the strongest effect on the changed tokens themselves.
 * Tokens that move only because they refer to a changed one turn a shielded
 * or unaffected node into one that changes.
 */
function nodeEffect(tokens: ImpactToken[]): ImpactEffect {
	const strongest = (list: ImpactToken[]) =>
		EFFECT_PRIORITY.find((effect) => list.some((token) => token.effect === effect));
	const direct = strongest(tokens.filter((token) => token.direct)) ?? 'unaffected';
	if (direct !== 'shielded' && direct !== 'unaffected') return direct;
	const dependents = strongest(tokens.filter((token) => !token.direct));
	return dependents === 'unresolved' || !dependents ? direct : 'changes';
}

/** Effects where the value at the node differs afterwards */
const VALUE_EFFECTS = new Set<ImpactEffect>(['changes', 'added', 'removed']);

const PRESENT = (cell: MatrixCell) =>
	cell.state !== 'absent' && cell.state !== 'subtracted' && cell.state !== 'unresolved';

/** The value a cell shows, or null when the token is not there */
function valueKey(cell: MatrixCell): string | null {
	return PRESENT(cell) ? JSON.stringify([cell.value, cell.resolvedValue]) : null;
}

/** Compare one token at one node before and after the change */
function describeToken(
	tokenId: string,
	before: MatrixCell,
	after: MatrixCell,
	nodeId: string,
	changed: { id: string; ancestors: Set<string> },
	direct: boolean,
): ImpactToken {
	const entry: ImpactToken = { tokenId, effect: 'unaffected', before, after, direct };
	if (before.state === 'copy' && after.state !== 'copy' && before.fromNode) {
		entry.copySourceRemoved = before.fromNode;
	}
	if (before.state === 'unresolved' || after.state === 'unresolved') {
		entry.effect = 'unresolved';
		return entry;
	}
	const was = valueKey(before);
	const now = valueKey(after);
	if (was === null && now !== null) {
		entry.effect = 'added';
	} else if (was !== null && now === null) {
		entry.effect = 'removed';
	} else if (was !== now) {
		entry.effect = 'changes';
	} else if (
		nodeId !== changed.id &&
		after.source !== null &&
		after.source !== changed.id &&
		!changed.ancestors.has(after.source)
	) {
		// Same value (or still removed) because a node closer than the change sets it;
		// a value from above the changed node means the change simply made no difference
		entry.effect = 'shielded';
		entry.shieldedBy = after.source;
	}
	return entry;
}

/** Quote an argument for a POSIX shell only when it needs it */
function shellArg(value: string): string {
	return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A value as the CLI's --value expects it: raw text, or JSON when raw text would be misread */
function cliValue(value: unknown): string {
	if (typeof value === 'string') {
		try {
			JSON.parse(value);
		} catch {
			return value;
		}
	}
	return JSON.stringify(value);
}

/** The mutation command and `violet` command line that applies one change */
function applyStep(nodeId: string, change: ImpactChange): ApplyStep {
	const base = ['violet', 'token', change.type, '--node', nodeId, '--token', change.tokenId];
	switch (change.type) {
		case 'add': {
			const input = {
				nodeId,
				tokenId: change.tokenId,
				value: change.value,
				...(change.metadata ? { metadata: change.metadata } : {}),
			};
			const metadataKeys = Object.keys(change.metadata ?? {});
			const simple = metadataKeys.every((key) => key === 'category');
			const cli = simple
				? [
						...base,
						'--value',
						cliValue(change.value),
						...(change.metadata?.category ? ['--category', change.metadata.category] : []),
					]
				: ['violet', 'call', 'token.add', '--input', JSON.stringify(input)];
			return { command: 'token.add', input, cli: cli.map(shellArg).join(' ') };
		}
		case 'override':
			return {
				command: 'token.override',
				input: { nodeId, tokenId: change.tokenId, value: change.value },
				cli: [...base, '--value', cliValue(change.value)].map(shellArg).join(' '),
			};
		case 'subtract':
			return {
				command: 'token.subtract',
				input: { nodeId, tokenId: change.tokenId },
				cli: base.map(shellArg).join(' '),
			};
		case 'reset':
			return {
				command: 'token.reset',
				input: { nodeId, tokenId: change.tokenId, toAncestor: change.toAncestor },
				cli: [...base, ...(change.toAncestor ? ['--ancestor', change.toAncestor] : [])]
					.map(shellArg)
					.join(' '),
			};
	}
}

/**
 * Run one change through its mutation command against the overlay, so it is
 * validated exactly as a real change would be. Returns the change with
 * defaults filled in (a reset's target ancestor).
 */
async function stageChange(
	nodeId: string,
	change: ImpactChange,
	context: CommandContext,
): Promise<{ change: ImpactChange } | { error: CommandResult<never> }> {
	let result: CommandResult<unknown>;
	switch (change.type) {
		case 'add':
			result = await tokenAddCommand.handler({ nodeId, ...change }, context);
			break;
		case 'override':
			result = await tokenOverrideCommand.handler({ nodeId, ...change }, context);
			break;
		case 'subtract':
			result = await tokenSubtractCommand.handler({ nodeId, ...change }, context);
			break;
		case 'reset': {
			const reset = await tokenResetCommand.handler({ nodeId, ...change }, context);
			if (reset.success && reset.data) {
				return { change: { ...change, toAncestor: reset.data.toAncestor } };
			}
			result = reset;
			break;
		}
	}
	if (!result.success) {
		return {
			error: failure({
				code: result.error?.code ?? ErrorCodes.INVALID_OPERATION,
				message: `Cannot preview ${change.type} '${change.tokenId}': ${result.error?.message ?? 'rejected'}`,
				suggestion: result.error?.suggestion,
			}),
		};
	}
	return { change };
}

type Reach = { via: ImpactVia; through?: string };

/** The affected node a node mixes in or copies from, if any */
function reachedThrough(
	node: Node,
	affected: Map<string, Reach>,
	copySources: Map<string, string[]>,
): Reach | null {
	const included = (node.includes ?? []).find((id) => affected.has(id));
	if (included) return { via: 'include', through: included };
	const copied = (copySources.get(node.id) ?? []).find((id) => affected.has(id));
	return copied ? { via: 'copy', through: copied } : null;
}

/**
 * Every node a change at `nodeId` can reach, with how it gets there: the node
 * and its descendants, then (repeatedly) nodes that mix in or copy from an
 * affected node, with their descendants. Cycle-safe.
 */
function affectedNodes(
	nodeId: string,
	live: Node[],
	copySources: Map<string, string[]>,
): Map<string, Reach> {
	const children = new Map<string, Node[]>();
	for (const node of live) {
		if (node.parentId) {
			children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
		}
	}

	const affected = new Map<string, Reach>();
	const addTree = (id: string, reach: Reach) => {
		if (affected.has(id)) return;
		affected.set(id, reach);
		const childReach: Reach = reach.via === 'direct' ? { via: 'inheritance' } : reach;
		for (const child of children.get(id) ?? []) {
			addTree(child.id, childReach);
		}
	};
	addTree(nodeId, { via: 'direct' });

	let grew = true;
	while (grew) {
		grew = false;
		for (const node of live) {
			const reach = affected.has(node.id) ? null : reachedThrough(node, affected, copySources);
			if (reach) {
				addTree(node.id, reach);
				grew = true;
			}
		}
	}
	return affected;
}

/**
 * Compare the before and after matrices node by node. Each node lists the
 * changed tokens (first, in the order proposed) plus any other token whose
 * value moves, such as one that refers to a changed token.
 */
function compareNodes(
	before: Awaited<ReturnType<typeof computeTokenMatrix>>,
	after: Awaited<ReturnType<typeof computeTokenMatrix>>,
	reach: Map<string, Reach>,
	changedTokens: string[],
	changed: { id: string; ancestors: Set<string> },
): ImpactNode[] {
	const beforeRows = new Map(before.rows.map((row) => [row.id, row]));
	const afterRows = new Map(after.rows.map((row) => [row.id, row]));
	const tokenIds = [...new Set([...beforeRows.keys(), ...afterRows.keys()])];
	const missing = (): MatrixCell => ({ state: 'absent', source: null });
	const rank = (token: ImpactToken) =>
		token.direct ? changedTokens.indexOf(token.tokenId) : changedTokens.length;

	const compareTokens = (nodeId: string): ImpactToken[] =>
		tokenIds.flatMap((id) => {
			const was = beforeRows.get(id)?.cells[nodeId] ?? missing();
			const now = afterRows.get(id)?.cells[nodeId] ?? missing();
			const direct = changedTokens.includes(id);
			if (!direct && valueKey(was) === valueKey(now)) return [];
			const entry = describeToken(id, was, now, nodeId, changed, direct);
			return direct || entry.effect !== 'unaffected' ? [entry] : [];
		});

	return after.nodes.map((column) => {
		const tokens = compareTokens(column.id);
		tokens.sort((a, b) => rank(a) - rank(b) || a.tokenId.localeCompare(b.tokenId));

		const error = column.error ?? before.nodes.find((entry) => entry.id === column.id)?.error;
		return {
			id: column.id,
			name: column.name,
			type: column.type,
			status: column.status,
			parentId: column.parentId,
			depth: column.depth,
			...(reach.get(column.id) as Reach),
			effect: error ? 'unresolved' : nodeEffect(tokens),
			tokens,
			violations: { introduced: [], resolved: [] },
			...(error ? { error } : {}),
		};
	});
}

const violationKey = (violation: NodeViolation) =>
	`${violation.tokenId}\u0000${violation.constraintId}`;

/**
 * Fill in the violations each node gains or loses. Rules read resolved values
 * only, so a node where no value moves keeps its violations and is skipped.
 */
async function diffViolations(
	nodes: ImpactNode[],
	owners: Map<string, string | undefined>,
	beforeContext: CommandContext,
	afterContext: CommandContext,
): Promise<void> {
	for (const entry of nodes) {
		const moved = entry.tokens.some((token) => VALUE_EFFECTS.has(token.effect));
		if (entry.error || !moved) continue;
		const target = { id: entry.id, owner: owners.get(entry.id) };
		const was = (await nodeViolations(beforeContext, target, undefined)) ?? [];
		const now = (await nodeViolations(afterContext, target, undefined)) ?? [];
		const wasKeys = new Set(was.map(violationKey));
		const nowKeys = new Set(now.map(violationKey));
		entry.violations.introduced = now.filter((violation) => !wasKeys.has(violationKey(violation)));
		entry.violations.resolved = was.filter((violation) => !nowKeys.has(violationKey(violation)));
	}
}

function summarize(nodes: ImpactNode[], violationsChecked: boolean): Output['summary'] {
	const effects: Record<ImpactEffect, number> = {
		changes: 0,
		added: 0,
		removed: 0,
		shielded: 0,
		unaffected: 0,
		unresolved: 0,
	};
	const summary = {
		nodes: nodes.length,
		effects,
		violationsIntroduced: 0,
		violationsResolved: 0,
		breakingNodes: 0,
		violationsChecked,
	};
	for (const entry of nodes) {
		effects[entry.effect] += 1;
		summary.violationsIntroduced += entry.violations.introduced.length;
		summary.violationsResolved += entry.violations.resolved.length;
		if (entry.violations.introduced.length > 0) summary.breakingNodes += 1;
	}
	return summary;
}

/** One line for the result's reasoning, e.g. "1 changed, 34 shielded; 0 violation(s) introduced" */
function describeSummary(summary: Output['summary']): string {
	const { effects } = summary;
	const parts = [`${effects.changes} changed`];
	if (effects.removed > 0) parts.push(`${effects.removed} lose the token`);
	if (effects.added > 0) parts.push(`${effects.added} gain the token`);
	parts.push(`${effects.shielded} shielded`);
	if (effects.unresolved > 0) parts.push(`${effects.unresolved} unresolved`);
	const violations = summary.violationsChecked
		? `; ${summary.violationsIntroduced} violation(s) introduced, ${summary.violationsResolved} resolved`
		: '';
	return `${parts.join(', ')}${violations}`;
}

/**
 * changes.impact command
 *
 * Dry-run token operations on a node and report the effect across the graph:
 * per affected node, before → after, whether its own customization shields
 * it, how the change reaches it, and which constraint violations it would
 * introduce or resolve. Nothing is written: the changes are staged on a
 * read-only overlay of the database.
 */
export const changesImpactCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'changes.impact',
	description:
		'Preview token changes on a node without writing them: who changes, who is shielded, and which rule violations appear or clear',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const node = await db.getNode(input.nodeId);
		if (!node || node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		// Stage each change through its own mutation command, in order, so later
		// changes see earlier ones and invalid changes fail the same way
		const overlay = new OverlayDatabase(db);
		const stagingContext: CommandContext = { ...context, db: overlay.stagingView() };
		const changes: ImpactChange[] = [];
		for (const change of input.changes) {
			const staged = await stageChange(input.nodeId, change, stagingContext);
			if ('error' in staged) {
				return staged.error;
			}
			changes.push(staged.change);
		}
		const afterContext: CommandContext = { ...context, db: overlay };

		// The affected set: descendants, then mix-ins and borrows of anything affected
		const live = (await selectSubtree(db)) ?? [];
		const copySources = new Map<string, string[]>();
		for (const candidate of live) {
			const sources = (await db.getOperations(candidate.id))
				.filter((op) => op.type === 'copy' && op.fromNode)
				.map((op) => op.fromNode as string);
			if (sources.length > 0) copySources.set(candidate.id, sources);
		}
		const reach = affectedNodes(input.nodeId, live, copySources);
		const columns = live.filter((candidate) => reach.has(candidate.id));
		if (columns.length > MAX_MATRIX_NODES) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `The change reaches ${columns.length} nodes (max ${MAX_MATRIX_NODES})`,
				suggestion: 'Preview the change on a node lower in the hierarchy',
			});
		}

		// Every change is staged by now, so each side can cache its resolutions
		// for the rest of this run (the matrix and the violation diff share them)
		const beforeContext = withResolutionCache(context);
		const resolvedAfterContext = withResolutionCache(afterContext);
		const before = await computeTokenMatrix(beforeContext, columns);
		const after = await computeTokenMatrix(resolvedAfterContext, columns);
		const changed = {
			id: input.nodeId,
			ancestors: new Set(await db.getAncestryChain(input.nodeId)),
		};
		const changedTokens = [...new Set(changes.map((change) => change.tokenId))];
		const nodes = compareNodes(before, after, reach, changedTokens, changed);
		if (input.includeViolations) {
			const owners = new Map(columns.map((column) => [column.id, column.owner]));
			await diffViolations(nodes, owners, beforeContext, resolvedAfterContext);
		}
		const summary = summarize(nodes, input.includeViolations);

		return success(
			{
				nodeId: input.nodeId,
				changes,
				nodes,
				apply: changes.map((change) => applyStep(input.nodeId, change)),
				summary,
			},
			{
				reasoning: `Previewed ${changes.length} change(s) on '${input.nodeId}' across ${nodes.length} node(s): ${describeSummary(summary)}. Nothing was written.`,
				sources: [{ type: 'node', id: node.id, title: node.name }],
			},
		);
	},

	examples: [
		{
			description: 'What happens if the root accent colour changes?',
			input: {
				nodeId: 'global',
				changes: [{ type: 'override', tokenId: 'color.accent.primary', value: '#C50F1F' }],
			},
		},
		{
			description: 'Remove a token from a product, without checking rules',
			input: {
				nodeId: 'xbox',
				changes: [{ type: 'subtract', tokenId: 'color.focus' }],
				includeViolations: false,
			},
		},
		{
			description: 'Reset a theme customization back to the product value',
			input: {
				nodeId: 'xbox-dark',
				changes: [{ type: 'reset', tokenId: 'color.accent.primary', toAncestor: 'xbox' }],
			},
		},
	],
};
