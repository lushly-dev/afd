import { NodeTypeSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { importJsonCommand } from './json.js';

/** Key under the root `$extensions` that holds a file's node settings */
export const VIOLET_EXTENSION_KEY = 'dev.lushly.violet';

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
	/** Read top-level global/semantic/component groups as token tiers (see import.json) */
	tiers: z.boolean().optional(),
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
	tiers: boolean;
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
					'Expected { node?: string, parent?: string, type?: string, includes?: string[], tiers?: boolean }',
			});
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
			tiers: extension.data.tiers ?? false,
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
