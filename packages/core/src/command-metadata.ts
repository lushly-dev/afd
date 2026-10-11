/** Shared MCP metadata reporting rules for command definitions and server tools. */
import type { CommandDefinition, JsonSchema } from './commands.js';

type MetadataFields = Pick<
	CommandDefinition,
	'category' | 'requires' | 'mutation' | 'destructive' | 'undoable' | 'examples' | 'contexts'
>;

/** Per-command planning metadata; display-only confirmPrompt is intentionally absent. */
export type CommandToolMeta = MetadataFields & {
	// A mapped object retains schema field types and is structurally compatible with
	// MCP's existing Record<string, unknown> metadata contract.
	outputSchema?: { [Key in keyof JsonSchema]: JsonSchema[Key] };
};

/** Omit unset fields and empty arrays, while preserving explicitly set false booleans. */
export function commandToolMeta(
	command: MetadataFields,
	outputSchema?: JsonSchema
): CommandToolMeta | undefined {
	const meta: CommandToolMeta = {
		...(command.category != null && { category: command.category }),
		...(command.requires?.length && { requires: command.requires }),
		...(command.mutation != null && { mutation: command.mutation }),
		...(command.destructive != null && { destructive: command.destructive }),
		...(command.undoable != null && { undoable: command.undoable }),
		...(command.examples?.length && { examples: command.examples }),
		...(outputSchema && { outputSchema: { ...outputSchema } }),
		...(command.contexts?.length && { contexts: command.contexts }),
	};
	return Object.keys(meta).length > 0 ? meta : undefined;
}
