/**
 * @fileoverview `keybinding-list` (phase 4 specification, 8.5; D123), in the `late-settings` chunk beside the settings
 * whose `loam.keybindings.overrides` it reads through the kernel's registry. Nothing of first paint is imported but
 * types: the registry reaches here through the deps (phase 3 specification, 13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { KernelFieldContext } from '../context-fields.js';
import type { KeybindingEntryV1, KeybindingRegistry } from '../keybindings.js';
import type { DocumentKit } from './document-kit.js';

/** What this module reads of first paint's modules, given by `late/`. */
export type KeybindingKit = Pick<DocumentKit, 'define' | 'success' | 'kernelFailure' | 'z'>;

export interface KeybindingCommandDeps {
	/** The kernel's registry: the shell's, the apps' and the person's bindings. Absent, the list refuses (fail closed). */
	keybindings?: KeybindingRegistry;
	/** The active app. */
	activeApp(): string | null;
	kit: KeybindingKit;
}

/** `keybinding-list`'s output budget, in UTF-8 bytes (D115): at most 64 overrides, 8 chords and the apps'. */
export const KEYBINDING_OUTPUT_BUDGET = { defaultBytes: 65_536, maxBytes: 65_536 } as const;

/** `keybinding-list` (8.5): read by a person and by the agent acting for them; no app, and not over MCP (R5). */
export function createKeybindingCommands(deps: KeybindingCommandDeps): ZodCommandDefinition[] {
	const { kit } = deps;
	const { z } = kit;
	const text = z.string().check(z.minLength(1), z.maxLength(128));
	const listInput = z.strictObject({
		command: z.optional(text),
		target: z.optional(text),
		all: z.optional(z.boolean()),
	});

	type Listed = { bindings: KeybindingEntryV1[]; refused?: number };
	const list = kit.define<typeof listInput, Listed>({
		name: 'keybinding-list',
		title: 'List keybindings',
		description:
			"The bindings in force, ordered by keys, each with its source (shell, app or you), what it shadows and whether it is active; with `all`, also the shadowed, unbound and inactive apps' ones. `active` decides `project` and `documentType`; focus terms (`editor`, `sidebar`, `main`) count as holding",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				command: { type: 'string', minLength: 1, maxLength: 128 },
				target: { type: 'string', minLength: 1, maxLength: 128 },
				all: { type: 'boolean' },
			},
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context: CommandContext): Promise<CommandResult<Listed>> {
			// An app reads no person's bindings (R5): refused in the handler too, beside the port's list.
			if ((context as KernelFieldContext).caller !== undefined)
				return kit.kernelFailure(
					'CALL_NOT_GRANTED',
					'No app reads the keybindings',
					'Let the person read them in the shell'
				);
			const { keybindings } = deps;
			if (!keybindings)
				return kit.kernelFailure(
					'LATE_COMMANDS_UNAVAILABLE',
					'The keybindings are not loaded in this kernel',
					'Reload the page, then list them again'
				);
			const resolved = keybindings.resolve(keybindings.context(deps.activeApp()));
			const bindings = resolved.entries
				.filter((entry) => input.all === true || entry.inForce)
				.filter((entry) => input.command === undefined || entry.command === input.command)
				.filter((entry) => input.target === undefined || entry.target === input.target)
				.map(({ inForce, ...entry }) => ({ ...entry, active: inForce && entry.active }))
				// By keys (8.5); the sort is stable, so on equal keys by precedence.
				.sort((a, b) => (a.keys < b.keys ? -1 : a.keys > b.keys ? 1 : 0));
			// Stored overrides a newer rule refuses are dropped on read, and counted here (the re-check's 8).
			const refused = keybindings.refused();
			const data: Listed = { bindings, ...(refused > 0 ? { refused } : {}) };
			if (new TextEncoder().encode(JSON.stringify(data)).length > KEYBINDING_OUTPUT_BUDGET.maxBytes)
				return kit.kernelFailure(
					'OUTPUT_BUDGET_EXCEEDED',
					'The keybindings are over this command’s output budget',
					'Name a command with `command`'
				);
			return kit.success(structuredClone(data));
		},
	});

	return [list] as unknown as ZodCommandDefinition[];
}
