/**
 * @fileoverview A manifest command as a registry's definition (phase 1 specification, 9.1): the
 * manifest is the single source of its metadata (D59), and the handler is lazy.
 */

import type { CommandContext, CommandResult, JsonSchema } from '@lushly-dev/afd-core';
import {
	defineCommand,
	type ExposeOptions,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import { deriveMutation } from '@lushly-dev/loam-manifest/validate';
import { fromJSONSchema } from 'zod';

export type ManifestCommand = NonNullable<ManifestV2['commands']>[number];

type JsonSchemaInput = Parameters<typeof fromJSONSchema>[0];

/** `tool_meta.ui.visibility`, when the manifest says who may see the command (6.2). */
export function visibilityOf(command: ManifestCommand): readonly string[] | undefined {
	const ui = command.tool_meta?.ui as { visibility?: unknown } | undefined;
	return Array.isArray(ui?.visibility) ? (ui.visibility as string[]) : undefined;
}

/** A flag left out takes AFD's default; a command hidden from the model is not the agent's (6.2). */
function exposureOf(command: ManifestCommand): ExposeOptions | undefined {
	const visibility = visibilityOf(command);
	const hidden = visibility !== undefined && !visibility.includes('model');
	if (!hidden) return command.expose;
	return { ...command.expose, agent: false };
}

/**
 * Build one definition.
 *
 * @throws When `z.fromJSONSchema` cannot express a schema, or an example does not match it. The reader
 *   checks a manifest's schemas first, so this is the last line, and the loader refuses the app.
 */
export function defineAppCommand(
	command: ManifestCommand,
	appVersion: string,
	handler: (input: unknown, context: CommandContext) => Promise<CommandResult>
): ZodCommandDefinition {
	const schema = command.input_schema as Record<string, unknown>;
	const expose = exposureOf(command);
	return defineCommand({
		name: command.name,
		description: command.description,
		version: command.version ?? appVersion,
		mutation: deriveMutation(command.effects),
		input: fromJSONSchema(schema as JsonSchemaInput),
		advertisedInputSchema: command.input_schema as unknown as JsonSchema,
		...(command.title !== undefined ? { title: command.title } : {}),
		...(command.category !== undefined ? { category: command.category } : {}),
		...(command.tags !== undefined ? { tags: command.tags } : {}),
		...(command.requires !== undefined ? { requires: command.requires } : {}),
		...(command.undoable !== undefined ? { undoable: command.undoable } : {}),
		...(command.destructive !== undefined ? { destructive: command.destructive } : {}),
		...(command.errors !== undefined ? { errors: command.errors } : {}),
		...(command.examples !== undefined ? { examples: command.examples } : {}),
		...(command.contexts !== undefined ? { contexts: command.contexts } : {}),
		...(command.tool_meta !== undefined ? { toolMeta: command.tool_meta } : {}),
		...(command.execution_time !== undefined ? { executionTime: command.execution_time } : {}),
		...(command.returns !== undefined
			? { output: fromJSONSchema(command.returns as JsonSchemaInput) }
			: {}),
		...(expose !== undefined ? { expose } : {}),
		handler,
	}) as unknown as ZodCommandDefinition;
}
