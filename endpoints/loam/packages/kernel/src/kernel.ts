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
	type JournalEntry,
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
import { createTraces, type KernelRegistries } from './app-call-registry.js';
import { appearanceFrom } from './appearance.js';
import {
	type AppsRuntime,
	bootApps,
	byOrder,
	deploymentRefused,
	EMPTY_APPS,
	runtimeUnavailable,
} from './apps-runtime.js';
import { createBootCommands, takesProject } from './boot-commands.js';
import type { AdmissionV1 } from './call-grant.js';
import { INTERNAL_COMMANDS, type InboundParts, inboundCache, SHELL_EXPOSE } from './commands.js';
import { KERNEL_CONTEXT_FIELDS, type KernelCallFields } from './context-fields.js';
import { LoamKernelError } from './errors.js';
import { createJournalOrder, type NestedRerunV1 } from './journal-order.js';
import { finishRerun, type KernelPartsInternals, rerunFailure } from './replay-internals.js';

export type { KernelPartsInternals };

import {
	JOURNAL_REPLAY,
	type JournalFilterContext,
	journalsCommand,
	redactJournalRecord,
} from './journal-redact.js';

export { UNJOURNALED_COMMANDS } from './journal-redact.js';

import {
	createKeybindings,
	type KeybindingRegistry,
	needsInput,
	SHELL_KEYBINDINGS_V0,
	type ShellKeyAction,
} from './keybindings.js';
import type { LateParts } from './late/index.js';
import type { WrapperRedact } from './late/journal-wrappers.js';
import { firstLayoutOf } from './layout.js';
import { createKernelLimits, type KernelLimits } from './limits.js';
import type { OverlayStore } from './overlays/store.js';
import { type AccessActorV1, type MembershipV1, personKey, personOf } from './scope/access.js';
import { createScopeMiddleware, type LateScope, sessionActor } from './scope/middleware.js';
import { personalRecordId, personalStore } from './scope/personal.js';
import { type KernelPrincipalV1, NO_MEMBERS, type PrincipalInputV1 } from './scope/principal.js';
import type { ScopeV1 } from './scope/records.js';
import { CALL_MARK, createScopeRuntime, type QueuedTicket } from './scope/runtime.js';
import { registerShellState } from './shell-state.js';
import type {
	AppSummary,
	CallOptions,
	CommandSummary,
	ContextField,
	KernelEvent,
	KernelMcpOptions,
	KernelOptions,
	LoamKernel,
} from './types.js';

/**
 * The kernel's interfaces, one registry each: the person's, the agent's, and an app's call to another app's command
 * (phase 5 specification, 9.1), which runs on AFD's `createAppCallRegistry`.
 */
export type KernelInterface = 'palette' | 'agent' | 'apps';

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
 * Commands whose journal entries need `late/journal-wrappers.ts`'s `redactWrapped`: withheld from stage A's host
 * registry so a colliding `options.commands` entry can never journal nested inputs before `late/` loads or after a
 * late-load failure (#2107).
 */
const LATE_WRAPPED_COMMANDS: readonly string[] = [
	'palette-run',
	'prompt-settle',
	'notification-push',
	'notification-list',
	'notification-act',
	'overlay-list',
	'popover-open',
];

/**
 * The journal options (phase 0 specification, 6.4): failures recorded, every command outside
 * {@link UNJOURNALED_COMMANDS} (leaving out `notification-list` for standalone callers; #2105),
 * and `input.password` removed from `auth-sign-in` entries.
 */
export function kernelJournalOptions(
	onError: (error: Error) => void = reportKernelError
): JournalMiddlewareOptions {
	return {
		recordFailures: true,
		onError,
		filter: (command) => journalsCommand(command),
		redact: (record, { secret }) => redactJournalRecord(record, false, secret),
	};
}

/**
 * `redact` (and stage B's injected wrapper redaction, #2107), never failing: a record it cannot redact keeps no input
 * and no result data, so a mutation that ran keeps its entry, its secrets out (step 6's fourth round, 2).
 */
export function redactSafely(
	record: JournalRecord,
	redact: (record: JournalRecord) => JournalRecord,
	known: (command: string) => boolean,
	wrap?: WrapperRedact
): JournalRecord {
	try {
		const own = redact(record);
		return wrap ? wrap(own, redact, known) : own;
	} catch {
		// Lossy, so never replayed as if whole (fifth round's improvement): what it ran is not in it. Only the fields known
		// to hold no input, its name, timing, digest and whether it succeeded, with a fixed diagnostic of the kernel's own,
		// never the handler's code or message, which may hold the input (sixth round, B6).
		return {
			timestamp: record.timestamp,
			...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
			command: record.command,
			contextDigest: record.contextDigest,
			durationMs: record.durationMs,
			input: {},
			result: {
				success: record.result?.success === true,
				error: {
					code: 'JOURNAL_REDACTION_FAILED',
					message:
						'The journal could not redact this entry, so it keeps neither its input nor its result',
				},
			},
			unreplayable: true,
			unredacted: true,
		} as unknown as JournalRecord;
	}
}

export { redactJournalRecord };

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
function seqTrackingSink(
	sink: JournalSink,
	seqs: Map<string, number>,
	bound: (record: JournalRecord) => JournalRecord = (record) => record,
	accepted: (entry: JournalRecord) => void = () => {}
): JournalSink {
	return {
		async append(record) {
			const entry = await sink.append(bound(record));
			if (record.traceId !== undefined) seqs.set(record.traceId, entry.seq);
			// What the sink accepted and holds, never what it refused (step 6's eighth round, D2).
			accepted(entry);
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
export interface KernelParts extends InboundParts {
	kernel: LoamKernel;
	/**
	 * The current registries; {@link KernelParts.setAppCommands} replaces them. `boot` holds `BOOT_ONLY`'s
	 * commands alone, which only `BOOT_FIELDS` and a replay reach (phase 2 specification, 2.2); `apps`, AFD's
	 * `createAppCallRegistry`, an app's call to another app's command (phase 5 specification, 9.1).
	 */
	readonly registries: KernelRegistries;
	/**
	 * Build two new registries with `commands` as the apps' commands, over the same journal. In-flight
	 * calls finish on the old ones. Mounted discovery is what changes the set (phase 1 specification,
	 * 9.1).
	 */
	setAppCommands(commands: readonly ZodCommandDefinition[]): void;
	/** Register a mounted instance's catalog from a journal: a replay's discovery, with no network (7.6). */
	applyCatalog(instance: string, catalog: unknown): void;
	/** Forget page-only memory (overlays, selections, status, session) and re-read active scope (phase 2, 10). */
	resetSession(): Promise<void>;
	/** What phase 6's hosted lane passes to `createMcpHandler` (3.3); undefined until stage B loads `late/`. */
	mcpOptions(): KernelMcpOptions | undefined;
	/** Boot's own journaled work (`BOOT_FIELDS`): unqueued, `BOOT_ONLY` commands alone (2.2). */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
	/** The limits the kernel enforces (phase 4 specification, section 11): for tests, and the notice's seam. */
	readonly limits: KernelLimits;
	/** Principal-gated kernel (9.5): mint one request's principal; undefined on session-gated kernels. */
	readonly admitPrincipal?: (input: PrincipalInputV1) => KernelPrincipalV1;
	/** End a principal when its request ends (9.5): nothing made after it, a kept nested client included, runs under it. */
	readonly retirePrincipal?: (principal: KernelPrincipalV1) => void;
	/** A gated kernel's: `name` run as `principal` at `scope`, through the palette's chain (phase 6's 6.2, step 5). */
	readonly callAs?: (
		p: KernelPrincipalV1,
		name: string,
		input: unknown,
		scope: ScopeV1
	) => Promise<CommandResult>;
	/** A gated kernel's: `agent-member-settle` with `PROVIDER_HOOK_FIELDS`, journaled as `actor` (phase 3's A4, A8). */
	readonly runProviderHook?: (input: unknown, actor?: Actor) => Promise<CommandResult>;
}

/**
 * `createKernelParts`' options: the kernel's, and which gate its chain opens with (phase 3 specification, 9.5).
 * `'session'`, the default, is the browser's: afd-auth's middleware over the adapter's session. `'principal'` is the
 * server's: every registry opens with `principalGate`, so every call, top-level or nested, runs under the request's
 * principal and nothing reads the adapter; it needs `identity.mode` `provider`.
 */
export interface KernelPartsOptions extends KernelOptions {
	gate?: 'session' | 'principal';
}

/**
 * Marks the kernel's own calls on their context (9.5): boot's own work and the instance refresh, which a principal
 * gate passes with no principal. A symbol, so no caller's input or `_meta` can carry it; `execute` sets it last.
 */
export const KERNEL_OWN = Symbol();

/**
 * On a queued call's context, set by `run` when it queues the call: its ticket (phase 3 specification, 4.4),
 * which `late/` reads, given it by `createLateParts`, to refuse a call that would run as another person than it
 * was made as. Here, not in `scope/`, so first paint's shared chunk exports nothing new for it (13); exported for
 * tests.
 */
export const QUEUED = Symbol();

/** Build a kernel and expose its registries, for replay. Not part of the kernel interface. */
export async function createKernelParts(
	options: KernelPartsOptions,
	internals: KernelPartsInternals = {}
): Promise<KernelParts> {
	const { environment, boot } = options;
	// The deployment's identity (phase 3 specification, 2.1): `local` unless it says `provider`.
	const identity: IdentityV1 = options.identity ??
		(boot ?? (options.deployment as { identity?: IdentityV1 } | undefined))?.identity ?? {
			mode: 'local',
		};
	const provider = identity.mode === 'provider';
	// The server's gate (phase 3 specification, 9.5), loaded only here, so a browser's first paint holds none of it (13);
	// it refuses anything but `provider` mode, so line 0 never reads everyone as a member.
	const gated = options.gate === 'principal';
	const server = gated ? await import('./server/principal-gate.js') : undefined;
	server?.assertProvider(identity, LoamKernelError);
	const principals = server?.createPrincipalRegistry();
	// A `provider` kernel decides with the probe's members, or none: never `local`'s, where all are owners. A principal-
	// gated one holds none kernel-wide: each decision reads its call's principal (9.5).
	const membership: MembershipV1 = gated
		? NO_MEMBERS
		: options.membership?.mode === identity.mode
			? options.membership
			: { mode: identity.mode, members: new Map(), digest: '' };
	// The kernel's clock: the registries', the auth middleware's and the Mock's, which the host gives it (4.4).
	const clock = options.clock ? { now: options.clock } : undefined;
	const random = options.random ? { next: options.random } : undefined;
	/** The person the adapter reports now, on the kernel's clock (phase 3 specification, 4.4). */
	// A principal-gated kernel is for no one person: it never reads the adapter (9.5).
	const person = () => (gated ? undefined : personKey(sessionActor(options.auth, clock)));
	// In `provider` mode a person's records are theirs, for whoever is signed in at each read and write (4.5).
	const personal = provider && !gated ? personalStore(options.store, person) : undefined;
	const viewState = new ViewStateRegistry({ adapter: personal ?? options.store });
	// Signed out in `provider` mode the page paints the profile's last appearance (phase 4 specification, 3.6).
	const state = registerShellState(viewState, {
		lastFirst: () => provider && !gated && person() === undefined,
	});
	const workspace = boot?.workspace ??
		options.deployment?.workspace ??
		options.workspace ?? { id: 'personal', name: 'Personal' };
	const generation = boot?.generation ?? options.deployment?.generation ?? 'empty';
	const scope = createScopeRuntime(workspace, membership, principals?.of);
	/**
	 * By person, the active persona's id when it is not `default` (phase 3 specification, 6.1, 6.2): the `persona`
	 * context field of each call for that person. Stage A reads its person's; `late/` keeps it.
	 */
	const personas = new Map<string, string>();
	let lateScope: LateScope | undefined;
	// Only late commands and apps use the store, so it loads with the former.
	let overlays: OverlayStore | undefined;

	let apps: AppsRuntime = EMPTY_APPS;
	// The limits, enforced with their defaults from boot, whether or not `late-settings` ever reads the workspace's
	// (phase 4 specification, section 11): a replay's refusals are its journal's, so its rate takes nothing.
	const limits = createKernelLimits(() => internals.replaying === true);
	// Phase 4 specification, 8.1: the reserved chords' registry; `late-settings` gives it the resolver and overrides.
	const keybindings: KeybindingRegistry = createKeybindings(SHELL_KEYBINDINGS_V0, [], {
		project: () => scope.active().project !== undefined,
	});
	let commandSet = 0;

	/** `app-list`'s rows: the workspace's overrides, and whether each can open in the active scope (7.1). */
	const summaries = (): AppSummary[] => {
		// Signed out in `provider` mode the rail is empty: `app-list` answers none (phase 3 specification, 2.1).
		// The server holds no session: its `app-list` is the call's, decided by its chain (9.5).
		if (provider && !gated && person() === undefined) return [];
		const { project } = scope.active();
		return apps
			.summaries()
			.map((app): AppSummary => {
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

	const summarize = (registry: DirectCommandRegistry): CommandSummary[] => {
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

	// A shell command is the shell's exposure, but one that keeps itself from agents keeps that: the copilot's queries
	// are the palette's alone (phase 5 specification, 3.5).
	const shellExposed = (commands: readonly ZodCommandDefinition[]): ZodCommandDefinition[] =>
		commands.map((command) => ({
			...command,
			expose:
				command.expose?.agent === false ? { ...SHELL_EXPOSE, agent: false } : { ...SHELL_EXPOSE },
		}));
	// A host's own commands join with `late/` in `provider` mode, so its auth gate and line 0 decide them:
	// stage A's chain lets through what it holds (phase 3 specification, 2.1; the step 1 review's I8). Any host
	// command naming a wrapper-redacted command waits for `late/` too so it never bypasses wrapper redaction (#2107).
	let fixed: ZodCommandDefinition[] = [
		...shellExposed(bootCommands),
		...(provider ? [] : extra.filter((command) => !LATE_WRAPPED_COMMANDS.includes(command.name))),
	];
	const seqs = new Map<string, number>();
	const journals = (command: string, ctx?: JournalFilterContext) => journalsCommand(command, ctx);
	const order = createJournalOrder(
		journals,
		() => internals.replaying === true,
		(name) => mutations?.get(name) === true
	);
	// One journal middleware, shared by every registry, so they share one journal sequence. Each entry is held to
	// `loam.limits.journalEntryBytes` whole, after the redaction (phase 4 specification, section 11).
	const thrownTraces = new Set<string>();
	const clearThrown = (traceId: string) => {
		thrownTraces.delete(traceId);
	};
	const observeThrows: CommandMiddleware = async (_name, _input, context, next) => {
		try {
			return await next();
		} catch (error) {
			if (typeof context.traceId === 'string') thrownTraces.add(context.traceId);
			throw error;
		}
	};
	const journal = createJournalMiddleware(
		seqTrackingSink(
			options.journal,
			seqs,
			(record) =>
				limits.bound(
					record,
					(entry) =>
						(entry.context?.caller as string | undefined) ??
						apps.owners.get(entry.command)?.instance
				),
			// What the sink accepted, after the redaction and the bound, for a running wrapper's entry (seventh round, C2;
			// eighth round, D2; injected from `late/`, #2107).
			(entry) => {
				lateParts?.wrappers.appended(entry);
				order.appended(entry.traceId);
				// The bus catches up from the durable journal, which projects this entry in order (phase 5's 9.2).
				lateParts?.bus.appended(entry as JournalEntry);
			}
		),
		{
			...kernelJournalOptions(),
			filter: (command) => command === 'notification-list' || journalsCommand(command),
			redact: (record, { secret }) => {
				const threw = record.traceId !== undefined && thrownTraces.delete(record.traceId);
				const own = (each: JournalRecord) => apps.redact(redactJournalRecord(each, threw, secret));
				// A command no registry holds has no rule: its input in a wrapper is dropped (step 6's third round, B).
				return redactSafely(
					record,
					own,
					(command) => mutations?.has(command) === true,
					lateParts?.wrappers.redact
				);
			},
		}
	);

	let registries: KernelParts['registries'];
	let mutations: Map<string, boolean>;
	/** `BOOT_ONLY`'s commands, once `late/` has loaded: never in the palette's or the agent's registry. */
	let bootOnly: ZodCommandDefinition[] = [];
	let current: { commands: ZodCommandDefinition[]; middleware: CommandMiddleware[] };
	const scopeMiddleware = createScopeMiddleware({ scope, late: () => lateScope });
	/** The declared context fields: the kernel's own, and from stage B the copilot's `copilotSession`, `turn` and `trace`. */
	let contextFields: readonly ContextField[] = KERNEL_CONTEXT_FIELDS;
	/**
	 * The options objects the kernel made for the copilot's agent port (phase 5 specification, 3.2): the only ones whose
	 * `trace` it reads, and whose call runs as the reserved agent `copilot`. A caller's own options never are.
	 */
	const minted = new WeakSet<object>();
	/** By trace ID, the copilot's trace of a call while it runs, which every call nested in it carries (3.2, 5.3). */
	const traces = createTraces();
	/**
	 * The kernel's chain over `held`. The auth middleware closes over its `exclude` list, so it is a new
	 * instance each time: once `late/` has loaded, its auth gate, which in `provider` mode excludes only the
	 * signed-out and internal commands (phase 3 specification, 2.1); before, stage A's boot commands, all
	 * signed-out ones. Scope is last, so every refusal it makes is journaled, with the effective scope.
	 */
	// The server's: one gate for every registry, so a port call, a nested call and a handler's client go through the
	// same gate as the top-level call, and no afd-auth middleware reads the adapter (9.5).
	const principalGate =
		server && principals ? server.createPrincipalGate({ principals, own: KERNEL_OWN }) : undefined;
	const chain = (held: readonly ZodCommandDefinition[]): CommandMiddleware[] => {
		const gate =
			principalGate ??
			lateParts?.authGate(held) ??
			createAuthMiddleware(options.auth, { exclude: held.map((command) => command.name), clock });
		return [
			lateParts
				? lateParts.wrappers.observeGate(gate, clearThrown)
				: async (name, input, context, next) => {
						try {
							return await gate(name, input, context, next);
						} finally {
							if (typeof context.traceId === 'string') clearThrown(context.traceId);
						}
					},
			// Outside the journal: tracks hosted MCP calls that enter the chain without `execute` (#2117).
			order.track,
			// Per-caller journal gate (#2105): keep tape rewind on replayed entries; skip unjournaled calls otherwise.
			(name, input, context, next) =>
				!(JOURNAL_REPLAY in context) && !journals(name, context)
					? next()
					: journal(name, input, context, next),
			observeThrows,
			// Right inside the journal: a read waits for the writes it saw (#1936, #2117); `order.handler` is last.
			order.turn,
			// Right inside the journal, so the scope middleware's own writes are written through too (#861).
			...(lateParts ? [lateParts.writeThrough] : []),
			scopeMiddleware,
			// The copilot's gate, after access (phase 5 specification, 6.1's order), then the confirmations' (phase 4's 7.2,
			// F9): once `late/` has loaded.
			...(lateParts ? [lateParts.copilot.gate, lateParts.confirmations.gate] : []),
			order.handler,
		];
	};
	const build = (
		iface: Exclude<KernelInterface, 'apps'>,
		held: readonly ZodCommandDefinition[],
		middleware = chain(held)
	) =>
		createDirectRegistry([...held], {
			interface: iface,
			middleware,
			contextFields,
			...(clock ? { clock } : {}),
			...(random ? { random } : {}),
		});
	/** The apps' commands last given, gated or not, so a change of gate registers them again (phase 4's 5.3). */
	let appCommandsGiven: readonly ZodCommandDefinition[] = [];
	function setAppCommands(appCommands: readonly ZodCommandDefinition[]): void {
		appCommandsGiven = appCommands;
		// A gated app's commands are not registered (phase 4 specification, 5.3): presence, never permission.
		// Before `late/` loads, wrapper-redacted names are withheld here too so `setAppCommands` never bypasses `redactWrapped` (#2107).
		const commands = [
			...fixed,
			...appCommands.filter((command) => {
				if (!lateParts && LATE_WRAPPED_COMMANDS.includes(command.name)) return false;
				const instance = apps.owners.get(command.name)?.instance;
				return instance === undefined || lateParts?.appGated(instance) !== true;
			}),
		];
		mutations = new Map(
			[...commands, ...bootOnly].map((command) => [command.name, command.mutation === true])
		);
		const middleware = chain([...commands, ...bootOnly]);
		// The `apps` registry (phase 5's 9.1) is built again from these on the next app-to-app call (`appsRegistry`).
		registries = {
			palette: build('palette', commands, middleware),
			agent: build('agent', commands, middleware),
			boot: build('palette', bootOnly, middleware),
		};
		current = { commands, middleware };
		if (lateParts) lateInstalled = true;
		commandSet += 1;
	}

	/**
	 * The `apps` registry over the current commands (phase 5 specification, 9.1): AFD's `createAppCallRegistry`, from the
	 * `apps` chunk, whose grant check is `call-grant.ts`'s rule. Built on the first app-to-app call after a change of
	 * commands, so first paint holds none of it; undefined before the apps have loaded, when no app can call.
	 */
	function appsRegistry(): KernelRegistries['apps'] {
		if (registries.apps === undefined && apps.appCallRegistry) {
			registries.apps = apps.appCallRegistry([...current.commands], {
				middleware: current.middleware,
				contextFields,
				...(clock ? { clock } : {}),
				...(random ? { random } : {}),
			});
		}
		return registries.apps;
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

	let performShellKey: ((action: ShellKeyAction) => boolean) | undefined;

	/** The late commands join `fixed`. A chunk that fails is `lateFailure`; a name they repeat rejects. */
	async function loadLate(): Promise<void> {
		let parts: LateParts;
		let shell: ZodCommandDefinition[];
		try {
			const late = await import('./late/index.js');
			const { createOverlayStore, createLateParts } = late;
			addBootActions = late.withBootActions;
			overlays = createOverlayStore();
			// The kernel's options, with what it built: `late/` reads the adapter, the store, the host, the ports
			// and stage B's loader from them.
			parts = await createLateParts(bootCommands, {
				...options,
				limits,
				keybindings,
				performShellKey: (action) => performShellKey?.(action) ?? false,
				needsInput,
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
				personas,
				callAsCopilot(name, input, trace, asScope) {
					const made: CallOptions = { agent: 'copilot', scope: asScope, trace };
					minted.add(made);
					return run('agent', name, input, made);
				},
				agentCommands: () => registries.agent.listCommands(),
				paletteCommands: () => registries.palette.listCommands(),
				journaled: journals,
				// A top-level call past the queue, journaled as its own: a confirmed run, or `palette-run`'s (phase 4's 7.1, 7.2).
				runNow: (iface, name, input, fields) =>
					execute(iface, name, input, {}, fields as KernelCallFields),
				recordOrder: (traceId, resource) => order.store(traceId, resource),
				suspendOrder: (traceId) => order.suspend(traceId),
				emit,
				commandNames: () => [...(mutations?.keys() ?? [])],
				definitionOf: (name) => current.commands.find((command) => command.name === name),
				disposed: () => disposed,
				// An app's gate opened or closed: its commands registered again, or not (phase 4's 5.3).
				regate: () => setAppCommands(appCommandsGiven),
				// The server's kernel (9.5): no session logic, and the kernel's own calls marked under `KERNEL_OWN`.
				gated,
				own: KERNEL_OWN,
				instanceFields: INSTANCE_FIELDS,
			});
			// Disposed once the late parts were made, before this resumed: none of them is installed, the replay's callback
			// among them (step 6 merged with step 7).
			if (disposed) return;
			shell = [...parts.shell, ...parts.internal];
		} catch (cause) {
			// Disposed while it loaded: the late load ended there, as it should (step 7's sixth round, 2).
			if (disposed) return;
			reportKernelError(cause);
			lateFailure = lateUnavailable();
			// No override can be read: the reserved chords apply (R9, D66).
			keybindings.useDefaults();
			return;
		}
		// Validate name collisions before committing `lateParts` so a duplicate never leaves half-installed stage B state.
		checkNames([...shell, ...parts.bootOnly, ...extra]);
		lateParts = parts;
		// Stage B's catch-up of the bus from the durable journal (phase 5's 9.2): what a crash or a sink error left.
		void parts.bus.catchUp().catch(() => {});
		internals.recordedRun = (confirmation, command, result) =>
			parts.confirmations.recorded(confirmation, command, result);
		contextFields = [
			...KERNEL_CONTEXT_FIELDS,
			...parts.copilot.contextFields,
			...parts.confirmations.contextFields,
		];
		// The boot registry holds `BOOT_ONLY`'s names and nothing else: `late/` builds it from that list.
		bootOnly = parts.bootOnly;
		lateScope = parts.lateScope;
		fixed = [...shellExposed(shell), ...extra];
	}

	/** What `late/` gives the kernel's parts, once it has loaded. */
	let lateParts: LateParts | undefined;
	/** True once `setAppCommands` has rebuilt `current` with `lateParts` (so `mcpOptions` never snapshots stage A). */
	let lateInstalled = false;
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
	const pending: Partial<Record<KernelInterface, QueuedTicket>> = {};
	/**
	 * The fields of boot's own journaled work, an object no caller can name (phase 2 specification, 2.2).
	 * Step 4 runs `workspace-deployment-apply` with them from inside stage B, so they never join the queue,
	 * which waits for stage B and would never drain.
	 */
	const BOOT_FIELDS: KernelCallFields = {};
	/**
	 * The fields of `startInstances`' refresh, compared by reference like `BOOT_FIELDS` (9.5): a principal gate passes
	 * `app-instance-refresh` made with them, with no principal, and nothing else.
	 */
	const INSTANCE_FIELDS: KernelCallFields = {};
	/**
	 * The provider's removal hook's fields (phase 3's A8), compared by reference like `BOOT_FIELDS`: a principal gate passes
	 * `agent-member-settle` made with them, as the actor `execute` is given, and nothing else.
	 */
	const PROVIDER_HOOK_FIELDS: KernelCallFields = {};
	const runBoot = (name: string, input?: unknown) => run('palette', name, input, {}, BOOT_FIELDS);
	/**
	 * A palette call stage B makes itself, past the queue it holds, journaled as the person's (phase 4's 3.6), with the
	 * kernel's own `migration` field, which no caller can set and the journal keeps, so `setting-set` accepts `migrated`
	 * on that call and on its entry's replay alone.
	 */
	const runNow = (name: string, input: unknown) =>
		execute('palette', name, input, {}, { migration: true });
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
		if (disposed) return;
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
			if (disposed) return;
			const loadedApps = await loadApps({
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
				// What each call's store operations tell the journal's order (#1936, #2117).
				storeOrder: (traceId, instance) => order.store(traceId, `app:${instance}`),
				palette: () => ({
					commands: registries.palette.listCommands(),
					rows: summarize(registries.palette),
				}),
				runAs: (name, input, callOptions, fields, unqueued) =>
					unqueued
						? execute('palette', name, input, callOptions ?? {}, fields)
						: run('palette', name, input, callOptions, fields),
				// An app's push (phase 5's 9.2): `late/`'s bus, once it has loaded.
				onBusEvent: (instance, listener, boundScope) =>
					lateParts?.bus.subscribe(instance, listener, boundScope) ?? (() => {}),
				// An app's call to another app's command (phase 5's 9.1): queued as the person's, on the `apps` registry.
				runApps: (name, input, callOptions, fields) =>
					run('apps', name, input, callOptions, fields),
				clock: () => options.clock?.() ?? Date.now(),
				scope,
				limits,
				keysCollide: (a, b) => keybindings.collide(a, b),
				// The experiments' gates (phase 4's 5.3), which `late-settings` reads for the person the shell is for.
				gate: {
					open: (experiment) => lateParts?.experimentOpen(experiment) === true,
					gated: (instance) => lateParts?.appGated(instance) === true,
				},
			});
			// Disposed while `loadApps` ran (#1668): tear down the hosts it created rather than leaving them live.
			if (disposed) return void (await loadedApps.dispose());
			apps = loadedApps;
			keybindings.setApps(apps.keybindings);
		} catch (cause) {
			if (disposed) return;
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
			// A kernel disposed meanwhile goes no further: no store read or write after (step 7's sixth round, 2).
			await loadLate();
			if (disposed) return;
			await loadAppsStage();
			if (disposed) return;
			if (hydrated) {
				await state.hydrateLate();
				if (disposed) return;
				state.forgetUnlisted(new Set(apps.summaries().map((app) => app.instance)));
				if (!applying) apps.reconcileLayouts();
			}
			// Boot's own work before any late name is callable, so no call runs beside it, unqueued, and
			// none can lose a write to it (2.2). A replay's entries are what ran, an apply among them (10).
			if (applying) {
				registries = { ...registries, boot: build('palette', bootOnly) };
				await lateParts?.apply(applying, runBoot, hydrated);
				if (disposed) return;
				if (hydrated) apps.reconcileLayouts();
			}
			setAppCommands(apps.commands);
			// Stage B's first act before any queued call: `late/` hears the adapter from here (phase 3 specification, 4.4).
			await lateParts?.begin();
			if (disposed) return;
			// An old appearance record moves into the person's settings, once stage A has read it (phase 4's 3.6).
			if (hydrated) await lateParts?.migrate(runNow);
		})()
			.catch((cause: unknown) => {
				stageBError = cause;
				reportKernelError(cause);
				lateFailure = { ...lateUnavailable(), message: String((cause as Error)?.message ?? cause) };
				keybindings.useDefaults();
			})
			.finally(() => {
				stageBEnded = true;
				endStageB();
			});
		return stageB;
	}

	const listeners = new Set<(event: KernelEvent) => void>();
	const emit = (event: KernelEvent): void => {
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (error) {
				reportKernelError(error);
			}
		}
	};
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
		iface: KernelInterface,
		name: string,
		input: unknown,
		callOptions: CallOptions = {},
		fields: KernelCallFields = {}
	): Promise<CommandResult<T>> {
		const go = () => execute<T>(iface, name, input, callOptions, fields);
		if (
			disposed ||
			// Not truthiness: a frame's call may name its parent with an empty trace ID.
			fields.parent !== undefined ||
			fields === BOOT_FIELDS ||
			// The instance refresh is the kernel's own too: queued, its fields would lose the mark the gate reads (9.5).
			(gated && fields === INSTANCE_FIELDS) ||
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
		// A call that waits on a person's answer releases the queue (phase 4's 7.2): what comes after it, the answer and
		// the chrome's reads that draw the question among them, goes on in order (step 6's second round, 3).
		const released = new Promise<void>((resolve) => {
			ticket.release = resolve;
		});
		const tail: Promise<unknown> = Promise.race([mine, released]).then(drained, drained);
		queue = tail;
		return mine;
	}

	async function execute<T>(
		iface: KernelInterface,
		name: string,
		input: unknown,
		callOptions: CallOptions,
		fields: KernelCallFields,
		/** The provider hook's actor (A8), read only with `PROVIDER_HOOK_FIELDS`. */
		hookActor?: Actor
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
		// Only a call the caller's interface may make: one it is not exposed to runs, and is refused as it was live, so a
		// replay never answers it from an entry its handler could not have reached (#859). An app's call to another app's
		// command, on the `apps` registry, which the `apps` chunk builds: none before the apps load, when nothing runs.
		const runsOn = iface === 'apps' ? appsRegistry() : registries[iface];
		if (runsOn === undefined) return failure(runtimeUnavailable('no app has loaded yet'));
		let rerun: NestedRerunV1['rerun'] | undefined;
		if (fields.parent !== undefined && runsOn.hasCommand(name)) {
			const answered = internals.answerNested?.(fields.parent, name, input ?? {}, current.commands);
			if (answered && 'rerun' in answered) rerun = answered.rerun;
			else if (answered) {
				// A replay's answer from an entry of this name: an `apps` call has one only once its grant admitted it (9.1).
				// `call-grant.ts`'s `ADMISSION`, by `Symbol.for`, so first paint imports nothing of it.
				const admission = (fields as Record<symbol, AdmissionV1 | undefined>)[
					Symbol.for('dev.loam/admission')
				];
				if (iface === 'apps' && admission) admission.admitted = true;
				return answered as CommandResult<T>;
			}
		}
		// The agent interface runs as an agent, the session's person in its `onBehalfOf` (phase 3
		// specification, 3.1), named by `late/`, which has loaded since its calls wait for stage B; a port's or
		// nested call as its outer call's actor, copied.
		let actor = fields === PROVIDER_HOOK_FIELDS ? hookActor : fields.actor;
		// The copilot's trace (phase 5 specification, 3.2, 6.2): `app-call-registry.ts`'s `traces.of`.
		const mine = minted.has(callOptions);
		const trace = traces.of(iface, mine ? callOptions.trace : undefined, fields);
		if (iface === 'agent' && !actor && !gated) {
			// `copilot` is reserved: only the kernel's own options name it (3.2).
			const named = mine
				? ({ kind: 'agent', id: 'copilot' } as Actor)
				: (lateParts?.agentActor(callOptions.agent) ?? failure(lateFailure ?? lateUnavailable()));
			if ('success' in named) return finishRerun(rerun, named);
			actor = named;
		}
		// A handler's client kept past its traced call (phase 5's 5.3): refused, so none escapes taint.
		const late = fields.parent === undefined ? undefined : traces.refusal(fields.parent);
		if (late) return finishRerun(rerun, late as CommandResult<T>);
		const traceId = rerun?.traceId ?? `${traceBase}-${++calls}`;
		if (trace) traces.set(traceId, trace);
		const owned = apps.contextOf(name, input);
		// The call's person's persona, for the journal alone: no decision reads it (6.2). The person is the one the
		// chain will decide for: a copied actor's, else the session's, since the agent interface's actor gains its
		// `onBehalfOf` only in the chain (the step 5 review's B1). No read of the session while no one has a persona,
		// and a read that fails is no persona: the chain answers for the session itself.
		let persona: string | undefined;
		try {
			if (personas.size > 0)
				persona = personas.get(
					personKey(actor) ?? personOf({ actor: sessionActor(options.auth, clock) })
				);
		} catch {}
		// The requested scope, explicit per call: a surface's or a nested call's, the caller's option, or
		// the active scope at this moment. No registry or connection holds it (3.2).
		const asked = callOptions.scope;
		scope.seen.set(traceId, {});
		// On the server (9.5): a nested call's principal from the actor it copied, the one value every path under a request
		// carries, and only one this kernel minted for that very actor; a `principal` field is never read, so no path can
		// pair one person's actor with another's principal (the step 5 review's B1, step 7's half). The kernel's own
		// calls are marked last, so no field a caller passes can claim to be one.
		const principal = gated ? principals?.of(actor) : undefined;
		const own =
			fields === BOOT_FIELDS
				? 'boot'
				: fields === INSTANCE_FIELDS
					? 'instance'
					: gated && fields === PROVIDER_HOOK_FIELDS
						? 'hook'
						: undefined;
		const context: CommandContext & KernelCallFields & { [CALL_MARK]?: string } = {
			traceId,
			// A server's call holds no active scope, so it never moves one (phase 2's 3.3).
			...(gated ? {} : { [CALL_MARK]: fields.scope || asked ? 'run' : 'active' }),
			...(callOptions.signal !== undefined ? { signal: callOptions.signal } : {}),
			...owned,
			...fields,
			...(persona ? { persona } : {}),
			...rerun?.context,
			...(trace ? { copilotSession: trace.session, turn: trace.turn, trace } : {}),
			actor,
			scope:
				fields.scope ??
				(asked === 'workspace' ? { workspace: workspace.id } : asked) ??
				scope.active(),
		};
		if (gated) {
			(context as unknown as Record<symbol, unknown>)[KERNEL_OWN] = own;
			if (principal) context.principal = principal;
			else delete context.principal;
		} else delete context.principal;
		// `BOOT_ONLY`, both ways (2.2): its names are in the boot registry alone, which `BOOT_FIELDS` reach and
		// nothing else does, so a caller gets the palette's or the agent's own `COMMAND_NOT_FOUND`, and boot's
		// fields reach no other command.
		const registry = fields === BOOT_FIELDS || own === 'hook' ? registries.boot : runsOn;
		// A running wrapper's child, started whether or not its entry is ever written (step 6's eighth round; #2107).
		const wrappers = lateParts?.wrappers;
		const origin = (fields as { origin?: unknown }).origin;
		if (typeof origin === 'string') wrappers?.started(origin, 'origin');
		if (typeof fields.parent === 'string') wrappers?.started(fields.parent, 'parent');
		let result: CommandResult<T>;
		// A wrapper is tracked while it runs: its entry, written before `execute` returns, forwards its children's.
		const wrapping = wrappers?.begin(name, traceId) === true;
		const writes = mutations.get(name) === true || fields === BOOT_FIELDS;
		order.begin(traceId, writes, fields, own, name, {
			interface: iface,
			actor: context.actor,
			caller: context.caller,
		});
		try {
			result = await registry.execute<T>(name, input ?? {}, context);
		} catch (thrown) {
			rerun?.done(rerunFailure(thrown));
			throw thrown;
		} finally {
			order.end(traceId);
			traces.end(traceId);
			if (wrapping) wrappers?.end(traceId);
		}
		const seq = seqs.get(traceId);
		seqs.delete(traceId);
		const seen = scope.seen.get(traceId);
		scope.seen.delete(traceId);
		if (fields.parent !== undefined && seq !== undefined)
			internals.nestedUnrecorded?.(fields.parent, name);
		rerun?.done(result);
		const event: KernelEvent = {
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
		emit(event);
		// A change of person stops every copilot turn and removes its runtimes (phase 5 specification, 3.2). A `local`
		// deployment marks no `actorChanged` (its records are everyone's), yet its person changes on a sign-in or a
		// sign-out, which phase 5's step 2 decided to treat the same way: any that succeeds stops the copilot.
		if (
			event.actorChanged ||
			(event.success && (name === 'auth-sign-in' || name === 'auth-sign-out'))
		)
			void lateParts?.copilot.stopAll('session-changed');
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
		// The server sets the workspace without reading the adapter (9.5): it holds no active scope of anyone's.
		if (gated) {
			scope.setActive({ workspace: workspace.id });
			return;
		}
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
		// Stage B ran before the persisted state was read, so its settle is here (F3), and the appearance's move.
		if (applying) await lateParts?.settle(runBoot);
		await lateParts?.migrate(runNow);
	}
	// Stage A's person's active persona (6.1), so their first call carries it; a read that fails is `default`. The server
	// has no stage A person: it reads neither a persona nor an appearance (9.5).
	const who = gated ? undefined : personOf({ actor: sessionActor(options.auth, clock) });
	if (who !== undefined) {
		const active = (
			await options.store
				.get<{ value?: { active?: unknown } }>('settings', `loam.persona~${who}`)
				.catch(() => null)
		)?.value?.active;
		if (typeof active === 'string' && active !== 'default') personas.set(who, active);
		// Phase 4's settings (its 3.6): stage A paints from the person's `loam.settings`, and in `provider` mode, signed
		// out, from `loam.appearance.last`. Read as the persona is, from the view-state store's table; a read that fails is
		// none.
		const read = async (id: string) =>
			(await options.store.get<{ value?: unknown }>('settings', id).catch(() => null))?.value;
		const signedIn = person();
		if (!provider || signedIn !== undefined) {
			const id = provider ? personalRecordId('loam.settings', signedIn) : 'loam.settings';
			state.setOwnAppearance(appearanceFrom(await read(id), true));
		}
		if (provider)
			state.setLastAppearance(appearanceFrom(await read('loam.appearance.last'), false));
	}
	chooseScope(options.initialScope?.project);
	// The first frame has this project's layout: without it, a reload in a project paints the workspace's.
	await state.scopedLayoutId(
		scope.active().project,
		takesProject(() => apps)
	);

	const kernel: LoamKernel = {
		version: 6,
		bindShellKeys(perform) {
			performShellKey = perform;
			return () => {
				if (performShellKey === perform) performShellKey = undefined;
			};
		},
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
		// With the `apps` registry once the apps have loaded, so a replay runs an `apps` entry where it ran (9.1).
		get registries() {
			appsRegistry();
			return registries;
		},
		setAppCommands,
		applyCatalog: (instance, catalog) => apps.applyCatalog(instance, catalog),
		limits,
		async resetSession() {
			// A reload forgets the overlays and the apps' session state, and signs the Mock out (`host.ts`), so
			// the boot's `auth-session-get` reads the same: `late/`'s.
			await lateParts?.reload();
			chooseScope();
		},
		runBoot,
		...(server && principals
			? server.serverCalls(principals, execute as never, PROVIDER_HOOK_FIELDS)
			: {}),
		// Phase 6's, so `late/` builds it: before stage B has rebuilt `current`, nothing is served. A server's call
		// reaches this page's listeners as a call made here does (documents specification, 5.4).
		mcpOptions: () => (lateInstalled ? lateParts?.mcpOptions(current, listeners) : undefined),
		inboundCommands: inboundCache(() => [commandSet, current.commands, registries, apps]),
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
export async function createKernel(options: KernelOptions): Promise<LoamKernel> {
	return (await createKernelParts(options)).kernel;
}
