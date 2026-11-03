/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { Actor, CommandMiddleware } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import { INTERNAL_COMMANDS } from '../commands.js';
import { MCP_CONTEXT_FIELDS } from '../scope/field.js';
import type { LateScope } from '../scope/middleware.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import type { AppSummaryV2, KernelMcpOptions } from '../types.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import { createOverlayCommands } from './overlay-commands.js';
import { createPortRefusals } from './port-refusals.js';
import { createLateScope } from './scope-change.js';
import { createScopeCommands } from './scope-commands.js';
import { createShellCommands, type ShellCommandDeps } from './shell-commands.js';
import { createShellStores } from './stores.js';

export { createOverlayStore } from '../overlays.js';
export { withBootActions } from './boot-actions.js';

export type LateCommandDeps = ShellCommandDeps &
	AppCommandDeps & {
		auth: AuthAdapter;
		store: DataAdapter;
		/** The projection's generation this page booted with. */
		generation(): string;
		isMutation(name: string): boolean;
		/** A replay's recorded actor by trace ID (phase 2 specification, 10). */
		actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
	};

/** A projection as stage B keeps it in the workspace store (4.1). */
export interface AppliedProjection {
	generation: string;
	workspace: { id: string; name: string };
	apps: readonly object[];
}

/**
 * Stage B's own journaled work (phase 2 specification, 2.2, step 5): `workspace-deployment-apply` when
 * the generation differs from the workspace row's. An empty projection with no row does nothing, so an
 * empty shell's journal is unchanged. `run` is boot's own: `BOOT_FIELDS`, past the queue.
 */
export async function applyDeployment(
	scope: ScopeRuntime,
	projection: AppliedProjection,
	run: (name: string, input: unknown) => Promise<unknown>
): Promise<void> {
	const row = scope.workspaces.get(scope.workspace.id);
	if (row ? row.generation === projection.generation : projection.apps.length === 0) return;
	await run('workspace-deployment-apply', {
		generation: projection.generation,
		workspace: projection.workspace,
		entries: projection.apps.map((entry) => {
			const { boot: _boot, ...kept } = entry as { boot?: unknown };
			return kept;
		}),
	});
}

/** What the late chunk gives the kernel (phase 2 specification, 2.2 and 3.4). */
export interface LateParts {
	/** The shell commands with `boot`, in the order `SHELL_COMMAND_NAMES` lists. */
	shell: ZodCommandDefinition[];
	/** The port's refusals, which `INTERNAL_COMMANDS` keeps out of every list. */
	internal: ZodCommandDefinition[];
	/** `BOOT_ONLY`'s commands, in a registry of their own that only `BOOT_FIELDS` reaches. */
	bootOnly: ZodCommandDefinition[];
	/** What the scope middleware calls once this chunk has loaded. */
	lateScope: LateScope;
	/**
	 * What phase 6's hosted lane passes to `createMcpHandler` (phase 2 specification, 3.3): every registered
	 * command but `INTERNAL_COMMANDS` (`BOOT_ONLY`'s are in no registry but boot's), the kernel's own chain,
	 * and `scope` alone.
	 */
	mcpOptions(
		commands: readonly ZodCommandDefinition[],
		middleware: readonly CommandMiddleware[]
	): KernelMcpOptions;
	/** A reload, for a replay: the session is forgotten, as the Mock's page forgets it (10). */
	reload(): Promise<void>;
	/** The instances whose commands the palette and `listCommands` leave out: not available here (11.2). */
	hidden(apps: readonly AppSummaryV2[]): ReadonlySet<string>;
}

export function createLateParts(
	boot: readonly ZodCommandDefinition[],
	deps: LateCommandDeps
): LateParts {
	const lateScope = createLateScope(deps);
	const scoped = createScopeCommands({
		...deps,
		stores: createShellStores(deps.store, deps.scope),
		lateScope,
	});
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
			...scoped,
		].map((command) => [command.name, command])
	);
	return {
		shell: SHELL_COMMAND_NAMES.map((name) => byName.get(name) as ZodCommandDefinition),
		internal: createPortRefusals(),
		bootOnly: [byName.get('workspace-deployment-apply') as ZodCommandDefinition],
		lateScope,
		mcpOptions: (commands, middleware) => ({
			commands: commands.filter((command) => !INTERNAL_COMMANDS.includes(command.name)),
			middleware,
			contextFields: MCP_CONTEXT_FIELDS,
		}),
		hidden: (apps) => new Set(apps.filter((app) => !app.available).map((app) => app.instance)),
		async reload() {
			// A reload signs the Mock out (`host.ts`), so the boot's `auth-session-get` reads the same.
			await deps.auth.signOut();
			lateScope.forgetActor();
		},
	};
}

/**
 * The late commands with `boot`, in the order `SHELL_COMMAND_NAMES` lists, which is the order a person
 * or an agent has always seen them in.
 */
export function shellCommandsWithLate(
	boot: readonly ZodCommandDefinition[],
	deps: LateCommandDeps
): ZodCommandDefinition[] {
	return createLateParts(boot, deps).shell;
}
