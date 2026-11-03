/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { Actor, CommandMiddleware } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import { BOOT_ONLY, INTERNAL_COMMANDS } from '../commands.js';
import { MCP_CONTEXT_FIELDS } from '../scope/field.js';
import type { LateScope } from '../scope/middleware.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import type { AppSummaryV2, KernelMcpOptions } from '../types.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import { createOverlayCommands } from './overlay-commands.js';
import { createPortRefusals } from './port-refusals.js';
import { createLateScope } from './scope-change.js';
import { createScopeCommands } from './scope-commands.js';
import { createShellCommands, type ShellCommandDeps } from './shell-commands.js';
import { createShellStores, type ShellStores } from './stores.js';

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

/**
 * The commands that move a person's active scope, what main shows or the session: a person's or an
 * agent's in process, never a server's, which holds no active scope (phase 2 specification, 3.3).
 */
export const PERSON_SESSION: readonly string[] = Object.freeze([
	'scope-set',
	'section-open',
	'app-open',
	'app-close',
	'app-route-set',
	'auth-sign-in',
	'auth-sign-out',
]);

/** A projection as stage B keeps it in the workspace store (4.1). */
export interface AppliedProjection {
	generation: string;
	workspace: { id: string; name: string };
	apps: readonly object[];
}

/**
 * Stage B's own journaled work (phase 2 specification, 2.2, step 5): `workspace-deployment-apply` when
 * the generation differs from the workspace row's. An empty projection with no row does nothing, so an
 * empty shell's journal is unchanged. `run` is boot's own: `BOOT_FIELDS`, past the queue. True when the
 * store holds the projection's entries afterwards, so a workspace row may take its generation.
 */
export async function applyDeployment(
	stores: ShellStores,
	projection: AppliedProjection,
	run: (name: string, input: unknown) => Promise<{ success: boolean }>
): Promise<boolean> {
	const row = await stores.workspace();
	if (row ? row.generation === projection.generation : projection.apps.length === 0) return true;
	const result = await run('workspace-deployment-apply', {
		generation: projection.generation,
		workspace: projection.workspace,
		entries: projection.apps.map((entry) => {
			const { boot: _boot, ...kept } = entry as { boot?: unknown };
			return kept;
		}),
	});
	return result.success;
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
	/**
	 * Stage B's own journaled work, with `run` boot's own (2.2, step 5); never re-run in a replay, whose
	 * entries are what ran. It keeps whether the store now holds the projection's entries.
	 */
	apply(
		projection: AppliedProjection,
		replaying: boolean,
		run: (name: string, input: unknown) => Promise<{ success: boolean }>
	): Promise<void>;
	/** The instances whose commands the palette and `listCommands` leave out: not available here (11.2). */
	hidden(apps: readonly AppSummaryV2[]): ReadonlySet<string>;
}

export function createLateParts(
	boot: readonly ZodCommandDefinition[],
	deps: LateCommandDeps
): LateParts {
	const lateScope = createLateScope(deps);
	/** Whether the store holds the booted projection's entries, so a new workspace row may claim it. */
	let applied = false;
	const stores = createShellStores(deps.store, deps.scope);
	const scoped = createScopeCommands({
		...deps,
		stores,
		lateScope,
		applied: () => applied,
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
		// From `BOOT_ONLY` itself, so the boot registry can hold nothing else (2.2).
		bootOnly: BOOT_ONLY.flatMap((name) => byName.get(name) ?? []),
		lateScope,
		mcpOptions: (commands, middleware) => ({
			// A server holds no active scope and no person's session (3.3), so the commands that move them
			// are not served: a person's calls make them.
			commands: commands.filter(
				(command) =>
					!INTERNAL_COMMANDS.includes(command.name) && !PERSON_SESSION.includes(command.name)
			),
			middleware,
			contextFields: MCP_CONTEXT_FIELDS,
		}),
		hidden: (apps) => new Set(apps.filter((app) => !app.available).map((app) => app.instance)),
		async apply(projection, replaying, run) {
			// A replay applies through its entries; an empty projection there holds nothing to apply. A
			// failure fails the apply alone, which the next stage B tries again: the shell's commands load.
			try {
				applied = replaying
					? projection.apps.length === 0
					: await applyDeployment(stores, projection, run);
			} catch (cause) {
				(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
			}
		},
		async reload() {
			// A reload signs the Mock out (`host.ts`), so the boot's `auth-session-get` reads the same.
			await deps.auth.signOut();
			lateScope.forgetActor();
		},
	};
}
