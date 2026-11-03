/**
 * @fileoverview What the kernel knows of the shell's commands before their definitions load: the names
 * and their exposure. The boot commands are in `boot-commands.ts`, and the rest in `late/`.
 */

import type { ExposeOptions } from '@lushly-dev/afd-server/define';

/** Every shell command's exposure in phase 0 and 1: no CLI or MCP surface until phase 6. */
export const SHELL_EXPOSE: Readonly<Required<ExposeOptions>> = Object.freeze({
	palette: true,
	agent: true,
	mcp: false,
	cli: false,
});

/**
 * Boot's own journaled work (phase 2 specification, 2.2): `run` answers `COMMAND_NOT_FOUND` for these
 * names unless it is given the kernel's `BOOT_FIELDS`, so no person, app or agent reaches them, and
 * `mcpOptions()` leaves them out. `document-trash-expire` is the documents specification's (step 9).
 * Each is a mutation, which a kernel event of boot's own work reports.
 */
export const BOOT_ONLY: readonly string[] = Object.freeze([
	'workspace-deployment-apply',
	'document-trash-expire',
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
	...BOOT_ONLY,
]);

/** Most results `palette-search` returns, and its default. */
export const PALETTE_SEARCH_LIMIT = { max: 50, default: 20 } as const;
