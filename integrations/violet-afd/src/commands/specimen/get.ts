import {
	SPECIMEN_COMPONENTS,
	SPECIMEN_REQUIRED_ROLE,
	SPECIMEN_ROLE_NAMES,
	conventionToken,
	specimenRoleDeclaration,
} from '@lushly-dev/violet-core/css';
import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import { SpecimenMapSchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { treeRootOf } from './shared.js';

/**
 * Input schema for specimen.get command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1), // Any node; the map is read from the root of its tree
});

const RoleSchema = z.object({
	role: z.string(),
	/** The token that draws the role on this node */
	tokenId: z.string(),
	/** From the stored map, or the `<component>.<role>` naming convention */
	source: z.enum(['map', 'convention']),
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
	/** Every component the Specimens view draws, with each role on this node */
	components: z.array(
		z.object({
			component: z.string(),
			label: z.string(),
			/** Drawn on this node: its background role resolves to a valid colour */
			drawn: z.boolean(),
			roles: z.array(RoleSchema),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * specimen.get command
 *
 * The specimen role map of a node's tree (#118) and, for each component the
 * Specimens view draws, which token draws each role on the node, whether it
 * resolves there, and whether its value passes the role's CSS validator.
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
		const components = Object.entries(SPECIMEN_COMPONENTS).map(([component, { label }]) => {
			const roles = SPECIMEN_ROLE_NAMES.map((role) => {
				const mapped = map[component]?.[role];
				const tokenId = mapped ?? conventionToken(component, role);
				const token = tokens.get(tokenId);
				const value = token?.resolvedValue;
				return {
					role,
					tokenId,
					source: mapped ? ('map' as const) : ('convention' as const),
					resolves: Boolean(token),
					valid: value !== undefined && specimenRoleDeclaration(role, value) !== null,
					...(value !== undefined ? { value } : {}),
				};
			});
			const drawn = roles.some((entry) => entry.role === SPECIMEN_REQUIRED_ROLE && entry.valid);
			return { component, label, drawn, roles };
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
				components,
			},
			{
				reasoning: `${record ? `Stored map on '${tree.rootId}'` : `No stored map on '${tree.rootId}', so the naming convention`}; ${
					drawn.length > 0 ? `draws ${drawn.join(', ')}` : 'draws no component'
				} on '${input.nodeId}'`,
			},
		);
	},

	examples: [
		{ description: 'Which component roles draw on xbox-dark', input: { nodeId: 'xbox-dark' } },
	],
};
