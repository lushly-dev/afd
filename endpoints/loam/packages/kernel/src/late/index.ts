/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { SHELL_COMMAND_NAMES } from '../commands.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import { createOverlayCommands } from './overlay-commands.js';
import { createShellCommands, type ShellCommandDeps } from './shell-commands.js';

export { createOverlayStore } from '../overlays.js';

export type LateCommandDeps = ShellCommandDeps &
	AppCommandDeps & {
		auth: AuthAdapter;
	};

/**
 * The late commands with `boot`, in the order `SHELL_COMMAND_NAMES` lists, which is the order a person
 * or an agent has always seen them in.
 */
export function shellCommandsWithLate(
	boot: readonly ZodCommandDefinition[],
	deps: LateCommandDeps
): ZodCommandDefinition[] {
	const byName = new Map(
		[
			...boot,
			...createShellCommands(deps),
			...createAuthMutationCommands(deps.auth),
			...createAppCommands(deps),
			...createOverlayCommands({
				overlays: deps.overlays,
				activeApp: () => deps.state.activeApp(),
			}),
		].map((command) => [command.name, command])
	);
	return SHELL_COMMAND_NAMES.map((name) => byName.get(name) as ZodCommandDefinition);
}
