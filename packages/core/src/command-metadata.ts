/** Shared MCP metadata reporting rules for command definitions and server tools. */
import { type ApprovalDecision, type ApprovalPolicy, approvalMode } from './approval.js';
import type { CommandDefinition, JsonSchema } from './commands.js';

type MetadataFields = Pick<
	CommandDefinition,
	| 'category'
	| 'requires'
	| 'mutation'
	| 'destructive'
	| 'undoable'
	| 'examples'
	| 'contexts'
	| 'toolMeta'
>;

/** Per-command planning metadata; display-only confirmPrompt is intentionally absent. */
export type CommandToolMeta = MetadataFields & {
	/** The approval policy; a function policy is reported as `'conditional'`. */
	approval?: ApprovalDecision | 'conditional';
	// A mapped object retains schema field types and is structurally compatible with
	// MCP's existing Record<string, unknown> metadata contract.
	outputSchema?: { [Key in keyof JsonSchema]: JsonSchema[Key] };
};

/**
 * Omit unset fields and empty arrays, while preserving explicitly set false booleans. The
 * command's extra `toolMeta` entries are emitted beside the server's own.
 */
export function commandToolMeta(
	command: MetadataFields & { approval?: ApprovalPolicy<never> },
	outputSchema?: JsonSchema
): CommandToolMeta | undefined {
	const approval = approvalMode(command.approval);
	// The extra entries come first: the key rule (spec/mcp-resources.md, T2) refuses every key the
	// server sets, so they never collide, and the server's own fields win if one ever did.
	const meta: CommandToolMeta = {
		...(command.toolMeta as CommandToolMeta | undefined),
		...(command.category != null && { category: command.category }),
		...(command.requires?.length && { requires: command.requires }),
		...(command.mutation != null && { mutation: command.mutation }),
		...(command.destructive != null && { destructive: command.destructive }),
		...(command.undoable != null && { undoable: command.undoable }),
		...(approval && { approval }),
		...(command.examples?.length && { examples: command.examples }),
		...(outputSchema && { outputSchema: { ...outputSchema } }),
		...(command.contexts?.length && { contexts: command.contexts }),
	};
	return Object.keys(meta).length > 0 ? meta : undefined;
}

/** MCP tool annotations (`ToolAnnotations`) derived from command metadata. */
export interface CommandToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

/**
 * MCP tool annotations for a command (`spec/command-metadata.md`, "Annotations"). MCP's defaults
 * assume a tool that is not read-only may be destructive, so only fields the command sets are
 * reported: `mutation: false` gives `readOnlyHint: true`; `mutation: true` gives
 * `readOnlyHint: false` and `destructiveHint` (false when `destructive` is unset); an unset
 * `mutation` gives no annotations.
 */
export function commandToolAnnotations(
	command: Pick<CommandDefinition, 'mutation' | 'destructive'>
): CommandToolAnnotations | undefined {
	if (command.mutation === false) return { readOnlyHint: true };
	if (command.mutation === true) {
		return { readOnlyHint: false, destructiveHint: command.destructive === true };
	}
	return undefined;
}

/**
 * The top-level MCP `outputSchema` of a command tool: the `CommandResult` envelope, with `data`
 * typed by the command's output schema (`spec/command-metadata.md`, "Structured results").
 */
export function commandResultOutputSchema(dataSchema: JsonSchema): JsonSchema {
	const { $schema: _dialect, ...data } = dataSchema as JsonSchema & { $schema?: unknown };
	return {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			data,
			error: { type: 'object' },
			metadata: { type: 'object' },
		},
		required: ['success'],
	};
}
