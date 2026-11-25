import type { CssValueMetadata } from '@lushly-dev/violet-core/css';
import { resolveNodeTokenMap, validateTokenId } from '@lushly-dev/violet-core/engine';
import {
	type Constraint,
	ConstraintSchema,
	ContrastConfigSchema,
	EnumConfigSchema,
	IncludePolicySchema,
	NodeTypeSchema,
	PatternConfigSchema,
	RampConfigSchema,
	RampPairWithSchema,
	RangeConfigSchema,
	ReferenceConfigSchema,
	ScaleConfigSchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { findDuplicateConstraintIds, validateConstraintSemantics } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import {
	type KnownToken,
	importedTokenType,
	tokenIdSuggestion,
	unsafeImportValues,
	unsafeValueSuggestion,
} from '../value-checks.js';
import { VIOLET_EXTENSION_KEY, flattenTokenFile } from './flatten.js';
import { importJsonCommand } from './json.js';

export { VIOLET_EXTENSION_KEY };

/**
 * Strict constraint schema for DTCG tree files: rejects unrecognized top-level or nested
 * config fields (such as `minimum: 7` instead of `min: 7`) instead of silently stripping them (#2330).
 */
const StrictConstraintConfigSchema = z.discriminatedUnion('type', [
	EnumConfigSchema.strict(),
	RangeConfigSchema.strict(),
	PatternConfigSchema.strict(),
	ScaleConfigSchema.strict(),
	ContrastConfigSchema.strict(),
	ReferenceConfigSchema.strict(),
	RampConfigSchema.extend({ pairWith: RampPairWithSchema.strict().optional() }).strict(),
]);

const StrictConstraintSchema = ConstraintSchema.extend({
	config: StrictConstraintConfigSchema,
}).strict();

/**
 * Node settings read from a file's root `$extensions["dev.lushly.violet"]`
 */
const NodeExtensionSchema = z.object({
	/** Node ID (default: file name without `.tokens.json` / `.json`) */
	node: z.string().min(1).optional(),
	/** Parent node ID (default: none, a root node) */
	parent: z.string().min(1).nullable().optional(),
	type: NodeTypeSchema.optional(),
	includes: z.array(z.string()).optional(),
	/** How included tokens meet the node's own: `merge` (default) or `override` */
	includePolicy: IncludePolicySchema.optional(),
	/** Read top-level global/semantic/component groups as token tiers (see import.json) */
	tiers: z.boolean().optional(),
	/** Design constraints attached to this node (#2330) */
	constraints: z.array(StrictConstraintSchema).optional(),
});

/**
 * Input schema for import.tree command
 */
const InputSchema = z.object({
	/** Token files, one node per file. CLI reads a directory into this list. */
	files: z
		.array(
			z.object({
				/** File name, used as the node ID when the file doesn't set one */
				name: z.string().min(1),
				/** DTCG or Style Dictionary JSON */
				content: z.string().min(1),
			}),
		)
		.min(1),
});

/**
 * Output schema for import.tree command
 */
const OutputSchema = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			parentId: z.string().nullable(),
			file: z.string(),
			tokensImported: z.number(),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

interface PlannedNode {
	id: string;
	parentId: string | null;
	type?: z.infer<typeof NodeTypeSchema>;
	includes: string[];
	includePolicy?: z.infer<typeof IncludePolicySchema>;
	tiers: boolean;
	constraints: Constraint[];
	file: string;
	content: string;
}

/**
 * import.tree command
 *
 * Build a node tree from token files, one node per file. Each file names its
 * node and parent under `$extensions["dev.lushly.violet"]`, so a whole tree can
 * live in a repo and be exported in CI without a persistent database.
 */
export const importTreeCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'import.tree',
	description:
		'Create a node tree from DTCG token files (one node per file, each naming its parent)',
	category: 'import',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);

		try {
			const planned = planNodes(input.files);
			const ordered = await orderNodes(planned, context.db);
			await refuseBeforeWriting(ordered, context);

			const nodes: Output['nodes'] = [];
			for (const node of ordered) {
				nodes.push(await createNodeFromFile(node, context));
			}

			const tokenCount = nodes.reduce((sum, node) => sum + node.tokensImported, 0);
			return success(
				{ nodes },
				{ reasoning: `Created ${nodes.length} nodes with ${tokenCount} tokens from files` },
			);
		} catch (error) {
			if (error instanceof TreeImportError) {
				return failure(error.details);
			}
			throw error;
		}
	},

	examples: [
		{
			description: 'Build a base node and a dark theme that inherits from it',
			input: {
				files: [
					{
						name: 'base.tokens.json',
						content: '{"color": {"$type": "color", "bg": {"$value": "#FFFFFF"}}}',
					},
					{
						name: 'dark.tokens.json',
						content:
							'{"$extensions": {"dev.lushly.violet": {"parent": "base", "type": "theme"}}, "color": {"bg": {"$value": "#111111"}}}',
					},
				],
			},
		},
	],
};

/**
 * Carries a failure out of the import.tree helpers to the handler
 */
class TreeImportError extends Error {
	constructor(readonly details: { code: string; message: string; suggestion?: string }) {
		super(details.message);
	}
}

/**
 * Read each file's node settings, keyed by node ID
 */
function planNodes(files: Array<{ name: string; content: string }>): Map<string, PlannedNode> {
	const planned = new Map<string, PlannedNode>();

	for (const file of files) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(file.content);
		} catch {
			throw new TreeImportError({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Invalid JSON in '${file.name}'`,
				suggestion: 'Ensure each file is valid DTCG or Style Dictionary JSON',
			});
		}

		const rawExtension =
			(parsed as { $extensions?: Record<string, unknown> } | null)?.$extensions?.[
				VIOLET_EXTENSION_KEY
			] ?? {};
		const extension = NodeExtensionSchema.safeParse(rawExtension);
		if (!extension.success) {
			throw new TreeImportError({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Invalid $extensions["${VIOLET_EXTENSION_KEY}"] in '${file.name}': ${extension.error.issues
					.map((issue) => `${issue.path.join('.')} ${issue.message}`)
					.join('; ')}`,
				suggestion:
					'Expected { node?: string, parent?: string, type?: string, includes?: string[], includePolicy?: "merge" | "override", tiers?: boolean, constraints?: Constraint[] }',
			});
		}

		const constraints = extension.data.constraints ?? [];
		if (constraints.length > 0) {
			const duplicateIds = findDuplicateConstraintIds(constraints);
			if (duplicateIds.length > 0) {
				throw new TreeImportError({
					code: ErrorCodes.VALIDATION_ERROR,
					message: `Duplicate constraint IDs in '${file.name}': ${duplicateIds.join(', ')}`,
					suggestion: 'Ensure each constraint in the file has a unique ID',
				});
			}
			const semanticError = validateConstraintSemantics(constraints);
			if (semanticError) {
				throw new TreeImportError({
					code: ErrorCodes.VALIDATION_ERROR,
					message: `Invalid constraints in '${file.name}': ${semanticError.message}`,
					suggestion: semanticError.suggestion,
				});
			}
		}

		const id = extension.data.node ?? nodeIdFromFileName(file.name);
		const existing = planned.get(id);
		if (existing) {
			throw new TreeImportError({
				code: ErrorCodes.NODE_ALREADY_EXISTS,
				message: `Node '${id}' is defined by both '${existing.file}' and '${file.name}'`,
				suggestion: `Give one of the files a different $extensions["${VIOLET_EXTENSION_KEY}"].node`,
			});
		}

		planned.set(id, {
			id,
			parentId: extension.data.parent ?? null,
			type: extension.data.type,
			includes: extension.data.includes ?? [],
			includePolicy: extension.data.includePolicy,
			tiers: extension.data.tiers ?? false,
			constraints,
			file: file.name,
			content: file.content,
		});
	}

	return planned;
}

/**
 * Order nodes so parents and includes are created before the nodes that use them.
 * Dependencies outside the files must already exist in the database.
 */
async function orderNodes(
	planned: Map<string, PlannedNode>,
	db: CommandContext['db'],
): Promise<PlannedNode[]> {
	const ordered: PlannedNode[] = [];
	const visited = new Set<string>();
	const visiting: string[] = [];

	const visit = async (node: PlannedNode): Promise<void> => {
		if (visited.has(node.id)) return;
		if (visiting.includes(node.id)) {
			throw new TreeImportError({
				code: ErrorCodes.CIRCULAR_REFERENCE,
				message: `Circular parent/include chain: ${[...visiting, node.id].join(' -> ')}`,
				suggestion: 'Check the parent and includes set in each file',
			});
		}

		visiting.push(node.id);
		for (const dependencyId of [node.parentId, ...node.includes]) {
			if (!dependencyId) continue;
			const dependency = planned.get(dependencyId);
			if (dependency) {
				await visit(dependency);
			} else if (!(await db.getNode(dependencyId))) {
				throw new TreeImportError({
					code: ErrorCodes.INVALID_PARENT,
					message: `'${node.file}' refers to node '${dependencyId}', which isn't in the files or the database`,
					suggestion: `Add a file for '${dependencyId}' or fix the parent/includes in '${node.file}'`,
				});
			}
		}
		visiting.pop();

		visited.add(node.id);
		ordered.push(node);
	};

	for (const node of planned.values()) {
		await visit(node);
	}
	return ordered;
}

/**
 * Check the whole plan before any node is created, so a later file's failure
 * leaves nothing behind: no planned node may exist yet, and every value must
 * reach CSS safely for the type it will have (#1325). A token a file overrides
 * keeps the type its parent gives it; one it adds over an included token takes
 * the file's `$type`, or the included one's.
 */
async function refuseBeforeWriting(ordered: PlannedNode[], context: CommandContext): Promise<void> {
	for (const node of ordered) {
		if (await context.db.getNode(node.id)) {
			throw new TreeImportError({
				code: ErrorCodes.NODE_ALREADY_EXISTS,
				message: `Node '${node.id}' (from '${node.file}') already exists, so no node was created`,
				suggestion: `Import into an empty database, or delete '${node.id}' with 'node.delete' first`,
			});
		}
	}

	const typesByNode = new Map<string, Map<string, CssValueMetadata | undefined>>();
	const typesOf = async (nodeId: string) =>
		typesByNode.get(nodeId) ?? (await storedTypes(nodeId, context));
	const invalidIds: string[] = [];
	const unsafe: string[] = [];
	for (const node of ordered) {
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(node.content);
		} catch {
			// import.json reports the file as invalid JSON when it reaches it
			typesByNode.set(node.id, new Map());
			continue;
		}
		const inherited = node.parentId === null ? new Map() : await typesOf(node.parentId);
		const included = new Map<string, CssValueMetadata | undefined>();
		for (const id of node.includes)
			for (const [token, type] of await typesOf(id)) included.set(token, type);

		const tokens = flattenTokenFile(parsed, undefined, { tiers: node.tiers });
		for (const token of tokens) {
			const idError = validateTokenId(token.id);
			if (idError) invalidIds.push(`${node.file}: ${idError}`);
		}
		const known = (id: string): KnownToken => ({
			metadata: inherited.has(id) ? inherited.get(id) : included.get(id),
			becomesOverride: inherited.has(id),
		});
		for (const problem of unsafeImportValues(tokens, known))
			unsafe.push(`${node.file}: ${problem}`);

		// Under `override` the included value (and type) wins over the inherited one
		const resolved = new Map(
			node.includePolicy === 'override' ? [...inherited, ...included] : [...included, ...inherited],
		);
		for (const token of tokens) {
			if (!inherited.has(token.id))
				resolved.set(token.id, importedTokenType(token, known(token.id)));
		}
		typesByNode.set(node.id, resolved);
	}
	if (invalidIds.length > 0) {
		throw new TreeImportError({
			code: ErrorCodes.VALIDATION_ERROR,
			message: `${invalidIds.length} token id(s) cannot be imported, so no node was created: ${invalidIds.slice(0, 10).join('; ')}${invalidIds.length > 10 ? '; …' : ''}`,
			suggestion: tokenIdSuggestion,
		});
	}
	if (unsafe.length > 0) {
		throw new TreeImportError({
			code: ErrorCodes.INVALID_TOKEN_VALUE,
			message: `${unsafe.length} value(s) cannot be imported safely, so no node was created: ${unsafe.slice(0, 10).join('; ')}${unsafe.length > 10 ? '; …' : ''}`,
			suggestion: unsafeValueSuggestion,
		});
	}
}

/** The types of the tokens a stored node resolves, for a file whose parent or include is not in the import */
async function storedTypes(
	nodeId: string,
	context: CommandContext,
): Promise<Map<string, CssValueMetadata | undefined>> {
	if (!(await context.db.getNode(nodeId))) return new Map();
	const resolved = await resolveNodeTokenMap(context.db, nodeId);
	return new Map([...resolved].map(([id, token]) => [id, token.metadata]));
}

/**
 * Create one node and import its file's tokens
 */
async function createNodeFromFile(
	node: PlannedNode,
	context: CommandContext,
): Promise<Output['nodes'][number]> {
	const created = await nodeCreateCommand.handler(
		{
			id: node.id,
			name: node.id,
			parentId: node.parentId,
			type: node.type,
			includes: node.includes,
			...(node.includePolicy ? { includePolicy: node.includePolicy } : {}),
		},
		context,
	);
	if (!created.success) {
		throw new TreeImportError({
			code: created.error?.code ?? ErrorCodes.INTERNAL_ERROR,
			message: `Failed to create node from '${node.file}': ${created.error?.message}`,
			suggestion: created.error?.suggestion,
		});
	}

	const imported = await importJsonCommand.handler(
		{ targetNode: node.id, content: node.content, tiers: node.tiers },
		context,
	);
	if (!imported.success || !imported.data) {
		throw new TreeImportError({
			code: imported.error?.code ?? ErrorCodes.INTERNAL_ERROR,
			message: `Failed to import tokens from '${node.file}': ${imported.error?.message}`,
			suggestion: imported.error?.suggestion,
		});
	}
	if (imported.data.errors.length > 0) {
		throw new TreeImportError({
			code: ErrorCodes.VALIDATION_ERROR,
			message: `Invalid tokens in '${node.file}': ${imported.data.errors
				.map((e) => `${e.tokenId} (${e.error})`)
				.join(', ')}`,
			suggestion: 'Fix the token IDs and run again',
		});
	}

	if (node.constraints.length > 0) {
		await context.db.setConstraints(node.id, structuredClone(node.constraints));
	}

	return {
		id: node.id,
		parentId: node.parentId,
		file: node.file,
		tokensImported: imported.data.tokensImported,
	};
}

/**
 * 'themes/vintage-dark.tokens.json' -> 'vintage-dark'
 */
export function nodeIdFromFileName(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? fileName;
	return base.replace(/\.tokens\.json$|\.json$/i, '');
}
