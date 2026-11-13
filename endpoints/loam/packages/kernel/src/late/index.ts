/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import { BOOT_ONLY, INTERNAL_COMMANDS } from '../commands.js';
import { createDefaultLayout } from '../layout.js';
import { type AccessActorV1, personKey } from '../scope/access.js';
import { createRecordCache } from '../scope/cache.js';
import { MCP_CONTEXT_FIELDS } from '../scope/field.js';
import { type LateScope, sessionActor } from '../scope/middleware.js';
import type { PersonalStore } from '../scope/personal.js';
import type { AgentMemberV1, ScopeV1 } from '../scope/records.js';
import type { QueuedTicket } from '../scope/runtime.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import type {
	AppSummaryV2,
	AppsLoadV2,
	KernelEventV3,
	KernelMcpOptions,
	KernelOptionsV3,
	KernelPortsV1,
} from '../types.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import { agentActor, createAuthGate, membershipUnavailable, sessionChanged } from './auth-gate.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { createDocumentCheck } from './document-types.js';
import type { EditorParts } from './editor-commands.js';
import type { EditorDraftsV1 } from './editor-state.js';
import { createDocumentIndex, createLinkCommands, expireLinks } from './links.js';
import { createNewParts } from './new-list.js';
import { createOverlayCommands } from './overlay-commands.js';
import { createDocumentRows, type DocumentRows } from './palette-documents.js';
import { personalWrites } from './personal-writes.js';
import { appCallable } from './port-callable.js';
import { createPortRefusals } from './port-refusals.js';
import { createProjectSummaryCommand, type ProjectSummaryDeps } from './project-summary.js';
import { createLateScope, type LateScopeDeps } from './scope-change.js';
import { createScopeCommands } from './scope-commands.js';
import type { SessionSettle } from './session-settle.js';
import { createShellCommands, type ShellCommandDeps } from './shell-commands.js';
import { createShellStores, type ShellStores } from './stores.js';
import { AGENT_MEMBER_TABLE } from './tables.js';

/**
 * `DOCUMENTS_LAYOUT_ID`'s value, a literal here: imported, the first paint's `shell-state` chunk would export one
 * more binding for this chunk (`literals.test.ts` holds the two equal).
 */
export const DOCUMENTS_LAYOUT = 'loam.layout.~documents';

/** What a layout read shows of the inspector: whether it is open, and the compact class's drawer. */
interface Presented {
	inspector: { open: boolean };
	compact: { drawer: string | null };
}

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
		/** The deployment's identity (phase 3 specification, 2.1). Absent: `local`. */
		identity?: IdentityV1;
		/** A `provider` deployment's view-state store, whose writes this chunk attaches (4.5). */
		personal?: PersonalStore | undefined;
		/** Boot's own: never queued, top-level and journaled, which `session-settle` runs as (4.4). */
		runBoot(name: string, input: unknown): Promise<{ success: boolean }>;
		/** The host's ports: the expiry timer's `schedule` and `readMembership` (4.4). */
		ports?: KernelPortsV1 | undefined;
		/** `run`'s `auth-*` call queued last on each interface, which this chunk clears as it ends (4.4). */
		pending: Partial<Record<string, QueuedTicket>>;
		/** The symbol `run` keeps a queued call's ticket under: the kernel's own, so first paint shares no new one. */
		queued: symbol;
		/** The actor stage A chose the scope for, undefined in it signed out; none before it has (4.4, B1). */
		stageA?: [AccessActorV1] | undefined;
	} & Pick<ProjectSummaryDeps, 'summaries' | 'run' | 'deadlineMs'> &
	/** What stage B reads of the apps, from the kernel's options (phase 2 specification, 2.2). */
	Pick<KernelOptionsV3, 'boot' | 'appsLoader' | 'deployment'>;

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
	 * The kernel's auth gate over `held` (phase 3 specification, 2.1 and 3.2): a new instance each time, as
	 * afd-auth's middleware closes over its `exclude` list.
	 */
	authGate(held: readonly ZodCommandDefinition[]): CommandMiddleware;
	/** The agent interface's actor for `options.agent`, or its refusal (phase 3 specification, 3.1). */
	agentActor: typeof agentActor;
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
		listeners: ReadonlySet<(event: KernelEventV3) => void>
	): KernelMcpOptions;
	/** A reload, for a replay: the session is forgotten, as the Mock's page forgets it (10). */
	reload(): Promise<void>;
	/**
	 * Stage B's first act, after its own journaled work and before any queued call: the first `session-settle` in
	 * `provider` mode, then the adapter's listener and the expiry timer (phase 3 specification, 4.4).
	 */
	begin(): Promise<void>;
	/**
	 * What stage B reads of the apps: the host's loader with `boot`, else the options themselves. Here, since
	 * stage B reads them only once this chunk has loaded (phase 3 specification, 13).
	 */
	readApps(): Promise<AppsLoadV2 | { unavailable: string }>;
	/** `app-instance-refresh` for each mounted instance: the chrome calls it after first paint (13). */
	startInstances(): Promise<void>;
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
	// The palette's titles are read again after any record is written (documents specification, 8.2).
	let rows: DocumentRows | undefined;
	const documents = createDocumentCheck({ ...deps, changed: () => rows?.changed() });
	rows = createDocumentRows(
		deps.store,
		deps.scope,
		(type) => documents.types().types.get(type)?.title
	);
	// The chunks of the late load, awaited together inside `loadLate`, so their commands register in stage B;
	// any failing fails the late load whole (documents specification, Status, deviations 9 and 14). The third is
	// `late-identity`, the kernel's hearing of the adapter, with `session-settle` (phase 3 specification, 4.4, 13).
	const [{ createDocumentCommands, trashBefore }, { createEditorParts }, { createSessionSettle }] =
		await Promise.all([
			import('./documents.js'),
			import('./editor-commands.js'),
			import('./session-settle.js'),
		]);
	// The port reads its list from here, so `apps` does not hold it (2.4); set once both chunks have loaded,
	// before any app, so a late load that fails sets nothing.
	deps.scope.callable = appCallable;
	// Keyed by the person the shell is for, once `session-settle` is built; the adapter's until then (4.4, B2).
	const quiet =
		deps.personal &&
		personalWrites(deps.personal, deps.store, deps.viewState, () => {
			const settledFor = sessions?.person();
			return settledFor === undefined
				? personKey(sessionActor(deps.auth, deps.clock))
				: (settledFor ?? undefined);
		});
	// The `agent-member` table, which line 4 of the access decision reads (phase 3 specification, 3.3).
	const agents = createRecordCache<AgentMemberV1>(AGENT_MEMBER_TABLE);
	await agents.load(deps.store);
	deps.scope.agents = agents;
	// The editor owner after a call that may move it (documents specification, 5.4); built below, with
	// the scope it needs.
	let editor: EditorParts | undefined;
	// `loam.layout.~documents` declares the inspector while the editor owner, the active tab's plugin, has a
	// type with one (5.1): recomputed after a call that may move the active tab, main or the scope, and at boot.
	let inspector = false;
	const declare = async () => {
		const owner = await editor?.owner();
		const has = [...documents.types().types.values()].some(
			(type) => type.instance === owner && type.surfaces.includes('inspector')
		);
		if (has === inspector) return;
		inspector = has;
		deps.state.registerAppLayout(
			'~documents',
			createDefaultLayout(),
			new Set(has ? ['sidebar', 'inspector'] : ['sidebar'])
		);
	};
	/** The kernel's hearing of the adapter (phase 3 specification, 4.4), built below with what it needs. */
	let sessions: SessionSettle | undefined;
	const lateScope = createLateScope({
		...deps,
		session: () => sessions,
		documents,
		async settle(name, call) {
			await editor?.settle(name, call);
			const seen = deps.scope.seen.get(call.traceId as string);
			if (/^(editor-|document-)/.test(name) || seen?.mainChanged || seen?.scopeChanged)
				await declare();
		},
	});
	// The editor area's dirty tabs and selections, made here so a change of person can move them (4.5).
	const drafts: EditorDraftsV1 = { dirty: new Map(), selections: new Map() };
	const editorParts = createEditorParts(
		{ ...deps, lateScope, check: documents, drafts },
		DOCUMENT_KIT
	);
	editor = editorParts;
	sessions = createSessionSettle({
		...deps,
		lateScope,
		drafts,
		ensureEditor: (project) => editorParts.ensure(project),
		kit: {
			define: DOCUMENT_KIT.define,
			success: DOCUMENT_KIT.success,
			z: DOCUMENT_KIT.z,
			actor: () => sessionActor(deps.auth, deps.clock),
			personKey,
			ticket: (call) => (call as unknown as Record<symbol, QueuedTicket | undefined>)[deps.queued],
			sessionChanged,
			membershipUnavailable,
			marked: DOCUMENT_KIT.marked,
			internal: INTERNAL_COMMANDS,
		},
		...(quiet ? { quiet } : {}),
	});
	// The kernel's `dispose` destroys the view state last: the listener and the timer stop with it.
	const destroy = deps.viewState.destroy.bind(deps.viewState);
	deps.viewState.destroy = () => {
		sessions?.stop();
		return destroy();
	};
	// The active scope's editor record registers in stage B and is read then (documents specification, 6):
	// stage A's `hydrate` drops a record with no handler.
	// Each person's `loam.new.recent~<actor>` registers on their first use, read before anything writes it (7).
	const created = createNewParts({ ...deps, check: documents });
	// The link index, built by one `list` at its first read, and kept by the link commands and expiry (9.3).
	const index = createDocumentIndex(deps.store);
	await editor.ensure(deps.scope.active().project);
	await declare();
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
			...createShellCommands({
				...deps,
				editorOwner: editor.owner,
				documentRows: rows,
				instanceCommands: (instance) =>
					new Set(
						[...documents.types().types.values()].flatMap((type) =>
							type.instance === instance ? type.instanceCommands : []
						)
					),
			}),
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
			...createDocumentCommands(
				{ ...deps, check: documents, editor, links: { expire: expireLinks(index) } },
				DOCUMENT_KIT
			),
			...createLinkCommands({ ...deps, check: documents, index }),
			...editor.commands,
			created.command,
			sessions.command,
		].map((command) => [command.name, command])
	);
	// The New menu's `document-create { recent: true }` keeps its type and template first (documents specification, 7).
	byName.set(
		'document-create',
		created.recording(byName.get('document-create') as ZodCommandDefinition)
	);
	// After stage B, every layout read an agent can make, `layout-get`, `layout-set`'s and `layout-reset`'s results and
	// `view-state-get` of a layout record, answers an inspector `~documents` does not declare as closed, its drawer
	// too, writing nothing: the shell then hides the part and closes its drawer as for any closed part, and the
	// person's layout stays theirs, so a note shows the inspector again as they left it, and an undo, built from
	// the record, applies as it was recorded (5.1; step 12's re-checks, B1 and S-2).
	const presented = (layout: Presented): Presented =>
		inspector
			? layout
			: {
					...layout,
					inspector: { ...layout.inspector, open: false },
					compact:
						layout.compact.drawer === 'inspector'
							? { ...layout.compact, drawer: null }
							: layout.compact,
				};
	for (const name of ['layout-get', 'layout-set', 'layout-reset', 'view-state-get']) {
		const command = byName.get(name) as ZodCommandDefinition;
		byName.set(name, {
			...command,
			async handler(input: unknown, context: CommandContext) {
				const result = (await command.handler(input, context)) as CommandResult<
					Presented | { id: string; state: Presented }
				>;
				const data = result.data;
				const id = name === 'view-state-get' ? (input as { id: string }).id : 'loam.layout';
				const documents =
					id === DOCUMENTS_LAYOUT ||
					(id === 'loam.layout' && deps.state.layoutId() === DOCUMENTS_LAYOUT);
				if (!data || !documents) return result;
				return {
					...result,
					data: 'state' in data ? { ...data, state: presented(data.state) } : presented(data),
				};
			},
		} as ZodCommandDefinition);
	}
	// After stage B, `section-get` names the active tab's document as the documents section's path (5.1).
	byName.set('section-get', editor.sectionGet(byName.get('section-get') as ZodCommandDefinition));
	const parts: LateParts = {
		shell: SHELL_COMMAND_NAMES.map((name) => byName.get(name) as ZodCommandDefinition),
		internal: createPortRefusals(),
		// From `BOOT_ONLY` itself, so the boot registry can hold nothing else (2.2).
		bootOnly: BOOT_ONLY.flatMap((name) => byName.get(name) ?? []),
		lateScope,
		agentActor,
		authGate: (held) =>
			createAuthGate(deps.auth, held, {
				identity: deps.identity ?? { mode: 'local' },
				clock: deps.clock,
				copied: sessions?.copied,
				after: (name) => {
					if (name.startsWith('auth-')) sessions?.afterAuth();
				},
				before: (name, context) => sessions?.settleFirst(name, context),
			}),
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
						sessionActor(deps.auth, deps.clock),
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
						(before ||
							!seen?.scope ||
							deps.scope.allows(sessionActor(deps.auth, deps.clock), seen.scope))
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
			// A reload forgets the overlays and the apps' session state, and signs the Mock out (`host.ts`), so
			// the boot's `auth-session-get` reads the same.
			deps.overlays.reset();
			deps.apps().resetSession();
			await deps.auth.signOut();
			// A replay's page starts as the person its first settle names, as the original's stage A did (4.4).
			deps.internals?.startPage?.();
			lateScope.forgetActor();
			sessions?.reload();
			// Dirty tabs and selections are memory alone, lost as an unsaved change is (5.2).
			editor?.reset();
		},
		begin: () => (sessions as SessionSettle).begin(),
		async readApps() {
			try {
				const listed = deps.deployment;
				const loaded = deps.boot
					? await deps.appsLoader?.()
					: listed === undefined || listed.apps.length === 0
						? undefined
						: ({
								deployment: listed,
								...(deps.ports !== undefined ? { ports: deps.ports } : {}),
							} as AppsLoadV2);
				// A boot with no loader: every app is listed `failed`, never the shell.
				return loaded ?? { unavailable: 'no apps loader' };
			} catch (cause) {
				// A loader that throws refuses every app with its message, and never the shell (D66).
				reportLate(cause);
				return { unavailable: String((cause as Error)?.message ?? cause) };
			}
		},
		async startInstances() {
			await Promise.all(
				deps
					.apps()
					.mountedInstances()
					.map((instance) => deps.run('palette', 'app-instance-refresh', { instance }, {}, {}))
			);
		},
	};
	return parts;
}
