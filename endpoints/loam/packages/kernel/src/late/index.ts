/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { CommandMiddleware } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import { BOOT_ONLY, INTERNAL_COMMANDS } from '../commands.js';
import { MCP_CONTEXT_FIELDS } from '../scope/field.js';
import { type LateScope, sessionActor } from '../scope/middleware.js';
import type { ScopeV1 } from '../scope/records.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import type { AppSummaryV2, KernelEventV2, KernelMcpOptions } from '../types.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { createDocumentCheck } from './document-types.js';
import type { EditorParts } from './editor-commands.js';
import { createOverlayCommands } from './overlay-commands.js';
import { appCallable } from './port-callable.js';
import { createPortRefusals } from './port-refusals.js';
import { createProjectSummaryCommand, type ProjectSummaryDeps } from './project-summary.js';
import { createLateScope, type LateScopeDeps } from './scope-change.js';
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
		/** What only a replay sets: its recorded actor by trace ID, and `replaying` (phase 2 specification, 10). */
		internals?: LateScopeDeps['internals'];
		/** The kernel's clock, for stage B's trash expiry (documents specification, 4.1). */
		clock?: { now(): number };
	} & Pick<ProjectSummaryDeps, 'summaries' | 'run' | 'deadlineMs'>;

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

/** Report a failure of stage B's own work, which fails alone (2.2). */
const reportLate = (cause: unknown): void =>
	(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);

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
	 * and `scope` alone. Outside that chain, each of a server's mutations that succeeds, in a scope the page's
	 * actor may enter, reaches `listeners` as the kernel's event, with what the call noted, so a page renders
	 * what a server changed (documents specification, 5.4).
	 */
	mcpOptions(
		current: {
			commands: readonly ZodCommandDefinition[];
			middleware: readonly CommandMiddleware[];
		},
		listeners: ReadonlySet<(event: KernelEventV2) => void>
	): KernelMcpOptions;
	/** A reload, for a replay: the session is forgotten, as the Mock's page forgets it (10). */
	reload(): Promise<void>;
	/**
	 * Stage B's own journaled work, with `run` boot's own (2.2, step 5); never re-run in a replay, whose
	 * entries are what ran. It keeps whether the store now holds the projection's entries. Then the trash's
	 * expiry (documents specification, 4.1), and, with `settle` (stage A has hydrated the persisted state),
	 * {@link LateParts.settle}: here rather than in the kernel's stage B, so first paint holds no call of it.
	 */
	apply(
		projection: AppliedProjection,
		run: (name: string, input: unknown) => Promise<{ success: boolean }>,
		settle?: boolean
	): Promise<void>;
	/**
	 * Boot's `app-settle`, once the persisted state is read and after the apply, which may drop the recorded
	 * project from an instance's list: only when the active app cannot open in the recorded scope, and never
	 * in a replay, whose entries are what ran (F3).
	 */
	settle(run: (name: string, input: unknown) => Promise<{ success: boolean }>): Promise<void>;
	/** The instances whose commands the palette and `listCommands` leave out: not available here (11.2). */
	hidden(apps: readonly AppSummaryV2[]): ReadonlySet<string>;
}

/**
 * The late parts, once the `late-documents` chunk has loaded: its `document-*` definitions are awaited
 * here, inside `loadLate`, so they register in stage B with the rest (phase 2 specification, 2.4).
 */
export async function createLateParts(
	boot: readonly ZodCommandDefinition[],
	deps: LateCommandDeps
): Promise<LateParts> {
	const documents = createDocumentCheck(deps);
	// Both chunks of the late load, awaited together inside `loadLate`, so their commands register in stage B;
	// either failing fails the late load whole (documents specification, Status, deviations 9 and 14).
	const [{ createDocumentCommands, trashBefore }, { createEditorParts }] = await Promise.all([
		import('./documents.js'),
		import('./editor-commands.js'),
	]);
	// The port reads its list from here, so `apps` does not hold it (2.4); set once both chunks have loaded,
	// before any app, so a late load that fails sets nothing.
	deps.scope.callable = appCallable;
	// The editor owner after a call that may move it (documents specification, 5.4); built below, with
	// the scope it needs.
	let editor: EditorParts | undefined;
	const lateScope = createLateScope({
		...deps,
		documents,
		settle: (name, call) => editor?.settle(name, call),
	});
	editor = createEditorParts({ ...deps, lateScope, check: documents }, DOCUMENT_KIT);
	// The active scope's editor record registers in stage B and is read then (documents specification, 6):
	// stage A's `hydrate` drops a record with no handler.
	await editor.ensure(deps.scope.active().project);
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
			...createAppCommands({
				...deps,
				documentNotices: (instance) => documents.types().conflicts.get(instance) ?? [],
			}),
			...createOverlayCommands({
				overlays: deps.overlays,
				activeApp: () => deps.state.activeApp(),
				editorOwner: editor.owner,
			}),
			...scoped,
			createProjectSummaryCommand(deps),
			...createDocumentCommands({ ...deps, check: documents, editor }, DOCUMENT_KIT),
			...editor.commands,
		].map((command) => [command.name, command])
	);
	// After stage B, `section-get` names the active tab's document as the documents section's path (5.1).
	byName.set('section-get', editor.sectionGet(byName.get('section-get') as ZodCommandDefinition));
	const parts: LateParts = {
		shell: SHELL_COMMAND_NAMES.map((name) => byName.get(name) as ZodCommandDefinition),
		internal: createPortRefusals(),
		// From `BOOT_ONLY` itself, so the boot registry can hold nothing else (2.2).
		bootOnly: BOOT_ONLY.flatMap((name) => byName.get(name) ?? []),
		lateScope,
		mcpOptions: ({ commands, middleware }, listeners) => ({
			// A server holds no active scope and no person's session (3.3), so the commands that move them
			// are not served: a person's calls make them.
			commands: commands.filter(
				(command) =>
					!INTERNAL_COMMANDS.includes(command.name) && !PERSON_SESSION.includes(command.name)
			),
			middleware: [
				async (command, _input, context, next) => {
					const trace = context.traceId as string;
					// Before and after: a call that takes the page's actor out of a scope is heard too.
					const before = deps.scope.allows(
						sessionActor(deps.auth),
						(context as { scope?: ScopeV1 }).scope ?? { workspace: deps.scope.workspace.id }
					);
					deps.scope.seen.set(trace, {});
					const result = await next();
					const seen = deps.scope.seen.get(trace);
					deps.scope.seen.delete(trace);
					// Only of a scope the page's actor may enter: of any other, the page has nothing to render.
					if (
						result.success &&
						deps.isMutation(command) &&
						(before || !seen?.scope || deps.scope.allows(sessionActor(deps.auth), seen.scope))
					) {
						const event = {
							command,
							interface: 'agent',
							success: true,
							mutation: true,
							...seen,
						} as const;
						for (const listener of [...listeners]) {
							try {
								listener(event);
							} catch (cause) {
								reportLate(cause);
							}
						}
					}
					return result;
				},
				...middleware,
			],
			contextFields: MCP_CONTEXT_FIELDS,
		}),
		hidden: (apps) => new Set(apps.filter((app) => !app.available).map((app) => app.instance)),
		async apply(projection, run, settle) {
			// A replay's entries are what ran (10): it reads its own `internals`, so first paint passes nothing.
			const replaying = deps.internals?.replaying === true;
			// A replay applies through its entries; an empty projection there holds nothing to apply. A
			// failure fails the apply alone, which the next stage B tries again: the shell's commands load.
			try {
				applied = replaying
					? projection.apps.length === 0
					: await applyDeployment(stores, projection, run);
			} catch (cause) {
				reportLate(cause);
			}
			// Then the trash older than the workspace's `trashDays`, journaled, and only when there is some
			// (documents specification, 4.1); a replay's entries are what ran. A failure fails it alone.
			try {
				const before = replaying
					? undefined
					: await trashBefore(
							DOCUMENT_KIT,
							deps.store,
							deps.scope.workspace.id,
							(await stores.workspace())?.trashDays ?? 30,
							deps.clock?.now() ?? Date.now()
						);
				if (before !== undefined) await run('document-trash-expire', { before });
			} catch (cause) {
				reportLate(cause);
			}
			if (settle) await parts.settle(run);
		},
		async settle(run) {
			const replaying = deps.internals?.replaying === true;
			// As the apply: a failure fails the settle alone, reported, never the shell's commands.
			try {
				if (!replaying && lateScope.activeRefusal()) await run('app-settle', {});
			} catch (cause) {
				reportLate(cause);
			}
		},
		async reload() {
			// A reload signs the Mock out (`host.ts`), so the boot's `auth-session-get` reads the same.
			await deps.auth.signOut();
			lateScope.forgetActor();
			// Dirty tabs and selections are memory alone, lost as an unsaved change is (5.2).
			editor?.reset();
		},
	};
	return parts;
}
