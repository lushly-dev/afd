/** Shared MCP metadata reporting rules for command definitions and server tools. */
import { type ApprovalDecision, type ApprovalPolicy, approvalMode } from './approval.js';
import type { CommandDefinition, JsonSchema } from './commands.js';
import { AFD_OUTPUT_BUDGET_META_KEY, type OutputBudget } from './output-budget.js';

type MetadataFields = Pick<
	CommandDefinition,
	| 'category'
	| 'requires'
	| 'mutation'
	| 'destructive'
	| 'undoable'
	| 'examples'
	| 'contexts'
	| 'scopes'
	| 'confirmationMode'
	| 'toolMeta'
	| 'task'
>;

/** Per-command planning metadata; display-only confirmPrompt is intentionally absent. */
export type CommandToolMeta = MetadataFields & {
	/** The approval policy; a function policy is reported as `'conditional'`. */
	approval?: ApprovalDecision | 'conditional';
	// A mapped object retains schema field types and is structurally compatible with
	// MCP's existing Record<string, unknown> metadata contract.
	outputSchema?: { [Key in keyof JsonSchema]: JsonSchema[Key] };
	/** Declared output budget (`spec/output-budgets.md`, B1). */
	[AFD_OUTPUT_BUDGET_META_KEY]?: OutputBudget;
};

/**
 * Omit unset fields and empty arrays, while preserving explicitly set false booleans. The
 * command's extra `toolMeta` entries are emitted beside the server's own.
 */
export function commandToolMeta(
	command: MetadataFields & {
		approval?: ApprovalPolicy<never>;
		outputBudget?: OutputBudget;
	},
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
		...(command.scopes?.length && { scopes: command.scopes }),
		...(command.confirmationMode != null && { confirmationMode: command.confirmationMode }),
		...(command.task != null && { task: command.task }),
		...(command.outputBudget && {
			[AFD_OUTPUT_BUDGET_META_KEY]: {
				defaultBytes: command.outputBudget.defaultBytes,
				maxBytes: command.outputBudget.maxBytes,
			},
		}),
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

/** Keywords whose value is a schema, in the subset `spec/validation.md` names. */
const SCHEMA_KEYWORDS = new Set([
	'items',
	'additionalProperties',
	'not',
	'if',
	'then',
	'else',
	'contains',
	'propertyNames',
	'additionalItems',
	'unevaluatedItems',
	'unevaluatedProperties',
]);
/** Keywords whose value is an array of schemas. */
const SCHEMA_LIST_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']);
/**
 * Keywords whose value maps names to schemas. Draft-07 `dependencies` maps a name to a schema or to
 * a list of property names; only a schema is walked.
 */
const SCHEMA_MAP_KEYWORDS = new Set([
	'properties',
	'patternProperties',
	'$defs',
	'definitions',
	'dependentSchemas',
	'dependencies',
]);

/**
 * Whether a schema starts a schema resource: a string `$id` that is not a bare fragment
 * (`spec/validation.md`), so its local references resolve against it.
 */
function startsResource(schema: unknown): boolean {
	if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false;
	const id = (schema as { $id?: unknown }).$id;
	return typeof id === 'string' && !id.startsWith('#');
}

/**
 * A copy of `schema` in which every `"$ref": "#"` that names its root, outside any nested
 * schema resource, names `target` instead. Annotations and values (`const`, `enum`, `default`,
 * `examples`) are left as they are.
 */
function retargetRoot(schema: unknown, target: string, root = true): unknown {
	if (Array.isArray(schema) || typeof schema !== 'object' || schema === null) return schema;
	if (!root && startsResource(schema)) return schema;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === '$ref' && value === '#') out[key] = target;
		else if (SCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value)) {
			out[key] = value.map((item) => retargetRoot(item, target, false));
		} else if (SCHEMA_KEYWORDS.has(key)) out[key] = retargetRoot(value, target, false);
		else if (
			SCHEMA_MAP_KEYWORDS.has(key) &&
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value)
		) {
			out[key] = Object.fromEntries(
				Object.entries(value).map(([name, item]) => [name, retargetRoot(item, target, false)])
			);
		} else out[key] = value;
	}
	return out;
}

/**
 * The top-level MCP `outputSchema` of a command tool: the `CommandResult` envelope, with `data`
 * typed by the command's output schema (`spec/command-metadata.md`, "Structured results").
 *
 * `$schema` is dropped. When `data` starts a schema resource (a string `$id` that is not a bare
 * fragment, the validators' test), its local references resolve against it, so its definitions
 * stay inside it. Otherwise its definitions move to the envelope, and a `"$ref": "#"` that named
 * `data` becomes `"#/properties/data"`, since `#` now names the envelope.
 */
export function commandResultOutputSchema(dataSchema: JsonSchema): JsonSchema {
	const { $schema: _dialect, ...declared } = dataSchema as JsonSchema & { $schema?: unknown };
	const resource = startsResource(declared);
	const data = (resource ? declared : retargetRoot(declared, '#/properties/data')) as Record<
		string,
		unknown
	>;
	const hoisted: { $defs?: unknown; definitions?: unknown } = {};
	if (!resource) {
		for (const key of ['$defs', 'definitions'] as const) {
			if (data[key] !== undefined) hoisted[key] = data[key];
			delete data[key];
		}
	}
	return {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			data: data as unknown as JsonSchema,
			error: {
				type: 'object',
				properties: {
					code: { type: 'string' },
					message: { type: 'string' },
					suggestion: { type: 'string' },
					retryable: { type: 'boolean' },
				},
				required: ['code', 'message'],
			},
			metadata: { type: 'object' },
		},
		required: ['success'],
		...hoisted,
	} as JsonSchema;
}
