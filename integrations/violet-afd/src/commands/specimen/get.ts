import { specimenRoleDeclaration } from '@lushly-dev/violet-core/css';
import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import { SpecimenMapSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { SPECIMEN_INTERFACE, SPECIMEN_INTERFACE_MAP } from './model.js';
import { treeRootOf } from './shared.js';

/**
 * Input schema for specimen.get command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1), // Any node; the map is read from the root of its tree
});

const RoleSchema = z.object({
	role: z.string(),
	/** The token that draws the role on this node; null when neither the map nor the interface names one */
	tokenId: z.string().nullable(),
	/**
	 * From the stored map; from the components' interface (`interface.json`), when the map
	 * leaves the role out; or `unmapped`, when no interface id carries the role and the map
	 * does not name one
	 */
	source: z.enum(['map', 'interface', 'unmapped']),
	/** The interface token id the component reads for the role, whether or not the map overrides it */
	interfaceTokenId: z.string().nullable(),
	/** The token resolves on the node */
	resolves: z.boolean(),
	/** Its value passes the role's CSS validator, so the role is drawn */
	valid: z.boolean(),
	/** The resolved value, when it resolves */
	value: z.union([z.string(), z.number()]).optional(),
});

/**
 * Output schema for specimen.get command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	/** The root of the node's tree, where the map is stored */
	rootId: z.string(),
	/** The stored map; empty when none is stored */
	map: SpecimenMapSchema,
	stored: z.boolean(),
	updatedAt: z.string().nullable(),
	updatedBy: z.string().nullable(),
	/** The components' token interface the unmapped roles are drawn from */
	interface: z.object({ package: z.string(), contractVersion: z.number() }),
	/** Every component the Specimens view draws, with each role on this node */
	components: z.array(
		z.object({
			component: z.string(),
			label: z.string(),
			/** The violet-elements component the specimen samples, when one draws it on its own */
			element: z.string().nullable(),
			/** The role the specimen cannot be drawn without */
			required: z.string(),
			/** Drawn on this node: its required role resolves to a valid value */
			drawn: z.boolean(),
			roles: z.array(RoleSchema),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * A role on a node: the stored map's token, else the interface id, and whether it
 * resolves there and passes the role's validator
 */
function roleOnNode(
	role: string,
	mapped: string | null,
	interfaceTokenId: string | null,
	tokens: Awaited<ReturnType<typeof resolveNodeTokenMap>>,
): z.infer<typeof RoleSchema> {
	const tokenId = mapped ?? interfaceTokenId;
	const token = tokenId === null ? undefined : tokens.get(tokenId);
	const value = token?.resolvedValue;
	let source: z.infer<typeof RoleSchema>['source'] = 'unmapped';
	if (mapped) source = 'map';
	else if (interfaceTokenId) source = 'interface';
	return {
		role,
		tokenId,
		source,
		interfaceTokenId,
		resolves: Boolean(token),
		valid: value !== undefined && specimenRoleDeclaration(role, value) !== null,
		...(value !== undefined ? { value } : {}),
	};
}

/**
 * specimen.get command
 *
 * The specimen role map of a node's tree (#118) and, for each component the
 * Specimens view draws, which token draws each role on the node (the stored
 * map's, or else the id the component reads from its token interface, #1786),
 * whether it resolves there, and whether its value passes the role's CSS
 * validator.
 */
export const specimenGetCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'specimen.get',
	description:
		"The specimen role map of a node's tree, and which component roles resolve and draw on the node",
	category: 'specimen',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;
		const input = InputSchema.parse(rawInput);

		const tree = await treeRootOf(db, input.nodeId);
		if (!tree) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		let tokens: Awaited<ReturnType<typeof resolveNodeTokenMap>>;
		try {
			tokens = await resolveNodeTokenMap(db, input.nodeId);
		} catch (error) {
			if (!(error instanceof InheritanceResolutionError)) throw error;
			return failure({
				code: ErrorCodes.CIRCULAR_REFERENCE,
				message: `Node '${input.nodeId}' could not be resolved: ${error.message}`,
				suggestion: 'Fix the copy/include cycle, then try again',
			});
		}

		const record = await db.getSpecimenMap(tree.rootId);
		const map = record?.map ?? {};
		const components = Object.entries(SPECIMEN_INTERFACE_MAP).map(([component, specimen]) => {
			const { label, element, required } = specimen;
			const stored = Object.hasOwn(map, component) ? map[component] : {};
			const roles = Object.entries(specimen.roles).map(([role, interfaceTokenId]) =>
				roleOnNode(
					role,
					Object.hasOwn(stored, role) ? stored[role] : null,
					interfaceTokenId,
					tokens,
				),
			);
			const drawn = roles.some((entry) => entry.role === required && entry.valid);
			return { component, label, element, required, drawn, roles };
		});

		const drawn = components.filter((entry) => entry.drawn).map((entry) => entry.component);
		return success(
			{
				nodeId: input.nodeId,
				rootId: tree.rootId,
				map,
				stored: Boolean(record),
				updatedAt: record?.updatedAt ?? null,
				updatedBy: record?.updatedBy ?? null,
				interface: {
					package: SPECIMEN_INTERFACE.package,
					contractVersion: SPECIMEN_INTERFACE.contractVersion,
				},
				components,
			},
			{
				reasoning: `${record ? `Stored map on '${tree.rootId}'` : `No stored map on '${tree.rootId}', so the ${SPECIMEN_INTERFACE.package} interface ids`}; ${
					drawn.length > 0 ? `draws ${drawn.join(', ')}` : 'draws no component'
				} on '${input.nodeId}'`,
			},
		);
	},

	examples: [
		{ description: 'Which component roles draw on xbox-dark', input: { nodeId: 'xbox-dark' } },
	],
};
