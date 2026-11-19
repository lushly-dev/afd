/**
 * @fileoverview Every shell command's definition but the boot commands' (phase 2 specification, 2.3),
 * in a chunk that loads after the first frame: the view-state and auth commands with them, on Zod Mini.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthMutationCommands } from '@lushly-dev/afd-auth/commands';
import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { ICONS_V1 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import * as z from 'zod/mini';
import { APPEARANCE_DENSITIES, APPEARANCE_THEMES } from '../appearance.js';
import { BOOT_ONLY, INTERNAL_COMMANDS } from '../commands.js';
import type { CopilotParts } from '../copilot/commands.js';
import type { CopilotOptionsV1, CopilotTraceV1 } from '../copilot/types.js';
import { createDefaultLayout } from '../layout.js';
import type { KernelLimits } from '../limits.js';
import { createPaletteIndex } from '../palette-index.js';
import { type AccessActorV1, decideAccess, personKey, personOf } from '../scope/access.js';
import { MCP_CONTEXT_FIELDS } from '../scope/field.js';
import { type LateScope, sessionActor } from '../scope/middleware.js';
import type { PersonalStore } from '../scope/personal.js';
import type { ScopeV1 } from '../scope/records.js';
import type { QueuedTicket } from '../scope/runtime.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import type {
	AppSummaryV2,
	AppsLoadV2,
	KernelEventV4,
	KernelMcpOptions,
	KernelOptionsV5,
	KernelPortsV1,
} from '../types.js';
import { type AppCommandDeps, createAppCommands } from './app-commands.js';
import {
	agentActor,
	createAuthGate,
	membershipUnavailable,
	SIGNED_OUT_COMMANDS,
	sessionChanged,
} from './auth-gate.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { createDocumentCheck } from './document-types.js';
import type { EditorParts } from './editor-commands.js';
import type { EditorDraftsV1 } from './editor-state.js';
import { createDocumentIndex, createLinkCommands, expireLinks } from './links.js';
import { archivedRefusal, canOpen, setMain, writeThrough } from './main-state.js';
import { createNewParts } from './new-list.js';
import { createOverlayCommands, openerOf, ownerTitle } from './overlay-commands.js';
import { isOwner, teamListed } from './owners.js';
import { createDocumentRows, type DocumentRows } from './palette-documents.js';
import { personalWrites } from './personal-writes.js';
import { appCallable } from './port-callable.js';
import { createPortRefusals } from './port-refusals.js';
import { createProjectSummaryCommand, type ProjectSummaryDeps } from './project-summary.js';
import { AGENT_PUSH_RATE, APP_PUSH_RATE, createPushRate } from './push-rate.js';
import { createLateScope, documentChainOf, type LateScopeDeps } from './scope-change.js';
import { createScopeCommands, UNAPPLIED } from './scope-commands.js';
import type { SessionSettle } from './session-settle.js';
import type { Settings } from './settings.js';
import { createShellCommands, paletteGroupOf, type ShellCommandDeps } from './shell-commands.js';
import { createShellStores, type ShellStores } from './stores.js';

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

import { landsInInbox, type OverlayOwner, SHELL } from '../overlays.js';
import type { Confirmations } from './confirmations.js';
import type { ActionVerdict } from './notifications.js';

export { createOverlayStore } from '../overlays.js';
export { withBootActions } from './boot-actions.js';

export type LateCommandDeps = ShellCommandDeps &
	AppCommandDeps & {
		auth: AuthAdapter;
		/** The limits the kernel enforces from boot, which `late-settings` reads into (phase 4 specification, section 11). */
		limits?: KernelLimits;
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
		/** The kernel's map of each person's active persona when not `default` (phase 3 specification, 6.1). */
		personas?: Map<string, string>;
		/** The deployment's copilot providers and the host's runner (phase 5 specification, 3.2, 4.1). */
		copilot?: CopilotOptionsV1 | undefined;
		/** The kernel's minted call as `copilot`, with the turn's trace: the only path that sets it (3.2). */
		callAsCopilot?(
			name: string,
			input: unknown,
			trace: CopilotTraceV1,
			scope: ScopeV1 | 'workspace'
		): Promise<CommandResult>;
		/** The agent registry's commands, with their input schemas (4.5). */
		agentCommands?(): Array<{ name: string; description: string; inputSchema?: unknown }>;
		/** Every registered command's name, the live registry's (phase 4's step 8, R4). */
		commandNames?(): readonly string[];
		/** Whether the journal records a call of `command` (`UNJOURNALED_COMMANDS`; phase 4's 7.1). */
		journaled?(command: string): boolean;
		/** The palette registry's commands, with their input schemas: `palette-run`'s prompt (phase 4's 7.1). */
		paletteCommands?(): Array<{ name: string; inputSchema?: unknown }>;
		/** The kernel's `execute`, past the queue: a top-level call journaled as its own (phase 4's 7.1, 7.2). */
		runNow?(
			iface: 'palette' | 'agent',
			name: string,
			input: unknown,
			fields: Record<string | symbol, unknown>
		): Promise<CommandResult>;
	} & Pick<ProjectSummaryDeps, 'summaries' | 'run' | 'deadlineMs'> &
	/** What stage B reads of the apps, from the kernel's options (phase 2 specification, 2.2). */
	Pick<KernelOptionsV5, 'boot' | 'appsLoader' | 'deployment' | 'identityPorts' | 'overlayAnchors'>;

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

/** The shell's inbox commands (phase 4 specification, 10.2), none served over MCP (its section 13). */
const SHELL_NOTIFICATION_COMMANDS: ReadonlySet<string> = new Set(
	SHELL_COMMAND_NAMES.filter((name) => name.startsWith('notification-'))
);

/** The signed-out commands as a set, the palette's filter on a signed-out `provider` page (2.1). */
const SIGNED_OUT_SET: ReadonlySet<string> = new Set(SIGNED_OUT_COMMANDS);

/** The overlays no MCP caller opens (phase 4 specification, 6.1): only a person, an app or the agent interface does. */
const MCP_UNSERVED_OVERLAYS: ReadonlySet<string> = new Set([
	'toast-show',
	'popover-open',
	'dialog-open',
	'modal-open',
	'prompt-open',
	// Nor does an MCP caller close or list one (the review's R2): its `none` path has no overlay of its own.
	'overlay-dismiss',
	'overlay-list',
]);

/** JSON with object keys sorted at every level, as AFD's journal digests it: a turn's call's `inputDigest` (phase 5's 3.4). */
const canonical = (value: unknown): string => {
	const sort = (item: unknown): unknown =>
		Array.isArray(item)
			? item.map(sort)
			: item && typeof item === 'object'
				? Object.fromEntries(
						Object.keys(item)
							.sort()
							.map((key) => [key, sort((item as Record<string, unknown>)[key])])
					)
				: item;
	return JSON.stringify(sort(value)) ?? 'null';
};

/** Report a failure of stage B's own work, which fails alone (2.2). */
const reportLate = (cause: unknown): void =>
	(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);

/** A projection as stage B keeps it in the workspace store (4.1). */
export interface AppliedProjection {
	generation: string;
	workspace: { id: string; name: string };
	apps: readonly object[];
	/** A version 4 projection's host (phase 6 specification, 3.3). */
	host?: { kind: 'static' | 'hosted' | 'desktop' };
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
		// The kind alone, journaled with the entries, so a replay reads it from this entry (phase 6's 3.3, A5).
		...(projection.host ? { host: { kind: projection.host.kind } } : {}),
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
	 * The copilot's gate, last in the kernel's chain; its context fields, declared on both registries from stage B; and
	 * its stop of every running turn (phase 5 specification, 3.2, 6.1).
	 */
	copilot: Pick<CopilotParts, 'gate' | 'contextFields' | 'stopAll'>;
	/** Phase 4's confirmations (its 7.2): the chain's last gate, after the copilot's, and their context fields. */
	confirmations: Pick<Confirmations, 'gate' | 'contextFields'>;
	/**
	 * Right inside the journal, before the scope middleware, whose own changes of person and scope it must see too:
	 * `loam.apps` and `loam.scope` written through before the journal records the call that changed them (#861).
	 */
	writeThrough: CommandMiddleware;
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
		listeners: ReadonlySet<(event: KernelEventV4) => void>
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
	/**
	 * After stage A has hydrated and stage B's commands are in (phase 4 specification, 3.6): an old `loam.appearance`
	 * record moved into the person's `loam.settings`, journaled as `setting-set` with `migrated: true` through `run`,
	 * the palette's call past the queue. Never in a replay, whose entries are what ran.
	 */
	migrate(run: (name: string, input: unknown) => Promise<CommandResult>): Promise<void>;
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
	const [
		{ createDocumentCommands, trashBefore },
		{ createEditorParts },
		{
			createAgentMembers,
			createSessionSettle,
			createIdentityCommands,
			createMemberCommands,
			createPersona,
			HUMAN_COMMANDS,
			MEMBERSHIP_CHANGING_COMMANDS,
			OWNER_COMMANDS,
			PROVIDER_COMMANDS,
		},
		// Phase 4's `late-settings` (its section 1): the settings commands and their pure rules, beside `late-identity`.
		{
			createSettings,
			createNotifications,
			createAutonomy,
			createConfirmations,
			bucketOf,
			createLimitCommands,
			limitNotice,
			isHumanGesture,
			orphanNotice,
			orphanRecipients,
		},
	] = await Promise.all([
		import('./documents.js'),
		import('./editor-commands.js'),
		import('./session-settle.js'),
		import('./settings.js'),
	]);
	// The copilot's records and commands, `late-copilot`, beside them (phase 5 specification, 2 and 3.5).
	const { createCopilotParts } = await import('../copilot/commands.js');
	const copilot: CopilotParts = createCopilotParts({
		store: deps.store,
		workspace: deps.scope.workspace.id,
		options: deps.copilot,
		kit: DOCUMENT_KIT,
		isMutation: deps.isMutation,
		isMounted: (name) => deps.apps().owners.get(name)?.recorded === true,
		instanceOf: (name) => deps.apps().owners.get(name)?.instance,
		agentCommands: () => deps.agentCommands?.() ?? [],
		// A kernel always gives it; a test of `late/` alone has no copilot, so its calls fail closed.
		callAsCopilot: (name, input, trace, scope) =>
			deps.callAsCopilot?.(name, input, trace, scope) ??
			Promise.resolve(
				DOCUMENT_KIT.kernelFailure(
					'COPILOT_PORT_REFUSED',
					'This kernel has no copilot',
					'None: only the runtime uses the port'
				)
			),
		runBoot: (name, input) => deps.runBoot(name, input) as Promise<CommandResult>,
		humanOnly: (name) => HUMAN_COMMANDS.includes(name) || OWNER_COMMANDS.includes(name),
		// A write whose own handler refuses every agent with its hand-off reaches that handler (phase 4's 3.2, F2).
		handlerRefuses: (name, input) => settings?.refusesAgent(name, input) === true,
		internal: (name) => INTERNAL_COMMANDS.includes(name),
		digest: async (value) => {
			const bytes = new TextEncoder().encode(canonical(value));
			const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
			return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
		},
		now: () => deps.clock?.now() ?? Date.now(),
		person: () => personOf({ actor: sessionActor(deps.auth, deps.clock) }),
	});
	// The port reads its list from here, so `apps` does not hold it (2.4); set once both chunks have loaded,
	// before any app, so a late load that fails sets nothing.
	deps.scope.callable = appCallable;
	/** The kernel's hearing of the adapter (phase 3 specification, 4.4), built below with what it needs. */
	let sessions: SessionSettle | undefined;
	/** Phase 4's settings (its section 3), built below once the workspace row's store is. */
	let settings: Settings | undefined;
	/** The person the shell is for: the last settle's once there is one, the adapter's until then (4.4, B2). */
	const shellPerson = (): string | undefined => {
		const settledFor = sessions?.person();
		return settledFor === undefined
			? personKey(sessionActor(deps.auth, deps.clock))
			: (settledFor ?? undefined);
	};
	// Keyed by the person the shell is for, once `session-settle` is built; the adapter's until then (4.4, B2).
	const quiet =
		deps.personal && personalWrites(deps.personal, deps.store, deps.viewState, shellPerson);
	// Agent members (phase 3 specification, 8): the `agent-member` table, which line 4 of the access decision reads
	// (3.3), and its commands. Boot's own `runBoot` journals the sponsor's read and the suspensions, top-level (4.4).
	const agentMembers = createAgentMembers({
		auth: deps.auth,
		identity: deps.identity,
		store: deps.store,
		scope: deps.scope,
		runBoot: deps.runBoot,
		replaying: () => deps.internals?.replaying === true,
		// The shell's window for restoring what was removed, the workspace's `trashDays` (documents specification, 4.1).
		undoWindowMs: async () => ((await stores.workspace())?.trashDays ?? 30) * 86_400_000,
		kit: { ...DOCUMENT_KIT, decideAccess, isOwner, membershipUnavailable },
	});
	await agentMembers.cache.load(deps.store);
	deps.scope.agents = agentMembers.cache;
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
	// Step 3's identity commands (4.6, 5.2); in `local` mode the Mock's capabilities are attached first (4.1).
	const identityCommands = await createIdentityCommands({
		auth: deps.auth,
		identity: deps.identity,
		kit: DOCUMENT_KIT,
	});
	// Step 4's account and member commands (5.1, 5.3, 5.4, 7.2), decided on the membership the kernel holds.
	const memberCommands = createMemberCommands({
		auth: deps.auth,
		identity: deps.identity,
		kit: { ...DOCUMENT_KIT, personKey, isOwner },
		membership: () => deps.scope.membership,
		agents: agentMembers,
		// Step 5's persona, built below: what other members see, and the active persona's id (step 5's deviation 8).
		personas: {
			presentationOf: (person) => persona.presentationOf(person),
			activeOf: async (person) => (await persona.recordOf(person))?.id ?? 'default',
		},
	});
	/** `appearance-set`'s handler, once the commands are built: `persona-set` applies a persona's through it (6.2). */
	let appearance: ZodCommandDefinition | undefined;
	// Persona (phase 3 specification, 6): the commands, each person's active persona, and its emphasis.
	const persona = createPersona({
		store: deps.store,
		scope: deps.scope,
		apps: deps.apps,
		personas: deps.personas ?? new Map(),
		icons: ICONS_V1,
		themes: APPEARANCE_THEMES,
		densities: APPEARANCE_DENSITIES,
		canOpen: (instance, project) => canOpen(deps.apps(), deps.scope, instance, project),
		setMain: (main) => setMain(deps.viewState, main),
		appearance: (patch, context) =>
			(appearance as ZodCommandDefinition).handler(patch, context) as Promise<CommandResult>,
		kit: DOCUMENT_KIT,
	});
	const lateScope = createLateScope({
		...deps,
		recorded: PROVIDER_COMMANDS,
		session: () => sessions,
		prepare: agentMembers.prepare,
		documents,
		async settle(name, call) {
			await editor?.settle(name, call);
			// The person's settings, and so the appearance the shell paints, follow a change of person (phase 4's 3.6).
			await settings?.follow();
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
		ports: deps.identityPorts ?? deps.ports,
		identityCommands,
		persona,
		agents: agentMembers,
		lateScope,
		drafts,
		ensureEditor: (project) => editorParts.ensure(project),
		// Phase 4's 7.2: a change of person withdraws the leaving person's pending confirmations, built below.
		personLeft: (person, context) => confirmations.withdraw(context, () => true, person),
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
	/** Whether the applied projection's host is the desktop, as `shell-info-get` says (phase 6 specification, 10.1). */
	let desktop = false;
	const stores = createShellStores(deps.store, deps.scope);
	const provider = deps.identity?.mode === 'provider';
	/**
	 * The deployment's host kind (phase 6 specification, 3.3), decided apart from its apps: a deployment the kernel was
	 * given names it at once, a version 4 file by its `host` and an older one `static`; with a boot, the projection
	 * stage B's loader reads names it. Unknown until then, and for good when the loader fails or the boot lists no app.
	 */
	let hostKind: 'static' | 'hosted' | 'desktop' | undefined = deps.deployment
		? ((deps.deployment as { host?: { kind: 'static' | 'hosted' | 'desktop' } }).host?.kind ??
			'static')
		: undefined;
	/**
	 * Section 13's hosted `provider` deployment, which refuses shared writes. Fails closed: a `provider` deployment whose
	 * host is not known yet, or never will be, counts as hosted, since a provider is served by the hosted server (phase
	 * 6's `DEPLOYMENT_DESKTOP_PROVIDER` and `DEPLOYMENT_PROVIDER_NEEDS_HOST`; the review's B2).
	 */
	const hosted = () => provider && (hostKind === undefined || hostKind === 'hosted');
	settings = createSettings({
		store: deps.store,
		scope: deps.scope,
		apps: deps.apps,
		state: deps.state,
		provider,
		person: shellPerson,
		// `personalRecordId`'s shape in `provider` mode, held equal to it by a unit; `local` keeps one record (3.6).
		recordId: (person) => (provider ? `loam.settings~${person ?? 'signed-out'}` : 'loam.settings'),
		hosted,
		replaying: () => deps.internals?.replaying === true,
		isOwner: (person) => isOwner(deps.scope.membership, person),
		canOpen: (instance, project) => canOpen(deps.apps(), deps.scope, instance, project),
		// `loam.documents.trashDays` written through to the workspace row (A-P2-2), which the trash's expiry reads, in
		// one batch with the setting's own row.
		async trashDays(days, context, also) {
			const row = await stores.workspace();
			const at = DOCUMENT_KIT.callNow(context);
			const by = personOf(context);
			await stores.putWorkspace(
				row
					? { ...row, trashDays: days, updatedAt: at, updatedBy: by }
					: {
							id: deps.scope.workspace.id,
							name: deps.scope.workspace.name,
							generation: applied ? deps.generation() : UNAPPLIED,
							trashDays: days,
							organization: null,
							tenant: null,
							createdAt: at,
							updatedAt: at,
							updatedBy: by,
						},
				also
			);
		},
		paletteIndex: createPaletteIndex,
		...(deps.limits ? { limits: deps.limits } : {}),
		kit: { ...DOCUMENT_KIT, archivedRefusal, personKey },
	});
	// The workspace's `loam.limits` read into the limits the kernel has enforced since boot (phase 4's section 11).
	await settings.readLimits();
	// `limit-usage-get` and boot's `store-usage-settle` (section 11), in `late-settings` beside the settings.
	const limitCommands = createLimitCommands({
		scope: deps.scope,
		apps: deps.apps,
		...(deps.limits ? { limits: deps.limits } : {}),
		isOwner: (person) => isOwner(deps.scope.membership, person),
		provider,
		// The owners' notice (section 11), through step 5's inbox, as the orphan notice is: in `local` mode to the one
		// person the shell is for, every person an owner; in `provider` mode none, until the owner roster is a server record.
		async notice(context, { instance, limit }) {
			if (deps.scope.membership.mode !== 'local') return 0;
			await notifications.shellNotice(
				context,
				shellPerson() ?? 'local',
				limitNotice(instance, limit)
			);
			return 1;
		},
		kit: { ...DOCUMENT_KIT, personKey },
	});
	// The first refusal of an instance in an hour, told through boot's journaled `limit-notice-push`, after the call that
	// met it: never in a replay, whose entries hold it, and never in `provider` mode (above).
	if (deps.limits) {
		deps.limits.notify = ({ instance, limit }) => {
			if (deps.internals?.replaying === true || deps.scope.membership.mode !== 'local') return;
			void Promise.resolve()
				.then(() => deps.runBoot('limit-notice-push', { instance, limit }))
				.catch(reportLate);
		};
	}
	// Phase 4's autonomy (its section 4), in `late-settings` beside the settings: stored, resolved and shown, never
	// enforced here (D41), so it is an input to no access decision (P4-E2).
	const autonomy = createAutonomy({
		store: deps.store,
		scope: deps.scope,
		apps: deps.apps,
		// The live registry's names (R4), so a host's own commands are the shell's too.
		commandNames: () => deps.commandNames?.() ?? SHELL_COMMAND_NAMES,
		internal: (name) => INTERNAL_COMMANDS.includes(name),
		isMutation: deps.isMutation,
		hosted,
		isOwner: (person) => isOwner(deps.scope.membership, person),
		// The rule `project-update { access }` decides by (D87, D110): a `team` instance still listed names it.
		teamListed: (project) => teamListed(deps.scope.workspaceApps.all(), project.slug),
		ownValue: (section, key, context) => (settings as Settings).ownValue(section, key, context),
		writeOwn: (section, key, entry, context) =>
			(settings as Settings).writeOwn(section, key, entry, context),
		replaying: () => deps.internals?.replaying === true,
		// The orphan notice (4.2, 10.2), through step 5's inbox: in `local` mode to the one person the shell is for, every
		// person an owner. In `provider` mode none, by the coordinator's ruling, until the owner roster is a server record
		// (phase 5's shell commands over MCP): the kernel holds only the people it has settled, and the boot settle's
		// membership is not journaled, so a replay could not send the same. The flags are stored and shown either way.
		async orphaned(rows, context) {
			if (deps.scope.membership.mode !== 'local') return;
			const owners = [shellPerson() ?? 'local'];
			const heard = orphanRecipients(rows, owners, (person, project) =>
				deps.scope.allows(
					{ kind: 'human', id: person },
					{ workspace: deps.scope.workspace.id, project }
				)
			);
			for (const [owner, theirs] of heard)
				await notifications.shellNotice(context, owner, orphanNotice(theirs));
		},
		kit: { ...DOCUMENT_KIT, personKey },
	});
	/** The autonomy rows the apps no longer back, or back again, flagged by boot's journaled settle; never in a replay. */
	const settleAutonomy = async (): Promise<void> => {
		if (deps.internals?.replaying === true) return;
		const changed = await autonomy.orphanChanges();
		if (changed.orphaned.length > 0 || changed.restored.length > 0)
			await deps.runBoot('autonomy-settle', changed);
	};
	const scoped = createScopeCommands({
		...deps,
		stores,
		lateScope,
		applied: () => applied,
		settingTarget: (target, context) => (settings as Settings).target(target, context),
	});
	/** The signed-in person's name, never an email; null for none, and the chrome says "for you" (6.6). */
	const personLabel = (): string | null => {
		const session = deps.auth.getSession();
		if (!sessionActor(deps.auth, deps.clock) || session.status !== 'authenticated') return null;
		const name = (session.user as { name?: unknown }).name;
		return typeof name === 'string' && name.trim() !== '' && !name.includes('@')
			? name.trim()
			: null;
	};
	// The push rate (phase 4 specification, 6.1, 10.2): the agents' toasts and every source's notices, one object.
	const pushRate = createPushRate();
	/**
	 * What a command is to an owner (6.4, 10.1): one of its own palette commands; a human or owner command, which no
	 * menu or notice offers; another owner's, or none the palette lists; or one whose input its schema refuses.
	 */
	const paletteVerdict = (
		owner: OverlayOwner,
		item: { command: string; input?: unknown }
	): ActionVerdict => {
		const { command } = item;
		if (HUMAN_COMMANDS.includes(command) || OWNER_COMMANDS.includes(command))
			return {
				kind: 'reserved',
				why: `'${command}' is a person's or an owner's command, which no menu or notice offers`,
			};
		const app = deps.apps().owners.get(command)?.instance;
		const own =
			!INTERNAL_COMMANDS.includes(command) &&
			!BOOT_ONLY.includes(command) &&
			(owner.kind === 'shell'
				? app === undefined && (SHELL_COMMAND_NAMES as readonly string[]).includes(command)
				: owner.kind === 'app' && app === owner.id);
		const definition = own
			? owner.kind === 'shell'
				? byName.get(command)
				: deps.apps().commands.find((each) => each.name === command)
			: undefined;
		if (!definition)
			return {
				kind: 'foreign',
				why: `'${command}' is not one of this owner's own palette commands`,
			};
		if (definition.expose?.palette === false)
			return { kind: 'foreign', why: `'${command}' is not listed in the palette` };
		const parsed = z.safeParse(definition.inputSchema as z.ZodMiniType, item.input ?? {});
		return parsed.success
			? { kind: 'own' }
			: { kind: 'invalid', why: parsed.error.issues[0]?.message ?? 'the input is invalid' };
	};
	// The inbox (phase 4 specification, section 10), in `late-settings` beside the settings it reads (3.7).
	const notifications = createNotifications({
		store: deps.store,
		workspace: () => deps.scope.workspace.id,
		provider,
		allows: (actor, scope) => deps.scope.allows(actor, scope),
		sourceOf(context) {
			const opener = openerOf(context, isHumanGesture);
			if (opener.kind === 'app')
				return { kind: 'app', instance: opener.owner.id, bucket: `app:${opener.owner.id}` };
			if (opener.kind === 'agent')
				return { kind: 'agent', id: opener.owner.id, bucket: opener.bucket };
			if (opener.kind === 'shell')
				return {
					kind: 'shell',
					bucket: `shell:${personOf({ actor: context.actor as AccessActorV1 })}`,
				};
			return { kind: 'none' };
		},
		humanGesture: isHumanGesture,
		actionCheck: (owner, action) =>
			paletteVerdict(owner.kind === 'shell' ? SHELL : { kind: 'app', id: owner.instance }, action),
		pushRate,
		limits: { agent: AGENT_PUSH_RATE, app: APP_PUSH_RATE },
		prefs: (context) => (settings as Settings).notificationPrefs(context),
		landsInInbox,
		overlays: deps.overlays,
		// The owner line step 3 gives a toast (6.6): an app's title as the rail shows it, told apart from a twin's, never
		// one that says "Loam"; an agent's name, for the person.
		fromOf: (source) =>
			source === 'shell'
				? undefined
				: source.startsWith('agent:')
					? { kind: 'agent', agent: source.slice('agent:'.length), person: personLabel() }
					: { kind: 'app', title: ownerTitle(deps.summaries(), source) },
		run: (name, input, fields) =>
			deps.run('palette', name, input, {}, fields as Parameters<typeof deps.run>[4]),
		kit: { ...DOCUMENT_KIT, archivedRefusal, personKey },
		answer: (row, answer, context) => confirmations.answer(row, answer, context),
		bucketOf: (context) => bucketOf(openerOf(context, isHumanGesture)),
	});
	/** Whether an app is active, or owns the active tab (6.1). */
	const appActive = async (instance: string): Promise<boolean> =>
		instance === deps.state.activeApp() || instance === (await editor?.owner());
	// Phase 4's confirmations (its 7.1, 7.2), in `late-settings` beside the inbox whose table holds a pending one.
	const confirmations: Confirmations = createConfirmations({
		store: deps.store,
		workspace: () => deps.scope.workspace.id,
		provider,
		overlays: deps.overlays,
		openerOf: (context) => openerOf(context, isHumanGesture),
		isActive: appActive,
		askedFor(command) {
			const owner = deps.apps().owners.get(command);
			const definition = owner && deps.apps().commands.find((each) => each.name === command);
			const prompt = (definition as { confirmPrompt?: string } | undefined)?.confirmPrompt;
			if (!owner || !definition || typeof prompt !== 'string' || owner.recorded) return undefined;
			return {
				prompt,
				instance: owner.instance,
				title: definition.title ?? command,
				danger: definition.destructive === true,
			};
		},
		paletteCommand(command) {
			if (command === 'palette-run' || INTERNAL_COMMANDS.includes(command)) return undefined;
			if (!deps.paletteRows().some((row) => row.name === command)) return undefined;
			const definition =
				byName.get(command) ?? deps.apps().commands.find((each) => each.name === command);
			const json = deps.paletteCommands?.().find((each) => each.name === command)?.inputSchema;
			return definition ? { definition, json } : undefined;
		},
		journaled: (command) => deps.journaled?.(command) ?? true,
		inputFault(command, input) {
			const parsed = z.safeParse(command.inputSchema as z.ZodMiniType, input);
			return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'it is invalid');
		},
		allows: (actor, scope) => deps.scope.allows(actor, scope),
		// The re-check past access (7.2): the command's app still enabled for the project and loaded, and a calling app
		// still the command's own (an app calls no other app's command in phase 4).
		served(command, caller, scope) {
			const owner = deps.apps().owners.get(command);
			if (!owner) return `'${command}' is no longer registered`;
			const app = deps.summaries().find((each) => each.instance === owner.instance);
			if (app?.state !== 'ready') return `'${owner.instance}' is not loaded`;
			const refused = canOpen(deps.apps(), deps.scope, owner.instance, scope.project);
			if (refused) return refused.error?.message ?? `'${owner.instance}' cannot open here`;
			if (caller !== undefined && caller !== owner.instance) return `'${caller}' may not call it`;
			return undefined;
		},
		appTitle: (instance) => ownerTitle(deps.summaries(), instance),
		projectName: (project) => deps.scope.project(project)?.name,
		personLabel,
		runNow: (iface, name, input, fields) =>
			deps.runNow?.(iface, name, input, fields) ??
			Promise.resolve(
				DOCUMENT_KIT.kernelFailure(
					'HUMAN_REQUIRED',
					'This kernel cannot run a confirmed call',
					'None: only a kernel runs one'
				)
			),
		runBoot: (name, input) => deps.runBoot(name, input) as Promise<CommandResult>,
		replaying: () => deps.internals?.replaying === true,
		noteInbox: (context) => deps.scope.note(context.traceId, { inbox: true }),
		archived: (command, scope) =>
			scope.project !== undefined &&
			deps.scope.projects.get(scope.project)?.status === 'archived' &&
			deps.isMutation(command),
		chainOf: documentChainOf,
		// Measured here rather than with first paint's `measureJson`, whose import would part first paint's chunks.
		inputOver(input) {
			const bound = deps.limits?.values().inputBytes;
			if (bound === undefined) return false;
			try {
				const json = JSON.stringify(input);
				return json === undefined || new TextEncoder().encode(json).length > bound;
			} catch {
				// No JSON form: over every limit (section 11's R2).
				return true;
			}
		},
		releaseQueue: (context) =>
			(context as unknown as Record<symbol, QueuedTicket | undefined>)[deps.queued]?.release?.(),
		digest: async (value) => {
			const bytes = new TextEncoder().encode(canonical(value));
			const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
			return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
		},
		kit: { ...DOCUMENT_KIT, archivedRefusal, personKey },
	});
	const byName: Map<string, ZodCommandDefinition> = new Map(
		[
			...boot,
			...createShellCommands({
				...deps,
				writeAppearance: (patch, context) => (settings as Settings).writeAppearance(patch, context),
				editorOwner: editor.owner,
				documentRows: rows,
				settingRows: () => settings?.rows,
				appTitle: (instance) => ownerTitle(deps.summaries(), instance),
				desktop: () => desktop,
				// A signed-out `provider` page lists only the signed-out commands, filtered before the search ranks (2.1, I4).
				paletteOnly: () =>
					deps.identity?.mode === 'provider' && deps.auth.getSession().status !== 'authenticated'
						? SIGNED_OUT_SET
						: undefined,
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
				pushRate,
				humanGesture: isHumanGesture,
				appTitle: (instance) => ownerTitle(deps.summaries(), instance),
				isNative: (instance) =>
					deps.summaries().find((app) => app.instance === instance)?.kind === 'native',
				// The signed-in person's name, never an email; null for none, and the chrome says "for you" (6.6).
				personLabel,
				// A menu offers only the owner's own commands that the palette lists (6.4): an app's, or the shell's own for
				// the shell, never a human, owner or internal one; each item's input checked against the command's schema.
				itemCheck: (owner, item) => {
					const verdict = paletteVerdict(owner, item);
					return verdict.kind === 'foreign' ? { kind: 'reserved', why: verdict.why } : verdict;
				},
				anchorFound: (owner, anchor) =>
					owner.kind !== 'agent' &&
					(deps.overlayAnchors?.resolve?.({ kind: owner.kind, id: owner.id }, anchor) ?? false),
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
			...identityCommands.commands,
			...memberCommands.commands,
			...persona.commands,
			...agentMembers.commands,
			...copilot.commands,
			...copilot.bootOnly,
			...settings.commands,
			...notifications.commands,
			...autonomy.commands,
			autonomy.settleCommand,
			...confirmations.commands,
			confirmations.settle,
			...limitCommands.commands,
			limitCommands.settleCommand,
			limitCommands.noticeCommand,
		].map((command) => [command.name, command])
	);
	// `toast-show` with the inbox's half (6.1, 3.7): a sticky toast also lands as a notice, and a muted app's is never
	// shown.
	byName.set(
		'toast-show',
		notifications.toastShow(byName.get('toast-show') as ZodCommandDefinition)
	);
	appearance = byName.get('appearance-set');
	// The person's own rail order on each row `app-list` gives, which the rail honours (phase 4 specification, 3.7; R8).
	const appList = byName.get('app-list') as ZodCommandDefinition;
	byName.set('app-list', {
		...appList,
		async handler(input: unknown, context: CommandContext) {
			const result = (await appList.handler(input, context)) as CommandResult<{
				apps: Array<{ instance: string; railRank?: number }>;
			}>;
			if (!result.success || !result.data) return result;
			// A read that fails leaves the rail in the workspace's order: the list itself stands.
			const order = (await settings?.railOrder(context).catch(() => undefined)) ?? [];
			if (order.length === 0) return result;
			return {
				...result,
				data: {
					...result.data,
					apps: result.data.apps.map((app) =>
						order.includes(app.instance) ? { ...app, railRank: order.indexOf(app.instance) } : app
					),
				},
			};
		},
	} as ZodCommandDefinition);
	// The kernel's wrapper of `auth-sign-in`, and a signed-out `provider` page's palette (phase 3 specification, 2.1, 4.6).
	byName.set(
		'auth-sign-in',
		identityCommands.signIn(byName.get('auth-sign-in') as ZodCommandDefinition)
	);
	// A persona's emphasis orders the palette's results, hiding none (phase 3 specification, 6.2).
	const categories = new Map(
		[...byName.values()].map((command) => [command.name, command.category])
	);
	byName.set(
		'palette-search',
		identityCommands.paletteSearch(
			persona.paletteSearch(
				byName.get('palette-search') as ZodCommandDefinition,
				deps.paletteRows,
				(name) => categories.get(name),
				paletteGroupOf
			),
			SIGNED_OUT_COMMANDS
		)
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
		internal: [
			...createPortRefusals(deps.limits),
			...copilot.internal,
			// The shell's strip under the title bar (phase 4 specification, 6.1).
			byName.get('overlay-global-set') as ZodCommandDefinition,
		],
		copilot,
		confirmations,
		writeThrough: writeThrough(deps.viewState, deps.state),
		// From `BOOT_ONLY` itself, so the boot registry can hold nothing else (2.2).
		bootOnly: BOOT_ONLY.flatMap((name) => byName.get(name) ?? []),
		lateScope,
		authGate: (held) =>
			createAuthGate(deps.auth, held, {
				identity: deps.identity ?? { mode: 'local' },
				clock: deps.clock,
				copied: sessions?.copied,
				after: (name) => {
					if (name.startsWith('auth-')) sessions?.afterAuth();
					else if (MEMBERSHIP_CHANGING_COMMANDS.includes(name)) sessions?.membershipChanged();
					// A sponsor a call found no member, as `member-remove`'s: their agent members are suspended by a
					// top-level `agent-member-settle` after its entry, and the next call waits for it (4.4, 8.3).
					if (agentMembers.pending()) sessions?.follow(() => agentMembers.flush());
					// A catalog installed or an instance changed: the autonomy rows it no longer backs, or backs again, are
					// settled by a top-level `autonomy-settle` after its entry (phase 4's 4.2; step 8's blocker 1).
					if (name === 'app-instance-refresh' || name === 'workspace-app-set')
						sessions?.follow(() => settleAutonomy());
				},
				before: (name, context) => sessions?.settleFirst(name, context),
			}),
		// An agent named as an app is, by instance or plugin id, would read in its owner line as that app (6.6).
		agentActor: (name) => {
			const named = agentActor(name);
			if (
				'kind' in named &&
				name !== undefined &&
				deps.summaries().some((app) => app.instance === name || app.app === name)
			) {
				return DOCUMENT_KIT.kernelFailure(
					'AGENT_NAME_RESERVED',
					`'${name}' names an app in this workspace`,
					'Name the agent something no app is named'
				);
			}
			return named;
		},
		mcpOptions: ({ commands, middleware }, listeners) => ({
			// A server holds no active scope and no person's session (3.3), so the commands that move them
			// are not served: a person's calls make them. Nor are the human commands, which only a person runs
			// (3.4: "not served over MCP means left out of `mcpOptions().commands`").
			commands: commands.filter(
				(command) =>
					!INTERNAL_COMMANDS.includes(command.name) &&
					!PERSON_SESSION.includes(command.name) &&
					!HUMAN_COMMANDS.includes(command.name) &&
					!OWNER_COMMANDS.includes(command.name) &&
					// The copilot's commands are served to no agent (phase 5 specification, 3.3).
					command.category !== 'copilot' &&
					// Phase 4 serves none of its commands over MCP (its section 13, Q5): its settings, nor an overlay, which
					// only a person, an app or the agent interface opens (6.1).
					command.category !== 'setting' &&
					// The shell's inbox by name (the reviews' item 9): an app's own command of that category stays served.
					!SHELL_NOTIFICATION_COMMANDS.has(command.name) &&
					// And its confirmations (phase 4's 7.2, section 13): no MCP caller raises one, so none reads one.
					!command.name.startsWith('confirmation-') &&
					!MCP_UNSERVED_OVERLAYS.has(command.name)
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
		async migrate(run) {
			try {
				await (settings as Settings).migrate(run);
			} catch (cause) {
				// As the apply: a failure fails the move alone, which the next stage B tries again.
				reportLate(cause);
			}
		},
		async apply(projection, run, settle) {
			desktop = projection.host?.kind === 'desktop';
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
			// Then the autonomy rows the apps no longer back, flagged, and those backed again, unflagged: journaled, and
			// only when there is some, so an unchanged workspace's journal is unchanged (phase 4 specification, 4.2).
			try {
				const changed = replaying ? undefined : await autonomy.orphanChanges();
				if (changed && (changed.orphaned.length > 0 || changed.restored.length > 0))
					await run('autonomy-settle', changed);
			} catch (cause) {
				reportLate(cause);
			}
			// Then each app's stored bytes counted afresh where its row differs, journaled, and only when one does, so an
			// unchanged workspace's journal is unchanged (section 11).
			try {
				const usage = replaying
					? []
					: await limitCommands.usageChanges(deps.clock?.now() ?? Date.now());
				if (usage.length > 0) await run('store-usage-settle', { usage });
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
			// A reload forgets the overlays, the push rate and the apps' session state, and signs the Mock out
			// (`host.ts`), so the boot's `auth-session-get` reads the same.
			deps.overlays.reset();
			pushRate.reset();
			// The call rates and the hour's refusals are the page's, as the push rate is (section 11).
			deps.limits?.reset();
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
				// The projection's host, whatever its apps do next (phase 4 specification, 13).
				if (loaded && 'deployment' in loaded) {
					hostKind =
						(loaded.deployment as { host?: { kind: 'static' | 'hosted' | 'desktop' } }).host
							?.kind ?? 'static';
					// The limits read again now the host is known: a hosted `provider` one keeps the defaults (R3).
					await settings?.readLimits();
				}
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
