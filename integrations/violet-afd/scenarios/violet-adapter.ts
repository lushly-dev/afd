/**
 * @fileoverview JTBD scenario fixture adapter for `app: 'violet'`.
 *
 * Seeds nodes, tokens (choosing `token.add` vs `token.override` from the fixture's
 * node ancestry so child overrides never emit a failing command), and constraints
 * through Violet's own commands.
 */

import type {
	AdapterContext,
	AppAdapter,
	AppliedCommand,
	ApplyFixtureResult,
	FixtureValidationResult,
} from '@lushly-dev/afd-testing';
import {
	ConstraintSchema,
	ErrorCodes,
	IncludePolicySchema,
	NodeTypeSchema,
	TokenCategorySchema,
	TokenMetadataSchema,
	TokenTierSchema,
	TokenValueSchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { registry } from '../src/commands/registry.js';

const FixtureNodeSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).optional(),
	type: NodeTypeSchema.optional(),
	parentId: z.string().min(1).nullable().optional(),
	includes: z.array(z.string().min(1)).optional(),
	includePolicy: IncludePolicySchema.optional(),
	owner: z.string().optional(),
});

const FixtureTokenSchema = z.object({
	value: TokenValueSchema,
	tier: TokenTierSchema.optional(),
	category: TokenCategorySchema.optional(),
	type: z.string().optional(),
	description: z.string().optional(),
	metadata: TokenMetadataSchema.partial().optional(),
	reason: z.string().optional(),
});

export const VioletFixtureSchema = z.object({
	app: z.literal('violet'),
	version: z.string().optional(),
	description: z.string().optional(),
	nodes: z.array(FixtureNodeSchema).default([]),
	tokens: z.record(z.string().min(1), z.record(z.string().min(1), FixtureTokenSchema)).default({}),
	constraints: z.record(z.string().min(1), z.array(ConstraintSchema)).default({}),
});

export type VioletFixture = z.infer<typeof VioletFixtureSchema>;

function hasTokenInAncestry(
	nodeId: string,
	tokenId: string,
	parentOf: Map<string, string | null>,
	definedByNode: Map<string, Set<string>>,
): boolean {
	const visited = new Set<string>();
	let current: string | null | undefined = nodeId;
	while (current && !visited.has(current)) {
		visited.add(current);
		if (definedByNode.get(current)?.has(tokenId)) {
			return true;
		}
		current = parentOf.get(current) ?? null;
	}
	return false;
}

function buildTokenMetadata(
	entry: z.infer<typeof FixtureTokenSchema>,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {
		...(entry.metadata ?? {}),
		...(entry.tier !== undefined ? { tier: entry.tier } : {}),
		...(entry.category !== undefined ? { category: entry.category } : {}),
		...(entry.type !== undefined ? { type: entry.type } : {}),
		...(entry.description !== undefined ? { description: entry.description } : {}),
	};
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function orderTokenNodeIds(nodes: VioletFixture['nodes'], tokenNodeIds: string[]): string[] {
	const parentOf = new Map(nodes.map((node) => [node.id, node.parentId ?? null]));
	const orderedNodes: string[] = [];
	const visited = new Set<string>();
	const visiting = new Set<string>();

	const visit = (id: string) => {
		if (visited.has(id) || visiting.has(id)) return;
		visiting.add(id);
		const parentId = parentOf.get(id);
		if (parentId && parentOf.has(parentId)) {
			visit(parentId);
		}
		visiting.delete(id);
		visited.add(id);
		orderedNodes.push(id);
	};

	for (const node of nodes) {
		visit(node.id);
	}

	const tokenSet = new Set(tokenNodeIds);
	const ordered = orderedNodes.filter((id) => tokenSet.has(id));
	const seen = new Set(ordered);
	for (const id of tokenNodeIds) {
		if (!seen.has(id)) {
			ordered.push(id);
		}
	}
	return ordered;
}

export interface CreateVioletAdapterOptions {
	/** Optional reset hook invoked by `fixture.reset` (e.g. to swap in a fresh MemoryDatabase). */
	onReset?: (context: AdapterContext) => Promise<void> | void;
}

/**
 * Create a Violet `AppAdapter` for `@lushly-dev/afd-testing`'s `registerAdapter()`.
 */
export function createVioletAdapter(options: CreateVioletAdapterOptions = {}): AppAdapter {
	return {
		name: 'violet',
		version: '1.0.0',
		cli: {
			command: 'violet',
			inputFormat: 'json-arg',
			outputFormat: 'json',
		},
		fixture: {
			async validate(rawFixture: unknown): Promise<FixtureValidationResult> {
				const parsed = VioletFixtureSchema.safeParse(rawFixture);
				if (parsed.success) {
					return { valid: true };
				}
				return {
					valid: false,
					errors: parsed.error.issues.map(
						(issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
					),
				};
			},

			async apply(rawFixture: unknown, context: AdapterContext): Promise<ApplyFixtureResult> {
				if (!context.handler) {
					throw new Error('Violet fixture adapter requires an in-process command handler');
				}
				const fixture = VioletFixtureSchema.parse(rawFixture);
				const appliedCommands: AppliedCommand[] = [];
				const parentOf = new Map<string, string | null>();
				const definedByNode = new Map<string, Set<string>>();

				const run = async (command: string, input: Record<string, unknown>) => {
					const result = await context.handler!(command, input);
					appliedCommands.push({ command, input, result });
					if (!result.success) {
						const detail = result.error
							? `${result.error.code}: ${result.error.message}`
							: 'command failed';
						throw new Error(`Violet fixture step '${command}' failed: ${detail}`);
					}
					return result;
				};

				for (const node of fixture.nodes) {
					const parentId = node.parentId ?? null;
					parentOf.set(node.id, parentId);
					await run('node.create', {
						id: node.id,
						name: node.name ?? node.id,
						type: node.type ?? 'custom',
						parentId,
						...(node.includes ? { includes: node.includes } : {}),
						...(node.includePolicy ? { includePolicy: node.includePolicy } : {}),
						...(node.owner ? { owner: node.owner } : {}),
					});
				}

				const orderedTokenNodes = orderTokenNodeIds(fixture.nodes, Object.keys(fixture.tokens));
				for (const nodeId of orderedTokenNodes) {
					const tokenEntries = fixture.tokens[nodeId] ?? {};
					let defined = definedByNode.get(nodeId);
					if (!defined) {
						defined = new Set<string>();
						definedByNode.set(nodeId, defined);
					}
					for (const [tokenId, entry] of Object.entries(tokenEntries)) {
						if (hasTokenInAncestry(nodeId, tokenId, parentOf, definedByNode)) {
							await run('token.override', {
								nodeId,
								tokenId,
								value: entry.value,
								...(entry.reason !== undefined ? { reason: entry.reason } : {}),
							});
						} else {
							const metadata = buildTokenMetadata(entry);
							await run('token.add', {
								nodeId,
								tokenId,
								value: entry.value,
								...(metadata ? { metadata } : {}),
								...(entry.reason !== undefined ? { reason: entry.reason } : {}),
							});
						}
						defined.add(tokenId);
					}
				}

				for (const [nodeId, constraints] of Object.entries(fixture.constraints)) {
					await run('constraints.set', {
						nodeId,
						constraints,
						merge: false,
					});
				}

				return { appliedCommands };
			},

			async reset(context: AdapterContext): Promise<void> {
				await options.onReset?.(context);
			},
		},
		commands: {
			list: () => registry.list().map((command) => command.name),
			getDescription: (name) => registry.get(name)?.description ?? name,
		},
		errors: {
			list: () => Object.values(ErrorCodes),
		},
		jobs: {
			list: () => [],
		},
	};
}

/** Default Violet adapter instance (`app: 'violet'`). */
export const violetAdapter: AppAdapter = createVioletAdapter();
