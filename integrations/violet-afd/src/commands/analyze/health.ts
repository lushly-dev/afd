import {
	InheritanceResolutionError,
	resetTarget,
	resolveNodeTokenMap,
} from '@lushly-dev/violet-core/engine';
import type { Node } from '@lushly-dev/violet-core/types';
import type { OperationRecord } from '@lushly-dev/violet-core/types';
import type { ResolvedToken } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { daysUntil } from '../node/deprecation.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { operationTarget } from '../token/definitions.js';
import { nodeViolations } from './violations.js';

/**
 * Input schema for analyze.health command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree to report; defaults to every tree
	/**
	 * What drift is measured against: 'parent' (what the node inherits, the
	 * default), 'root' (the top of the node's tree), or any node id (a chosen
	 * reference, e.g. a product every theme should match). The keywords win
	 * over a node with the same id.
	 */
	baseline: z.string().min(1).optional().default('parent'),
	sort: z.enum(['tree', 'drift', 'violations', 'customizations']).optional().default('tree'),
	includeViolations: z.boolean().optional().default(true), // Run every node's constraints (slowest part)
});

const SeverityCountsSchema = z.object({
	total: z.number(),
	error: z.number(),
	warning: z.number(),
	info: z.number(),
});

/**
 * A risk worth a look:
 * - redundant-override: an override equal to the value the node already inherits
 * - sibling-borrow: a copy from a node outside this node's own line (not an
 *   ancestor or descendant), so a change there silently changes this node
 * - deprecated-with-children: a deprecated node that still has children
 * - inert-reset: a stored reset that does nothing, because it is on a root or
 *   its target is not an ancestor of the node (see resetTarget)
 * - sunset-without-replacement: a node with a sunset date but no replacement
 * - replacement-deprecated: a node whose replacement is itself deprecated, or
 *   no longer exists
 * - past-sunset: a node still in the tree after its sunset date
 */
const HealthFlagSchema = z.object({
	kind: z.enum([
		'redundant-override',
		'sibling-borrow',
		'deprecated-with-children',
		'inert-reset',
		'sunset-without-replacement',
		'replacement-deprecated',
		'past-sunset',
	]),
	message: z.string(),
	tokenId: z.string().optional(),
	value: z.any().optional(),
	/** Redundant overrides: the node the equal value is inherited from */
	inheritedFrom: z.string().optional(),
	/** Sibling borrows: the copy source */
	fromNode: z.string().optional(),
	/** Inert resets: the stored target, when there is one */
	toAncestor: z.string().optional(),
	/** Deprecated nodes: their children */
	children: z.array(z.string()).optional(),
	/** Deprecation plans: the replacement and the sunset date */
	replacedBy: z.string().optional(),
	sunsetAt: z.string().optional(),
});

/**
 * A deprecated node's plan and what still depends on it: when it goes away,
 * what replaces it, and its usage (descendants and borrowers in the report)
 */
const DeprecationSchema = z.object({
	/** `YYYY-MM-DD`, or null when no date is set */
	sunsetAt: z.string().nullable(),
	/** Days from today (UTC) to the sunset date; negative once passed */
	daysLeft: z.number().nullable(),
	replacedBy: z.string().nullable(),
	/** The replacement's status, or null when there is none or it no longer exists */
	replacementStatus: z.string().nullable(),
	usage: z.object({
		/** Nodes under this one */
		descendants: z.number(),
		/** Nodes that copy tokens from this one */
		borrowers: z.number(),
	}),
});

const HealthNodeSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	status: z.string(),
	parentId: z.string().nullable(),
	depth: z.number(),
	owner: z.string().optional(),
	/** For a deprecated node, or one with a sunset date or replacement */
	deprecation: DeprecationSchema.optional(),
	/** Tokens the node resolves */
	tokens: z.number(),
	/** The node's own effective changes: the last operation per token */
	customizations: z.object({
		total: z.number(),
		add: z.number(),
		override: z.number(),
		subtract: z.number(),
		reset: z.number(),
		copy: z.number(),
		byCategory: z.record(z.string(), z.number()),
	}),
	/** Resolved tokens that differ from the baseline node's */
	drift: z.object({
		/** Node compared against; null when there is none (a root, with baseline 'parent') */
		baseline: z.string().nullable(),
		/** Tokens in either node */
		compared: z.number(),
		/** Different value in both */
		changed: z.number(),
		/** Only here */
		added: z.number(),
		/** Only in the baseline */
		removed: z.number(),
		/** (changed + added + removed) / compared, 0–1 */
		ratio: z.number(),
	}),
	/** Constraint violations by severity; omitted when not checked */
	violations: SeverityCountsSchema.optional(),
	coupling: z.object({
		/** Mixed-in nodes */
		includes: z.array(z.string()),
		/** Nodes this one copies tokens from */
		borrows: z.array(
			z.object({
				fromNode: z.string(),
				relation: z.enum(['ancestor', 'descendant', 'sibling']),
				tokens: z.array(z.string()),
			}),
		),
		/** Nodes in the report that copy tokens from this one */
		borrowedBy: z.array(z.string()),
	}),
	flags: z.array(HealthFlagSchema),
	/** This node plus its descendants in the report */
	subtree: z.object({
		nodes: z.number(),
		customizations: z.number(),
		violations: z.number(),
		maxDrift: z.number(),
	}),
	/** Why the node could not be resolved (e.g. a copy/include cycle) */
	error: z.string().optional(),
});

/**
 * Output schema for analyze.health command
 */
const OutputSchema = z.object({
	baseline: z.string(),
	sort: z.string(),
	nodes: z.array(HealthNodeSchema),
	summary: z.object({
		nodes: z.number(),
		customizations: z.number(),
		violations: SeverityCountsSchema.optional(),
		flags: z.object({
			redundantOverrides: z.number(),
			siblingBorrows: z.number(),
			deprecatedWithChildren: z.number(),
			inertResets: z.number(),
			sunsetWithoutReplacement: z.number(),
			replacementDeprecated: z.number(),
			pastSunset: z.number(),
		}),
		/** Nodes with a sunset date, soonest first */
		sunsets: z.array(
			z.object({
				id: z.string(),
				sunsetAt: z.string(),
				daysLeft: z.number(),
				replacedBy: z.string().nullable(),
				descendants: z.number(),
				borrowers: z.number(),
			}),
		),
		/** Nodes with at least one flag */
		flagged: z.number(),
		/** Nodes and violations per owner; `owner` is null for unowned nodes */
		owners: z.array(
			z.object({
				owner: z.string().nullable(),
				nodes: z.number(),
				customizations: z.number(),
				violations: z.number(),
			}),
		),
		/** Nodes that could not be resolved */
		unresolved: z.array(z.string()),
	}),
});

type Output = z.infer<typeof OutputSchema>;
export type HealthNode = Output['nodes'][number];
export type HealthFlag = z.infer<typeof HealthFlagSchema>;
export type HealthDeprecation = z.infer<typeof DeprecationSchema>;
type TokenMap = Map<string, ResolvedToken>;

/** Compare values with references followed, as the matrix does */
function valueKey(token: ResolvedToken): string {
	return JSON.stringify(token.finalValue ?? token.value);
}

function round(ratio: number): number {
	return Math.round(ratio * 10_000) / 10_000;
}

/** Tokens that differ between a node and its baseline */
export function compareTokenMaps(
	tokens: TokenMap,
	baseline: TokenMap,
): Omit<HealthNode['drift'], 'baseline'> {
	let changed = 0;
	let added = 0;
	for (const [id, token] of tokens) {
		const other = baseline.get(id);
		if (!other) added += 1;
		else if (valueKey(other) !== valueKey(token)) changed += 1;
	}
	let removed = 0;
	for (const id of baseline.keys()) {
		if (!tokens.has(id)) removed += 1;
	}
	const compared = tokens.size + removed;
	const differing = changed + added + removed;
	return {
		compared,
		changed,
		added,
		removed,
		ratio: compared > 0 ? round(differing / compared) : 0,
	};
}

/** The last operation per token on a node: what it currently changes */
function effectiveOperations(ops: OperationRecord[]): OperationRecord[] {
	const latest = new Map<string, OperationRecord>();
	for (const op of [...ops].sort((a, b) => a.sequence - b.sequence)) {
		const target = operationTarget(op);
		latest.delete(target);
		latest.set(target, op);
	}
	return [...latest.values()];
}

function parseValue(raw: string | null): unknown {
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function formatValue(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Resolves each node once; a string is why it could not be resolved */
type Resolve = (nodeId: string) => Promise<TokenMap | string>;

function createResolver(db: CommandContext['db']): Resolve {
	const resolved = new Map<string, TokenMap | string>();
	return async (nodeId) => {
		let entry = resolved.get(nodeId);
		if (entry === undefined) {
			try {
				entry = await resolveNodeTokenMap(db, nodeId);
			} catch (error) {
				if (!(error instanceof InheritanceResolutionError)) throw error;
				entry = error.message;
			}
			resolved.set(nodeId, entry);
		}
		return entry;
	};
}

interface HealthRun {
	context: CommandContext;
	resolve: Resolve;
	baseline: string;
	includeViolations: boolean;
	childrenOf: Map<string, string[]>;
	/** Today, for days to a sunset */
	now: number;
}

function baselineFor(run: HealthRun, node: Node, chain: string[]): string | null {
	if (run.baseline === 'parent') return node.parentId;
	if (run.baseline === 'root') return chain[0] ?? node.id;
	return run.baseline;
}

/** Where a copy source sits relative to the copying node */
async function relationTo(
	run: HealthRun,
	nodeId: string,
	ancestors: Set<string>,
	sourceId: string,
): Promise<HealthNode['coupling']['borrows'][number]['relation']> {
	if (ancestors.has(sourceId)) return 'ancestor';
	const sourceChain = await run.context.db.getAncestryChain(sourceId);
	return sourceChain.includes(nodeId) ? 'descendant' : 'sibling';
}

/**
 * A flag when an override sets the value the node already inherits. Only when
 * the override is what the node resolves: a mix-in may win over it.
 */
function redundantOverride(
	nodeId: string,
	op: OperationRecord,
	own: ResolvedToken | undefined,
	from: ResolvedToken | undefined,
): HealthFlag | null {
	if (op.type !== 'override' || !own || !from || own.resolvedAt !== nodeId) return null;
	if (valueKey(own) !== valueKey(from)) return null;
	const value = parseValue(op.value);
	return {
		kind: 'redundant-override',
		message: `Overrides ${own.id} with ${formatValue(value)}, the value it already inherits from ${from.resolvedAt}`,
		tokenId: own.id,
		value,
		inheritedFrom: from.resolvedAt,
	};
}

/**
 * Flags for every stored reset that lands nowhere, effective or not: a reset on
 * a root, or to a node that is not an ancestor. It is stored but does nothing.
 */
function inertResets(node: Node, chain: string[], operations: OperationRecord[]): HealthFlag[] {
	return operations
		.filter((op) => op.type === 'reset' && !resetTarget(op, chain))
		.map((op) => ({
			kind: 'inert-reset',
			message: `Resets ${op.tokenId}, but ${
				op.toAncestor
					? `'${op.toAncestor}' is not an ancestor of ${node.id}`
					: `${node.id} is a root, so there is no ancestor to reset to`
			}: the reset does nothing`,
			tokenId: op.tokenId,
			...(op.toAncestor ? { toAncestor: op.toAncestor } : {}),
		}));
}

/**
 * Count a node's effective operations by type and category, and flag
 * redundant overrides and copies from outside its own line.
 */
async function scanOperations(
	run: HealthRun,
	node: Node,
	chain: string[],
	tokens: TokenMap,
	entry: HealthNode,
): Promise<void> {
	const parent = node.parentId ? await run.resolve(node.parentId) : undefined;
	const inherited = typeof parent === 'string' ? undefined : parent;
	const ancestors = new Set(chain);
	const borrows = new Map<string, HealthNode['coupling']['borrows'][number]>();
	const { customizations } = entry;
	const operations = await run.context.db.getOperations(node.id);
	entry.flags.push(...inertResets(node, chain, operations));

	for (const op of effectiveOperations(operations)) {
		const target = operationTarget(op);
		const own = tokens.get(target);
		const from = inherited?.get(target);
		const category = (own ?? from)?.metadata.category ?? 'custom';
		customizations[op.type] += 1;
		customizations.total += 1;
		customizations.byCategory[category] = (customizations.byCategory[category] ?? 0) + 1;

		const redundant = redundantOverride(node.id, op, own, from);
		if (redundant) entry.flags.push(redundant);

		if (op.type !== 'copy' || !op.fromNode) continue;
		let borrow = borrows.get(op.fromNode);
		if (!borrow) {
			const relation = await relationTo(run, node.id, ancestors, op.fromNode);
			borrow = { fromNode: op.fromNode, relation, tokens: [] };
			borrows.set(op.fromNode, borrow);
		}
		borrow.tokens.push(target);
		if (borrow.relation === 'sibling') {
			entry.flags.push({
				kind: 'sibling-borrow',
				message: `Borrows ${target} from sibling ${op.fromNode}: a change there silently changes this node`,
				tokenId: target,
				fromNode: op.fromNode,
			});
		}
	}
	entry.coupling.borrows = [...borrows.values()];
}

/**
 * A deprecated node's sunset date and replacement, with flags for a date and no
 * replacement and for a replacement that is deprecated or gone. Usage and the
 * past-sunset flag need the whole report, so rollUp fills them in.
 */
async function planDeprecation(run: HealthRun, node: Node, entry: HealthNode): Promise<void> {
	const sunsetAt = node.sunsetAt ?? null;
	const replacedBy = node.replacedBy ?? null;
	if (node.status !== 'deprecated' && !sunsetAt && !replacedBy) return;
	const replacement = replacedBy ? await run.context.db.getNode(replacedBy) : null;
	const available = replacement && !replacement.deletedAt ? replacement : null;
	entry.deprecation = {
		sunsetAt,
		daysLeft: sunsetAt ? daysUntil(sunsetAt, run.now) : null,
		replacedBy,
		replacementStatus: available?.status ?? null,
		usage: { descendants: 0, borrowers: 0 },
	};
	if (sunsetAt && !replacedBy) {
		entry.flags.push({
			kind: 'sunset-without-replacement',
			message: `Goes away on ${sunsetAt}, but no node replaces it`,
			sunsetAt,
		});
	}
	if (replacedBy && available?.status !== 'active' && available?.status !== 'experimental') {
		entry.flags.push({
			kind: 'replacement-deprecated',
			message: available
				? `Replaced by ${replacedBy}, which is itself deprecated`
				: `Replaced by ${replacedBy}, which no longer exists`,
			replacedBy,
		});
	}
}

async function describeNode(run: HealthRun, node: Node): Promise<HealthNode> {
	const chain = await run.context.db.getAncestryChain(node.id);
	const baselineId = baselineFor(run, node, chain);
	const children = run.childrenOf.get(node.id) ?? [];
	const entry: HealthNode = {
		id: node.id,
		name: node.name,
		type: node.type,
		status: node.status,
		parentId: node.parentId,
		depth: chain.length,
		...(node.owner ? { owner: node.owner } : {}),
		tokens: 0,
		customizations: {
			total: 0,
			add: 0,
			override: 0,
			subtract: 0,
			reset: 0,
			copy: 0,
			byCategory: {},
		},
		drift: { baseline: baselineId, compared: 0, changed: 0, added: 0, removed: 0, ratio: 0 },
		coupling: { includes: node.includes ?? [], borrows: [], borrowedBy: [] },
		flags: [],
		subtree: { nodes: 1, customizations: 0, violations: 0, maxDrift: 0 },
	};

	if (node.status === 'deprecated' && children.length > 0) {
		entry.flags.push({
			kind: 'deprecated-with-children',
			message: `Deprecated but still has ${children.length} child node(s): ${children.join(', ')}`,
			children,
		});
	}
	await planDeprecation(run, node, entry);

	const tokens = await run.resolve(node.id);
	if (typeof tokens === 'string') {
		entry.error = tokens;
		return entry;
	}
	entry.tokens = tokens.size;

	const baseline = baselineId ? await run.resolve(baselineId) : undefined;
	if (baseline && typeof baseline !== 'string') {
		entry.drift = { baseline: baselineId, ...compareTokenMaps(tokens, baseline) };
	}

	await scanOperations(run, node, chain, tokens, entry);

	if (run.includeViolations) {
		const found = await nodeViolations(run.context, node, undefined);
		if (found) {
			const count = (severity: string) =>
				found.filter((violation) => violation.severity === severity).length;
			entry.violations = {
				total: found.length,
				error: count('error'),
				warning: count('warning'),
				info: count('info'),
			};
		}
	}
	return entry;
}

/**
 * Fill in who borrows from each node and each node's subtree totals. Expects
 * depth-first order, so every child follows its parent.
 */
function rollUp(nodes: HealthNode[]): void {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	for (const node of nodes) {
		for (const borrow of node.coupling.borrows) {
			byId.get(borrow.fromNode)?.coupling.borrowedBy.push(node.id);
		}
		node.subtree = {
			nodes: 1,
			customizations: node.customizations.total,
			violations: node.violations?.total ?? 0,
			maxDrift: node.drift.ratio,
		};
	}
	for (const node of [...nodes].reverse()) {
		const parent = node.parentId ? byId.get(node.parentId) : undefined;
		if (!parent) continue;
		parent.subtree.nodes += node.subtree.nodes;
		parent.subtree.customizations += node.subtree.customizations;
		parent.subtree.violations += node.subtree.violations;
		parent.subtree.maxDrift = Math.max(parent.subtree.maxDrift, node.subtree.maxDrift);
	}
	for (const node of nodes) {
		const plan = node.deprecation;
		if (!plan) continue;
		plan.usage = {
			descendants: node.subtree.nodes - 1,
			borrowers: node.coupling.borrowedBy.length,
		};
		if (plan.sunsetAt && plan.daysLeft !== null && plan.daysLeft < 0) {
			const users = [
				plan.usage.descendants > 0 ? `${plan.usage.descendants} descendant(s)` : '',
				plan.usage.borrowers > 0 ? `${plan.usage.borrowers} borrower(s)` : '',
			].filter(Boolean);
			node.flags.push({
				kind: 'past-sunset',
				message: `Was due to go away on ${plan.sunsetAt} (${-plan.daysLeft} day(s) ago)${
					users.length > 0 ? ` and still has ${users.join(' and ')}` : ''
				}`,
				sunsetAt: plan.sunsetAt,
				...(plan.replacedBy ? { replacedBy: plan.replacedBy } : {}),
			});
		}
	}
}

const SORT_KEYS: Record<Exclude<Output['sort'], 'tree'>, (node: HealthNode) => number[]> = {
	drift: (node) => [node.drift.ratio],
	violations: (node) => [
		node.violations?.error ?? 0,
		node.violations?.warning ?? 0,
		node.violations?.info ?? 0,
	],
	customizations: (node) => [node.customizations.total],
};

/** Highest first; ties keep tree order */
function sortNodes(nodes: HealthNode[], sort: Output['sort']): HealthNode[] {
	if (sort === 'tree') return nodes;
	const key = SORT_KEYS[sort as keyof typeof SORT_KEYS];
	const order = new Map(nodes.map((node, index) => [node.id, index]));
	return [...nodes].sort((a, b) => {
		const left = key(a);
		const right = key(b);
		for (let i = 0; i < left.length; i++) {
			if (left[i] !== right[i]) return right[i] - left[i];
		}
		return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
	});
}

function summarize(
	nodes: HealthNode[],
	includeViolations: boolean,
): Omit<Output['summary'], 'unresolved'> {
	const flags = nodes.flatMap((node) => node.flags);
	const countFlags = (kind: HealthFlag['kind']) =>
		flags.filter((flag) => flag.kind === kind).length;

	const owners = new Map<string | null, Output['summary']['owners'][number]>();
	for (const node of nodes) {
		const owner = node.owner ?? null;
		const entry = owners.get(owner) ?? { owner, nodes: 0, customizations: 0, violations: 0 };
		entry.nodes += 1;
		entry.customizations += node.customizations.total;
		entry.violations += node.violations?.total ?? 0;
		owners.set(owner, entry);
	}

	const sum = (pick: (node: HealthNode) => number) =>
		nodes.reduce((total, node) => total + pick(node), 0);
	return {
		nodes: nodes.length,
		customizations: sum((node) => node.customizations.total),
		...(includeViolations
			? {
					violations: {
						total: sum((node) => node.violations?.total ?? 0),
						error: sum((node) => node.violations?.error ?? 0),
						warning: sum((node) => node.violations?.warning ?? 0),
						info: sum((node) => node.violations?.info ?? 0),
					},
				}
			: {}),
		flags: {
			redundantOverrides: countFlags('redundant-override'),
			siblingBorrows: countFlags('sibling-borrow'),
			deprecatedWithChildren: countFlags('deprecated-with-children'),
			inertResets: countFlags('inert-reset'),
			sunsetWithoutReplacement: countFlags('sunset-without-replacement'),
			replacementDeprecated: countFlags('replacement-deprecated'),
			pastSunset: countFlags('past-sunset'),
		},
		sunsets: nodes
			.flatMap((node) => {
				const plan = node.deprecation;
				if (!plan?.sunsetAt || plan.daysLeft === null) return [];
				return [
					{
						id: node.id,
						sunsetAt: plan.sunsetAt,
						daysLeft: plan.daysLeft,
						replacedBy: plan.replacedBy,
						descendants: plan.usage.descendants,
						borrowers: plan.usage.borrowers,
					},
				];
			})
			.sort((a, b) => a.sunsetAt.localeCompare(b.sunsetAt) || a.id.localeCompare(b.id)),
		flagged: nodes.filter((node) => node.flags.length > 0).length,
		// Unowned nodes last
		owners: [...owners.values()].sort((a, b) =>
			a.owner === null ? 1 : b.owner === null ? -1 : a.owner.localeCompare(b.owner),
		),
	};
}

function describeRun(output: Output): string {
	const { summary } = output;
	const top = output.nodes.reduce<HealthNode | undefined>(
		(best, node) => (!best || node.drift.ratio > best.drift.ratio ? node : best),
		undefined,
	);
	const flags = Object.values(summary.flags).reduce((total, n) => total + n, 0);
	return [
		`${summary.nodes} node(s) against baseline '${output.baseline}'`,
		top && top.drift.ratio > 0
			? `most drift: ${top.id} (${Math.round(top.drift.ratio * 100)}%)`
			: null,
		summary.violations ? `${summary.violations.total} violation(s)` : null,
		`${flags} flag(s) on ${summary.flagged} node(s)`,
		summary.sunsets.length > 0
			? `next sunset: ${summary.sunsets[0].id} on ${summary.sunsets[0].sunsetAt}`
			: null,
		summary.unresolved.length > 0
			? `${summary.unresolved.length} node(s) could not be resolved`
			: null,
	]
		.filter(Boolean)
		.join('; ');
}

/**
 * analyze.health command
 *
 * One report for "which products drift most, where do violations cluster, who
 * owns what, and which links are risky": per node, its own customizations by
 * category, drift against a baseline, violations by severity, owner, status and
 * coupling (mix-ins and copies), with flags for redundant overrides, sibling
 * borrows and deprecated nodes that still have children, and totals for each
 * node's subtree. Deprecated nodes also report their plan (sunset date and
 * replacement) and usage, with flags for a date without a replacement, a
 * replacement that is deprecated or gone, and a node kept past its sunset.
 */
export const analyzeHealthCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.health',
	description:
		'Health report per node: customizations by category, drift against a baseline, violations, owner, status, deprecation plans, coupling and risk flags',
	category: 'analyze',
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

		const resolve = createResolver(db);
		if (input.baseline !== 'parent' && input.baseline !== 'root') {
			const node = await db.getNode(input.baseline);
			if (!node || node.deletedAt) {
				return failure({
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Baseline node '${input.baseline}' not found`,
					suggestion: `Use 'parent', 'root', or a node id from 'node.list'`,
				});
			}
			const baseline = await resolve(input.baseline);
			if (typeof baseline === 'string') {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: `Baseline node '${input.baseline}' could not be resolved: ${baseline}`,
					suggestion: 'Fix the copy/include cycle, or choose another baseline',
				});
			}
		}

		const scopeIds = new Set(scope.map((node) => node.id));
		const childrenOf = new Map<string, string[]>();
		for (const node of scope) {
			if (node.parentId && scopeIds.has(node.parentId)) {
				childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node.id]);
			}
		}

		const run: HealthRun = {
			context,
			resolve,
			baseline: input.baseline,
			includeViolations: input.includeViolations,
			childrenOf,
			now: Date.now(),
		};
		const nodes: HealthNode[] = [];
		for (const node of scope) {
			nodes.push(await describeNode(run, node));
		}
		rollUp(nodes);

		const output: Output = {
			baseline: input.baseline,
			sort: input.sort,
			nodes: sortNodes(nodes, input.sort),
			summary: {
				...summarize(nodes, input.includeViolations),
				unresolved: nodes.filter((node) => node.error).map((node) => node.id),
			},
		};
		return success(output, { reasoning: describeRun(output) });
	},

	examples: [
		{
			description: 'Health of every node, drift against each parent',
			input: {},
		},
		{
			description: 'The office subtree ranked by drift from the root',
			input: { rootId: 'office', baseline: 'root', sort: 'drift' },
		},
		{
			description: 'How far every node strays from a reference product, without constraint checks',
			input: { baseline: 'office', includeViolations: false },
		},
	],
};
