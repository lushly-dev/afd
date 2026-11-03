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
 * The commands `listCommands` never reports: each only answers a refusal the app port runs through
 * the journal (phase 1 specification, 5.3).
 */
export const INTERNAL_COMMANDS: readonly string[] = Object.freeze([
	'app-call-refuse',
	'app-modal-refuse',
	'app-nested-refuse',
]);

/** The shell's command names, in registration order. */
export const SHELL_COMMAND_NAMES = [
	'view-state-get',
	'view-state-set',
	'view-state-list',
	'layout-get',
	'layout-set',
	'layout-reset',
	'appearance-get',
	'appearance-set',
	'palette-open',
	'palette-close',
	'palette-search',
	'auth-sign-in',
	'auth-sign-out',
	'auth-session-get',
	'shell-info-get',
	'app-list',
	'app-get',
	'app-open',
	'app-close',
	'app-command-list',
	'app-instance-list',
	'app-instance-refresh',
	'app-selection-get',
	'app-selection-set',
	'status-item-set',
	'toast-show',
	'modal-open',
	'overlay-dismiss',
	'overlay-list',
] as const;

/** Most results `palette-search` returns, and its default. */
export const PALETTE_SEARCH_LIMIT = { max: 50, default: 20 } as const;
