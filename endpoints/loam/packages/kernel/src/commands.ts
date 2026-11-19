/**
 * @fileoverview What the kernel knows of the shell's commands before their definitions load: the names
 * and their exposure. The boot commands are in `boot-commands.ts`, and the rest in `late/`.
 */

import type { ExposeOptions } from '@lushly-dev/afd-server/define';

/**
 * Every shell command's exposure in phase 0 and 1: no CLI or MCP surface until phase 6. Never `apps`:
 * an app reaches a shell command only through its port's own list (phase 1 specification, 5.3).
 */
export const SHELL_EXPOSE: Readonly<Required<ExposeOptions>> = Object.freeze({
	palette: true,
	agent: true,
	mcp: false,
	cli: false,
	apps: false,
});

/**
 * Boot's own journaled work (phase 2 specification, 2.2): `run` answers `COMMAND_NOT_FOUND` for these
 * names unless it is given the kernel's `BOOT_FIELDS`, so no person, app or agent reaches them, and
 * `mcpOptions()` leaves them out. `app-settle` follows the apply (F3); `document-trash-expire` is the
 * documents specification's (step 9). `session-settle` is the kernel's change of person (phase 3
 * specification, 4.4): never queued, so it runs before any call it must come before; `membership-settle` and
 * `agent-member-settle` are the kernel's journaled reads of a sponsor and their agent members' suspension (4.4, 8.3).
 * Each is a mutation, which a kernel event of boot's own work reports.
 */
export const BOOT_ONLY: readonly string[] = Object.freeze([
	'workspace-deployment-apply',
	'app-settle',
	'document-trash-expire',
	'session-settle',
	'membership-settle',
	'agent-member-settle',
	// The kernel's record of how a copilot turn ended (phase 5 specification, 3.4).
	'copilot-turn-settle',
	// The autonomy rows a manifest's apply orphaned, flagged (phase 4 specification, 4.2).
	'autonomy-settle',
	// The shell's own prompts in the slot, journaled before the person answers them, so a replay opens them again (7.2).
	'prompt-settle',
]);

/**
 * The commands `listCommands` never reports: each only answers a refusal the app port runs through
 * the journal (phase 1 specification, 5.3; phase 2 specification, 3.6), and the boot-only commands.
 */
export const INTERNAL_COMMANDS: readonly string[] = Object.freeze([
	'app-call-refuse',
	'app-modal-refuse',
	'app-nested-refuse',
	'app-scope-refuse',
	'app-embed-refuse',
	// The copilot's agent port refusing a message (phase 5 specification, 3.2).
	'copilot-port-refuse',
	// The shell's strip under the title bar (phase 4 specification, 6.1): the kernel's own, never listed.
	'overlay-global-set',
	...BOOT_ONLY,
]);

/** Most results `palette-search` returns, and its default. */
export const PALETTE_SEARCH_LIMIT = { max: 50, default: 20 } as const;
