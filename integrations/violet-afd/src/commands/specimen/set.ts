import {
	SPECIMEN_COMPONENTS,
	SPECIMEN_ROLES,
	specimenRoleDeclaration,
} from '@lushly-dev/violet-core/css';
import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import { type SpecimenMap, SpecimenMapSchema } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, type Warning, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { KNOWN_COMPONENTS, KNOWN_ROLES, treeRootOf, treeTokenIds } from './shared.js';

/**
 * Input schema for specimen.set command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1), // Any node; the map is stored on the root of its tree
	/** `{ component: { role: tokenId } }`; a null token removes the role (and an empty component) */
	map: z.record(z.string(), z.record(z.string(), z.string().min(1).nullable())),
	/** Replace the stored map instead of merging into it */
	replace: z.boolean().optional().default(false),
});

/**
 * Output schema for specimen.set command
 */
const OutputSchema = z.object({
	rootId: z.string(),
	/** The map now stored; empty when it was removed */
	map: SpecimenMapSchema,
	/** Roles whose token changed, as `component.role` */
	changed: z.array(z.string()),
	updatedAt: z.string().nullable(),
});

type Output = z.infer<typeof OutputSchema>;

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** The stored map with `changes` applied; null entries remove roles */
function applyChanges(
	stored: SpecimenMap,
	changes: Record<string, Record<string, string | null>>,
	replace: boolean,
): SpecimenMap {
	const next: SpecimenMap = replace ? {} : structuredClone(stored);
	for (const [component, roles] of Object.entries(changes)) {
		const entry = { ...(next[component] ?? {}) };
		for (const [role, tokenId] of Object.entries(roles)) {
			if (tokenId === null) delete entry[role];
			else entry[role] = tokenId;
		}
		if (Object.keys(entry).length > 0) next[component] = entry;
		else delete next[component];
	}
	return next;
}

/** `component.role` for every role whose token differs between two maps */
function changedRoles(before: SpecimenMap, after: SpecimenMap): string[] {
	const keys = new Set<string>();
	for (const map of [before, after]) {
		for (const [component, roles] of Object.entries(map)) {
			for (const role of Object.keys(roles)) keys.add(`${component}.${role}`);
		}
	}
	return [...keys]
		.filter((key) => {
			const [component, ...rest] = key.split('.');
			const role = rest.join('.');
			return before[component]?.[role] !== after[component]?.[role];
		})
		.sort();
}

/**
 * specimen.set command
 *
 * Store which token draws each role of each component specimen, for systems
 * whose component tokens are not named `<component>.<role>` (#118). The map is
 * kept once per tree, on its root. Components and roles must be ones the
 * Specimens view draws, and every token must be defined in the tree.
 */
export const specimenSetCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'specimen.set',
	description:
		"Store which tokens draw each component specimen's roles, on the root of a node's tree",
	category: 'specimen',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;
		const input = InputSchema.parse(rawInput);

		const tree = await treeRootOf(db, input.nodeId);
		if (!tree) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		const unknownComponents = Object.keys(input.map).filter(
			(component) => !has(SPECIMEN_COMPONENTS, component),
		);
		if (unknownComponents.length > 0) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Unknown component(s): ${unknownComponents.join(', ')}`,
				suggestion: `Map one of: ${KNOWN_COMPONENTS.join(', ')}`,
			});
		}
		const unknownRoles = Object.entries(input.map).flatMap(([component, roles]) =>
			Object.keys(roles)
				.filter((role) => !has(SPECIMEN_ROLES, role))
				.map((role) => `${component}.${role}`),
		);
		if (unknownRoles.length > 0) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Unknown role(s): ${unknownRoles.join(', ')}`,
				suggestion: `Roles are: ${KNOWN_ROLES.join(', ')}`,
			});
		}

		const known = await treeTokenIds(db, tree.rootId);
		const unknownTokens = Object.entries(input.map).flatMap(([component, roles]) =>
			Object.entries(roles)
				.filter(([, tokenId]) => tokenId !== null && !known.has(tokenId))
				.map(([role, tokenId]) => `${component}.${role} → ${tokenId}`),
		);
		if (unknownTokens.length > 0) {
			return failure({
				code: ErrorCodes.TOKEN_NOT_FOUND,
				message: `No token with these ids in the '${tree.rootId}' tree: ${unknownTokens.join(', ')}`,
				suggestion: `Use 'tokens.catalog' to find the token ids defined in the tree`,
			});
		}

		const stored = await db.getSpecimenMap(tree.rootId);
		const before = stored?.map ?? {};
		const after = applyChanges(before, input.map, input.replace);
		const changed = changedRoles(before, after);
		if (changed.length === 0) {
			return success(
				{ rootId: tree.rootId, map: before, changed, updatedAt: stored?.updatedAt ?? null },
				{ reasoning: 'No changes to the specimen map' },
			);
		}

		// A mapped value that fails its validator on the root is drawn nowhere it is inherited
		const warnings: Warning[] = [];
		try {
			const tokens = await resolveNodeTokenMap(db, tree.rootId);
			for (const [component, roles] of Object.entries(after)) {
				for (const [role, tokenId] of Object.entries(roles)) {
					const token = tokens.get(tokenId);
					if (token && specimenRoleDeclaration(role, token.resolvedValue) === null) {
						warnings.push({
							code: 'ROLE_VALUE_INVALID',
							message: `${tokenId} (${String(token.resolvedValue)}) is not a valid ${role} on '${tree.rootId}', so ${component}.${role} is not drawn there`,
							severity: 'warning',
							details: { component, role, tokenId },
						});
					}
				}
			}
		} catch (error) {
			if (!(error instanceof InheritanceResolutionError)) throw error;
		}

		const now = new Date().toISOString();
		const empty = Object.keys(after).length === 0;
		await db.setSpecimenMap(
			tree.rootId,
			empty ? null : { rootId: tree.rootId, map: after, updatedAt: now, updatedBy: actor ?? null },
		);
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'specimen_map_updated',
			actor: actor || 'system',
			targetNode: tree.rootId,
			targetToken: null,
			oldValue: stored ? JSON.stringify(before) : null,
			newValue: empty ? null : JSON.stringify(after),
			metadata: JSON.stringify({ changed }),
		});

		return success(
			{ rootId: tree.rootId, map: after, changed, updatedAt: empty ? null : now },
			{
				reasoning: empty
					? `Removed the specimen map from '${tree.rootId}'; specimens use the naming convention`
					: `Stored the specimen map on '${tree.rootId}': ${changed.length} role(s) changed`,
				sources: [{ type: 'node', id: tree.rootId, title: tree.rootId }],
				...(warnings.length > 0 ? { warnings } : {}),
			},
		);
	},

	examples: [
		{
			description: 'Draw the button from tokens named btn.*',
			input: {
				nodeId: 'global',
				map: { button: { background: 'btn.bg', foreground: 'btn.fg', radius: 'btn.corner' } },
			},
		},
		{
			description: 'Go back to the naming convention for the button border',
			input: { nodeId: 'global', map: { button: { border: null } } },
		},
		{
			description: 'Remove the whole map',
			input: { nodeId: 'global', map: {}, replace: true },
		},
	],
};
