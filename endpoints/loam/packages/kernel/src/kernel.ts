/**
 * @fileoverview `createKernel`: two direct registries over the same commands and the same
 * journal, name refusal, the journal options and the view-state hydration (phase 0 specification,
 * 6.1 to 6.5), with the apps a deployment lists (phase 1 specification, 9.1).
 */

import { createAuthMiddleware } from '@lushly-dev/afd-auth';
import {
	type Actor,
	type CommandContext,
	type CommandError,
	type CommandMiddleware,
	type CommandResult,
	failure,
	type JournalRecord,
	type JournalSink,
	validateCommandName,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	createDirectRegistry,
	createJournalMiddleware,
	type DirectCommandRegistry,
	type JournalMiddlewareOptions,
} from '@lushly-dev/afd-server/direct';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { type BootProjectionV2, type IdentityV1, readBoot } from '@lushly-dev/loam-manifest';
import {
	type AppsRuntime,
	bootApps,
	byOrder,
	deploymentRefused,
	EMPTY_APPS,
	runtimeUnavailable,
} from './apps-runtime.js';
import { createBootCommands, takesProject } from './boot-commands.js';
import { INTERNAL_COMMANDS, SHELL_EXPOSE } from './commands.js';
import { KERNEL_CONTEXT_FIELDS, type KernelCallFields } from './context-fields.js';
import { LoamKernelError } from './errors.js';
import {
	createKeybindings,
	type KeybindingRegistry,
	needsInput,
	SHELL_KEYBINDINGS_V0,
} from './keybindings.js';
import type { LateParts } from './late/index.js';
import { firstLayoutOf } from './layout.js';
import type { OverlayStore } from './overlays.js';
import { type AccessActorV1, type MembershipV1, personKey } from './scope/access.js';
import { createScopeMiddleware, type LateScope, sessionActor } from './scope/middleware.js';
import { personalStore } from './scope/personal.js';
import { CALL_MARK, createScopeRuntime, type QueuedTicket } from './scope/runtime.js';
import { registerShellState } from './shell-state.js';
import type {
	AppSummaryV2,
	CallOptionsV3,
	CommandSummaryV1,
	KernelEventV3,
	KernelMcpOptions,
	KernelOptionsV3,
	LoamKernelV3,
} from './types.js';

/** The kernel's two interfaces, one registry each. */
export type KernelInterfaceV0 = 'palette' | 'agent';

/** Suggestion for a refused name (phase 0 specification, 6.1). */
export const COMMAND_NAME_SUGGESTION = 'Rename it domain-action, e.g. reports-create';

/**
 * Commands that answer from what stage B reads, so a call waits for stage B (phase 2 specification,
 * 2.2). Each is a late command, which stage A never registers, so `run`'s wait for a name it does not
 * hold already covers them, and `boot-apps.test.ts` holds that true.
 */
export const NEEDS_STAGE_B: readonly string[] = [
	'app-get',
	'app-command-list',
	'app-instance-list',
	'app-instance-refresh',
	'app-selection-get',
	'app-selection-set',
	'status-item-set',
];

/**
 * Commands the one journal middleware leaves out: `palette-search` runs per keystroke, and `scope-get` and
 * `section-get` at every re-read of the rail, reading memory and writing nothing, so an empty shell's boot
 * journals no more than it did (phase 2 specification, 4.3). `editor-selection-set` runs per selection
 * change, holds what a replay need not reproduce, and is a query (documents specification, 5.4).
 */
export const UNJOURNALED_COMMANDS: readonly string[] = Object.freeze([
	'palette-search',
	'scope-get',
	'section-get',
	'editor-selection-set',
]);

/**
 * The journal options (phase 0 specification, 6.4): failures recorded, every command but
 * `palette-search` (so `auth-*` is journaled and replayable), and `input.password` removed from
 * `auth-sign-in` entries. The clock and random tape stay on.
 */
export function kernelJournalOptions(
	onError: (error: Error) => void = reportKernelError
): JournalMiddlewareOptions {
	return {
		recordFailures: true,
		onError,
		filter: (command) => !UNJOURNALED_COMMANDS.includes(command),
		redact: redactJournalRecord,
	};
}

/** Remove `input.password` from an `auth-sign-in` record. */
export function redactJournalRecord(record: JournalRecord): JournalRecord {
	if (record.command !== 'auth-sign-in') return record;
	const input = record.input;
	if (typeof input !== 'object' || input === null || !('password' in input)) return record;
	const { password: _password, ...rest } = input as Record<string, unknown>;
	return { ...record, input: rest };
}

/** Refuse a bad or repeated name before any registry is built. */
function checkNames(commands: readonly ZodCommandDefinition[]): void {
	const seen = new Set<string>();
	for (const command of commands) {
		const check = validateCommandName(command.name);
		if (!check.valid) {
			const reason = check.reason ?? 'Command names are domain-action kebab-case';
			throw new LoamKernelError({
				code: 'COMMAND_NAME_INVALID',
				message: `Command name '${command.name}' is refused: ${reason}`,
				suggestion: COMMAND_NAME_SUGGESTION,
				details: { name: command.name, reason },
			});
		}
		if (seen.has(command.name)) {
			throw new LoamKernelError({
				code: 'COMMAND_NAME_DUPLICATE',
				message: `Command name '${command.name}' is registered twice`,
				suggestion: 'Give each command its own name; the shell commands are in SHELL_COMMAND_NAMES',
				details: { name: command.name, reason: 'Each command needs its own name' },
			});
		}
		seen.add(command.name);
	}
}

/**
 * A sink that passes every call through and remembers the `seq` it assigned to each trace ID,
 * so a kernel call learns whether, and where, it was journaled.
 */
function seqTrackingSink(sink: JournalSink, seqs: Map<string, number>): JournalSink {
	return {
		async append(record) {
			const entry = await sink.append(record);
			if (record.traceId !== undefined) seqs.set(record.traceId, entry.seq);
			return entry;
		},
		read: (range) => sink.read(range),
	};
}

/**
 * Report an error that must not change a call's result (a throwing listener, a failed journal
 * append) through the host's `reportError`, which a page shows as an `error` event.
 */
function reportKernelError(error: unknown): void {
	const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
	report?.(error);
}

/** What {@link createKernelParts} builds; `createKernel` and `replayKernel` share it. */
export interface KernelParts {
	kernel: LoamKernelV3;
	/**
	 * The current registries; {@link KernelParts.setAppCommands} replaces them. `boot` holds `BOOT_ONLY`'s
	 * commands alone, which only `BOOT_FIELDS` and a replay reach (phase 2 specification, 2.2).
	 */
	readonly registries: Record<KernelInterfaceV0 | 'boot', DirectCommandRegistry>;
	/**
	 * Build two new registries with `commands` as the apps' commands, over the same journal. In-flight
	 * calls finish on the old ones. Mounted discovery is what changes the set (phase 1 specification,
	 * 9.1).
	 */
	setAppCommands(commands: readonly ZodCommandDefinition[]): void;
	/** Register a mounted instance's catalog from a journal: a replay's discovery, with no network (7.6). */
	applyCatalog(instance: string, catalog: unknown): void;
	/**
	 * Forget what a page holds only in memory, as a reload does: overlays, selections, status values, and
	 * the session, since the Mock's does not survive a reload; the active scope is read again from its
	 * record, as stage A does (phase 2 specification, 10).
	 */
	resetSession(): Promise<void>;
	/** What phase 6's hosted lane passes to `createMcpHandler` (phase 2 specification, 3.3). */
	/** Undefined until stage B has loaded `late/`, which builds it. */
	mcpOptions(): KernelMcpOptions | undefined;
	/**
	 * Boot's own journaled work, with `BOOT_FIELDS`: never queued behind stage B, and only a `BOOT_ONLY`
	 * command, from the boot registry; any other name answers `COMMAND_NOT_FOUND` (2.2).
	 */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
}

/** What only `replayKernel` asks of a kernel. */
export interface KernelPartsInternals {
	/**
	 * A nested call's answer from the journal, in place of running it (7.6). Undefined runs it: a refusal
	 * before the middleware leaves no entry, and answers the same again. A recorded call (`replay:
	 * 'recorded'`) that passes validation then stops in the scope middleware as `REPLAY_NOT_RECORDED`,
	 * before its handler could reach a server, and the outer call is reported diverged (phase 2
	 * specification, 10 and 12).
	 */
	answerNested?(parent: string, name: string, input: unknown): CommandResult | undefined;
	/** A nested call ran and reached the journal, so the record has no answer for what it did. */
	nestedUnrecorded?(parent: string, name: string): void;
	/** A replay: stage B's own journaled work is skipped, since the entries are what ran (10). */
	replaying?: boolean;
	/** The journal's actor for a trace ID, undefined for one it does not hold (10). */
	actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
	/** The replay's Mock set to the person a `session-settle` entry records (phase 3 specification, 4.4). */
	drive?(person: string | null): void;
	/** At a reload, the replay's Mock set to the person the page's first settle names (4.4). */
	startPage?(): void;
}

/**
 * On a queued call's context, set by `run` when it queues the call: its ticket (phase 3 specification, 4.4),
 * which `late/` reads, given it by `createLateParts`, to refuse a call that would run as another person than it
 * was made as. Here, not in `scope/`, so first paint's shared chunk exports nothing new for it (13); exported for
 * tests.
 */
export const QUEUED = Symbol();

/** Build a kernel and expose its registries, for replay. Not part of the kernel interface. */
export async function createKernelParts(
	options: KernelOptionsV3,
	internals: KernelPartsInternals = {}
): Promise<KernelParts> {
	const { environment, boot } = options;
	// The deployment's identity (phase 3 specification, 2.1): `local` unless it says `provider`.
	const identity: IdentityV1 = options.identity ??
		(boot ?? (options.deployment as { identity?: IdentityV1 } | undefined))?.identity ?? {
			mode: 'local',
		};
	const provider = identity.mode === 'provider';
	// A `provider` kernel decides with the probe's members, or none: never `local`'s, where all are owners.
	const membership: MembershipV1 =
		options.membership?.mode === identity.mode
			? options.membership
			: { mode: identity.mode, members: new Map(), digest: '' };
	// The kernel's clock: the registries', the auth middleware's and the Mock's, which the host gives it (4.4).
	const clock = options.clock ? { now: options.clock } : undefined;
	const random = options.random ? { next: options.random } : undefined;
	/** The person the adapter reports now, on the kernel's clock (phase 3 specification, 4.4). */
	const person = () => personKey(sessionActor(options.auth, clock));
	// In `provider` mode a person's records are theirs, for whoever is signed in at each read and write (4.5).
	const personal = provider ? personalStore(options.store, person) : undefined;
	const viewState = new ViewStateRegistry({ adapter: personal ?? options.store });
	const state = registerShellState(viewState);
	const workspace = boot?.workspace ??
		options.deployment?.workspace ??
		options.workspace ?? { id: 'personal', name: 'Personal' };
	const generation = boot?.generation ?? options.deployment?.generation ?? 'empty';
	const scope = createScopeRuntime(workspace, membership);
	let lateScope: LateScope | undefined;
	// Only late commands and apps use the store, so it loads with the former.
	let overlays: OverlayStore | undefined;

	let apps: AppsRuntime = EMPTY_APPS;
	let keybindings: KeybindingRegistry = createKeybindings(SHELL_KEYBINDINGS_V0, []);
	let commandSet = 0;

	/** `app-list`'s rows: the workspace's overrides, and whether each can open in the active scope (7.1). */
	const summaries = (): AppSummaryV2[] => {
		const { project } = scope.active();
		return apps
			.summaries()
			.map((app): AppSummaryV2 => {
				const {
					title = app.title,
					order = app.order,
					enabled,
				} = scope.workspaceApps.get(app.instance)?.overrides ?? {};
				return {
					...app,
					title,
					order,
					state: enabled === false ? 'disabled' : app.state,
					available: enabled !== false && scope.opensIn(app.instance, app.scopeLevels, project),
				};
			})
			.sort(byOrder);
	};

	const summarize = (registry: DirectCommandRegistry): CommandSummaryV1[] => {
		// A command of an app that cannot open here stays callable by name, and is left out (11.2).
		const hidden = lateParts?.hidden(summaries());
		return registry
			.listCommands()
			.filter(
				(command) =>
					!INTERNAL_COMMANDS.includes(command.name) &&
					!hidden?.has(apps.owners.get(command.name)?.instance as string)
			)
			.map((command) => {
				const keybinding = keybindings.keybindingFor(command.name);
				const instance = apps.owners.get(command.name)?.instance;
				return {
					name: command.name,
					...(command.title !== undefined ? { title: command.title } : {}),
					description: command.description,
					mutation: command.mutation === true,
					// The `apps` chunk's whole answer for an app's command, the shape alone for the rest (2.1).
					needsInput: apps.owners.get(command.name)?.needsInput ?? needsInput(command.inputSchema),
					...(keybinding !== undefined ? { keybinding } : {}),
					...(instance !== undefined ? { instance } : {}),
				};
			});
	};

	const bootCommands = createBootCommands({
		state,
		environment,
		auth: options.auth,
		apps: () => apps,
		summaries,
		scope,
	});
	const extra = options.commands ?? [];

	// Name refusal comes first: a bad name never reaches a registry.
	checkNames([...bootCommands, ...extra]);

	const shellExposed = (commands: readonly ZodCommandDefinition[]): ZodCommandDefinition[] =>
		commands.map((command) => ({ ...command, expose: { ...SHELL_EXPOSE } }));
	// A host's own commands join with `late/` in `provider` mode, so its auth gate and line 0 decide them:
	// stage A's chain lets through what it holds (phase 3 specification, 2.1; the step 1 review's I8).
	let fixed: ZodCommandDefinition[] = [...shellExposed(bootCommands), ...(provider ? [] : extra)];
	const seqs = new Map<string, number>();
	// One journal middleware, shared by every registry, so they share one journal sequence.
	const journal = createJournalMiddleware(seqTrackingSink(options.journal, seqs), {
		...kernelJournalOptions(),
		redact: (record) => apps.redact(redactJournalRecord(record)),
	});

	let registries: Record<KernelInterfaceV0 | 'boot', DirectCommandRegistry>;
	let mutations: Map<string, boolean>;
	/** `BOOT_ONLY`'s commands, once `late/` has loaded: never in the palette's or the agent's registry. */
	let bootOnly: ZodCommandDefinition[] = [];
	let current: { commands: ZodCommandDefinition[]; middleware: CommandMiddleware[] };
	const scopeMiddleware = createScopeMiddleware({ scope, late: () => lateScope });
	/**
	 * The kernel's chain over `held`. The auth middleware closes over its `exclude` list, so it is a new
	 * instance each time: once `late/` has loaded, its auth gate, which in `provider` mode excludes only the
	 * signed-out and internal commands (phase 3 specification, 2.1); before, stage A's boot commands, all
	 * signed-out ones. Scope is last, so every refusal it makes is journaled, with the effective scope.
	 */
	const chain = (held: readonly ZodCommandDefinition[]): CommandMiddleware[] => [
		lateParts?.authGate(held) ??
			createAuthMiddleware(options.auth, { exclude: held.map((command) => command.name), clock }),
		journal,
		scopeMiddleware,
	];
	const build = (
		iface: KernelInterfaceV0,
		held: readonly ZodCommandDefinition[],
		middleware = chain(held)
	) =>
		createDirectRegistry([...held], {
			interface: iface,
			middleware,
			contextFields: KERNEL_CONTEXT_FIELDS,
			...(clock ? { clock } : {}),
			...(random ? { random } : {}),
		});
	function setAppCommands(appCommands: readonly ZodCommandDefinition[]): void {
		const commands = [...fixed, ...appCommands];
		mutations = new Map(
			[...commands, ...bootOnly].map((command) => [command.name, command.mutation === true])
		);
		const middleware = chain([...commands, ...bootOnly]);
		registries = {
			palette: build('palette', commands, middleware),
			agent: build('agent', commands, middleware),
			boot: build('palette', bootOnly, middleware),
		};
		current = { commands, middleware };
		commandSet += 1;
	}

	let lateFailure: CommandError | undefined;
	/** `late/`'s `withBootActions`, once that chunk has loaded. */
	let addBootActions: typeof import('./late/index.js').withBootActions | undefined;
	const lateUnavailable = (): CommandError => ({
		code: 'LATE_COMMANDS_UNAVAILABLE',
		message: 'The late commands did not load',
		suggestion: 'Reload to try again, and check that the deployment serves its assets',
		retryable: true,
	});

	/** The late commands join `fixed`. A chunk that fails is `lateFailure`; a name they repeat rejects. */
	async function loadLate(): Promise<void> {
		let shell: ZodCommandDefinition[];
		try {
			const late = await import('./late/index.js');
			const { createOverlayStore, createLateParts } = late;
			addBootActions = late.withBootActions;
			overlays = createOverlayStore();
			// The kernel's options, with what it built: `late/` reads the adapter, the store, the host, the ports
			// and stage B's loader from them.
			const parts = await createLateParts(bootCommands, {
				...options,
				viewState,
				state,
				overlays,
				apps: () => apps,
				paletteRows: () => summarize(registries.palette),
				commandSet: () => commandSet,
				scope,
				generation: () => generation,
				isMutation: (name) => mutations.get(name) === true,
				internals,
				summaries,
				run,
				runBoot,
				queued: QUEUED,
				stageA: chosen,
				clock,
				identity,
				personal,
				pending,
			});
			lateParts = parts;
			shell = [...parts.shell, ...parts.internal];
			// The boot registry holds `BOOT_ONLY`'s names and nothing else: `late/` builds it from that list.
			bootOnly = parts.bootOnly;
			lateScope = parts.lateScope;
		} catch (cause) {
			reportKernelError(cause);
			lateFailure = lateUnavailable();
			return;
		}
		checkNames([...shell, ...bootOnly, ...extra]);
		fixed = [...shellExposed(shell), ...extra];
	}

	/** What `late/` gives the kernel's parts, once it has loaded. */
	let lateParts: LateParts | undefined;
	/** The projection stage B keeps in the workspace store, once it is read (4.1). */
	let applying: import('./late/index.js').AppliedProjection | undefined = options.deployment;

	let stageB: Promise<void> | undefined;
	let stageBEnded = false;
	/**
	 * The calls queued behind stage B, as a chain: each runs once stage B has ended and the call before
	 * it has finished, so they run and are journaled in the order they were made. Running them together
	 * would not: the journal appends after hashing the context with WebCrypto, which finishes in any order.
	 */
	let queue: Promise<unknown> | undefined;
	/** The actor stage A chose the scope for, undefined in it signed out; none before it has (4.4). */
	let chosen: [AccessActorV1] | undefined;
	/** By interface, the `auth-*` call queued last, until `late/` sees it end (phase 3 specification, 4.4). */
	const pending: Partial<Record<KernelInterfaceV0, QueuedTicket>> = {};
	/**
	 * The fields of boot's own journaled work, an object no caller can name (phase 2 specification, 2.2).
	 * Step 4 runs `workspace-deployment-apply` with them from inside stage B, so they never join the queue,
	 * which waits for stage B and would never drain.
	 */
	const BOOT_FIELDS: KernelCallFields = {};
	const runBoot = (name: string, input?: unknown) => run('palette', name, input, {}, BOOT_FIELDS);
	let endStageB: () => void = () => {};
	const appsReady = new Promise<void>((resolve) => {
		endStageB = resolve;
	});
	/** Stage A has hydrated, so stage B reads only what it registers new, one record at a time. */
	let hydrated = false;
	/** Why stage B ended early, so `createKernel` can reject on a refused name when it ran inside it. */
	let stageBError: unknown;

	/** The apps, once the late commands are in. One app's failure, or the runtime's, never stops the shell. */
	async function loadAppsStage(): Promise<void> {
		const listsApps = boot ? boot.apps.length > 0 : (options.deployment?.apps.length ?? 0) > 0;
		if (!listsApps) {
			// An empty projection with a row of another generation unlists what the row's listed (4.1).
			applying = { generation, workspace, apps: [] };
			return;
		}
		// Every entry is listed `failed` with the reason, from its boot record, or from the projection's
		// own entry when the host gave no boot.
		const listed = boot ?? (readBoot(options.deployment) as BootProjectionV2);
		const fallBack = (failure: CommandError) => {
			const listedOnly = bootApps(listed, { failure });
			apps =
				addBootActions?.(
					listedOnly,
					new Map(listed.apps.map((app) => [app.instance, app.parts])),
					state,
					overlays
				) ?? listedOnly;
		};
		if (lateFailure) {
			fallBack(runtimeUnavailable(lateFailure.message));
			return;
		}
		// `late/` has loaded: it reads them, and says why it could not (13).
		const loaded = await (lateParts as LateParts).readApps();
		if (!('deployment' in loaded)) {
			fallBack(
				'refused' in loaded
					? deploymentRefused(loaded.refused)
					: runtimeUnavailable(loaded.unavailable)
			);
			return;
		}
		const { deployment } = loaded;
		applying = deployment;
		try {
			const { loadApps } = await import('./apps/index.js');
			apps = await loadApps({
				deployment,
				...(loaded.ports !== undefined ? { ports: loaded.ports } : {}),
				store: options.store,
				taken: new Set(fixed.map((command) => command.name)),
				state,
				viewState,
				overlays: overlays as OverlayStore,
				owners: () => apps.owners,
				isMutation: (name) => mutations.get(name) === true,
				setCommands: setAppCommands,
				palette: () => ({
					commands: registries.palette.listCommands(),
					rows: summarize(registries.palette),
				}),
				runAs: (name, input, callOptions, fields, unqueued) =>
					unqueued
						? execute('palette', name, input, callOptions ?? {}, fields)
						: run('palette', name, input, callOptions, fields),
				clock: () => options.clock?.() ?? Date.now(),
				scope,
			});
			keybindings = createKeybindings(SHELL_KEYBINDINGS_V0, apps.keybindings);
		} catch (cause) {
			// A chunk that does not load refuses every app, and never the shell (D66).
			reportKernelError(cause);
			fallBack(runtimeUnavailable(String((cause as Error)?.message ?? cause)));
		}
	}

	/**
	 * Stage B, once (phase 2 specification, 2.2): the late commands, then each package's manifest, read
	 * and validated, and the app commands. After stage A, a manifest that differs from its boot record
	 * wins, keeping what `hydrate` loaded where it still validates. It never rejects.
	 */
	function startApps(): Promise<void> {
		stageB ??= (async () => {
			await loadLate();
			await loadAppsStage();
			if (hydrated) {
				await state.hydrateLate();
				state.forgetUnlisted(new Set(apps.summaries().map((app) => app.instance)));
				apps.reconcileLayouts();
			}
			// Boot's own work before any late name is callable, so no call runs beside it, unqueued, and
			// none can lose a write to it (2.2). A replay's entries are what ran, an apply among them (10).
			if (applying) {
				registries = { ...registries, boot: build('palette', bootOnly) };
				await lateParts?.apply(applying, runBoot, hydrated);
			}
			setAppCommands(apps.commands);
			// Stage B's first act before any queued call: `late/` hears the adapter from here (phase 3 specification, 4.4).
			await lateParts?.begin();
		})()
			.catch((cause: unknown) => {
				stageBError = cause;
				reportKernelError(cause);
				lateFailure = { ...lateUnavailable(), message: String((cause as Error)?.message ?? cause) };
			})
			.finally(() => {
				stageBEnded = true;
				endStageB();
			});
		return stageB;
	}

	const listeners = new Set<(event: KernelEventV3) => void>();
	const traceBase = `loam-${Math.floor(options.clock?.() ?? Date.now()).toString(36)}`;
	let calls = 0;
	let disposed = false;

	/**
	 * A name stage A does not hold waits for stage B, so a chord or an agent's first call runs a moment
	 * later, and so does any call made while one waits, so calls run and are journaled in the order they
	 * were made. `NEEDS_STAGE_B`'s names are all late, so stage A never registers them and they wait here
	 * too. A nested call (an app's, through `runAs`) runs inside its parent, which may hold the queue, so
	 * it never joins it, and nor does boot's own work (`BOOT_FIELDS`), which stage B runs from inside
	 * `startApps`. The trade-off: while the queue drains, one slow call holds every call behind it. Once
	 * stage B has ended and the queue is empty, calls run concurrently again, as before phase 2. A queued
	 * call carries its ticket, so `late/` refuses it `SESSION_CHANGED` if the person changed while it waited
	 * (phase 3 specification, 4.4).
	 */
	function run<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV3 = {},
		fields: KernelCallFields = {}
	): Promise<CommandResult<T>> {
		const go = () => execute<T>(iface, name, input, callOptions, fields);
		if (
			disposed ||
			// Not truthiness: a frame's call may name its parent with an empty trace ID.
			fields.parent !== undefined ||
			fields === BOOT_FIELDS ||
			// The agent interface waits for stage B, whose `late/` names its actor (phase 3 specification, 3.1).
			!(queue || (!stageBEnded && (iface === 'agent' || !mutations.has(name))))
		)
			return go();
		const ticket: QueuedTicket = { person: person(), behind: pending[iface] };
		if (name.startsWith('auth-')) pending[iface] = ticket;
		// `go` reads `fields` when the queue reaches it: the caller's, with the ticket.
		fields = { ...fields, [QUEUED]: ticket } as KernelCallFields;
		const mine = (queue ?? startApps()).then(go);
		const drained = () => {
			if (queue === tail) queue = undefined;
		};
		const tail: Promise<unknown> = mine.then(drained, drained);
		queue = tail;
		return mine;
	}

	async function execute<T>(
		iface: KernelInterfaceV0,
		name: string,
		input: unknown,
		callOptions: CallOptionsV3,
		fields: KernelCallFields
	): Promise<CommandResult<T>> {
		if (disposed) {
			return failure({
				code: 'KERNEL_DISPOSED',
				message: 'The kernel was disposed',
				suggestion: 'Create a new kernel with createKernel',
				retryable: false,
			});
		}
		if (lateFailure && !mutations.has(name)) return failure(lateFailure);
		if (fields.parent !== undefined) {
			const answered = internals.answerNested?.(fields.parent, name, input);
			if (answered) return answered as CommandResult<T>;
		}
		// The agent interface runs as an agent, the session's person in its `onBehalfOf` (phase 3
		// specification, 3.1), named by `late/`, which has loaded since its calls wait for stage B; a port's or
		// nested call as its outer call's actor, copied.
		let { actor } = fields;
		if (iface === 'agent' && !actor) {
			const named =
				lateParts?.agentActor(callOptions.agent) ?? failure(lateFailure ?? lateUnavailable());
			if ('success' in named) return named;
			actor = named;
		}
		const traceId = `${traceBase}-${++calls}`;
		const owned = apps.contextOf(name, input);
		// The requested scope, explicit per call: a surface's or a nested call's, the caller's option, or
		// the active scope at this moment. No registry or connection holds it (3.2).
		const asked = callOptions.scope;
		scope.seen.set(traceId, {});
		const context: CommandContext & KernelCallFields & { [CALL_MARK]: string } = {
			traceId,
			[CALL_MARK]: fields.scope || asked ? 'run' : 'active',
			...(callOptions.signal !== undefined ? { signal: callOptions.signal } : {}),
			...owned,
			...fields,
			actor,
			scope:
				fields.scope ??
				(asked === 'workspace' ? { workspace: workspace.id } : asked) ??
				scope.active(),
		};
		// `BOOT_ONLY`, both ways (2.2): its names are in the boot registry alone, which `BOOT_FIELDS` reach and
		// nothing else does, so a caller gets the palette's or the agent's own `COMMAND_NOT_FOUND`, and boot's
		// fields reach no other command.
		const registry = fields === BOOT_FIELDS ? registries.boot : registries[iface];
		const result = await registry.execute<T>(name, input ?? {}, context);
		const seq = seqs.get(traceId);
		seqs.delete(traceId);
		const seen = scope.seen.get(traceId);
		scope.seen.delete(traceId);
		if (fields.parent !== undefined && seq !== undefined) {
			internals.nestedUnrecorded?.(fields.parent, name);
		}
		const event: KernelEventV3 = {
			command: name,
			interface: iface,
			success: result.success,
			// Boot's own work (`BOOT_FIELDS`) is a boot-only command, each a mutation, which `mutations`, built
			// before `late/` loaded, does not hold yet.
			mutation: mutations.get(name) ?? fields === BOOT_FIELDS,
			...(seq !== undefined ? { seq } : {}),
			...(fields.caller !== undefined ? { caller: fields.caller } : {}),
			...(owned.instance !== undefined ? { instance: owned.instance } : {}),
			...seen,
		};
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (error) {
				reportKernelError(error);
			}
		}
		// After journaling, and never in the journal's copy. A person's or agent's call only: a seq counts
		// every app's calls, which a view must not see, and a handler may return a nested result as its own.
		return seq === undefined || fields.caller !== undefined
			? result
			: { ...result, metadata: { ...result.metadata, 'dev.loam/seq': seq } };
	}

	/**
	 * The active scope, as stage A chooses it (6.3): the URL's project if the cache has it and the actor may
	 * enter it, otherwise the persisted record's on the same two tests, otherwise the workspace. In memory:
	 * a change is journaled in stage B, by `scope-set`.
	 */
	function chooseScope(slug?: string | null): void {
		const actor = sessionActor(options.auth, clock);
		// Stage A's person, whose records it read: `late/` settles from them (phase 3 specification, 4.4).
		chosen = [actor];
		// `null`: the URL names the workspace itself, so the persisted project is not entered (6.3).
		const project = (
			slug === null ? [] : [slug && scope.project(slug)?.id, state.scopeProject()]
		).find((id) => id && scope.allows(actor, { workspace: workspace.id, project: id }));
		scope.setActive(project ? { workspace: workspace.id, project } : { workspace: workspace.id });
	}

	setAppCommands([]);
	// One `list` per table, so a call costs no store read (4.1, 4.3).
	await Promise.all(
		[scope.projects, scope.workspaceApps].map((cache) => cache.load(options.store))
	);
	if (boot) {
		// Stage A: each app's layout record from its boot record, then the persisted state, before the
		// first frame. Nothing but display comes of a record (2.2).
		for (const app of boot.apps) {
			const { initial, declared } = firstLayoutOf(app.parts, app.layout);
			state.registerAppLayout(app.instance, initial, declared);
		}
		await state.hydrate();
		hydrated = true;
		apps = bootApps(boot);
	} else {
		// No boot, as in every test and the test kit: stage B runs before `createKernel` resolves, so
		// `createKernel({ deployment, ports })` keeps phase 1's meaning, and so does a replay.
		await startApps();
		// A refused name rejects `createKernel` here, as phase 0 has it; in the background it is kept.
		if (stageBError instanceof LoamKernelError) throw stageBError;
		await state.hydrate();
		apps.reconcileLayouts();
		// Stage B ran before the persisted state was read, so its settle is here (F3).
		if (applying) await lateParts?.settle(runBoot);
	}
	chooseScope(options.initialScope?.project);
	// The first frame has this project's layout: without it, a reload in a project paints the workspace's.
	await state.scopedLayoutId(
		scope.active().project,
		takesProject(() => apps)
	);

	const kernel: LoamKernelV3 = {
		version: 3,
		call: (name, input, callOptions) => run('palette', name, input, callOptions),
		listCommands: () => summarize(registries.palette),
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		agent: {
			call: (name, input, callOptions) => run('agent', name, input, callOptions),
			listCommands: () => summarize(registries.agent),
		},
		startApps,
		appsReady,
		get lateFailure() {
			return lateFailure;
		},
		appPort: (instance) => apps.port(instance),
		listKeybindings: () => keybindings.list(state.activeApp()),
		async startInstances() {
			await lateParts?.startInstances();
		},
		async flush() {
			if (!disposed) await viewState.flush();
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			// Stage B will not run now, so nothing waiting on it is left waiting.
			stageB ??= appsReady;
			endStageB();
			listeners.clear();
			await apps.dispose();
			await viewState.destroy();
		},
	};
	return {
		kernel,
		get registries() {
			return registries;
		},
		setAppCommands,
		applyCatalog: (instance, catalog) => apps.applyCatalog(instance, catalog),
		async resetSession() {
			// A reload forgets the overlays and the apps' session state, and signs the Mock out (`host.ts`), so
			// the boot's `auth-session-get` reads the same: `late/`'s.
			await lateParts?.reload();
			chooseScope();
		},
		runBoot,
		// Phase 6's, so `late/` builds it: before that chunk has loaded, nothing is served. A server's call
		// reaches this page's listeners as a call made here does (documents specification, 5.4).
		mcpOptions: () => lateParts?.mcpOptions(current, listeners),
	};
}

/**
 * Create the kernel: check every command name, build the palette and agent registries over the same
 * commands and journal, and hydrate the view state from `store` before resolving. With `boot` it resolves
 * after stage A, holding only the boot commands and the boot records, and `startApps` runs stage B: the
 * late commands and the deployment's packages (phase 2 specification, 2.2). With no `boot` it runs stage
 * B first. A bad app never rejects it: it is reported in `app-list`.
 *
 * @throws LoamKernelError `COMMAND_NAME_INVALID` for a name that is not domain-action kebab-case,
 *   `COMMAND_NAME_DUPLICATE` for a name given twice
 */
export async function createKernel(options: KernelOptionsV3): Promise<LoamKernelV3> {
	return (await createKernelParts(options)).kernel;
}
