/**
 * @fileoverview Experiments (phase 4 specification, section 5; D119, D155): each loaded app's `ui.experiments`, a
 * person's own enablements in their `loam.settings` and the owners' in the workspace store's `experiment-enablement`
 * table, the commands `experiment-list`, `experiment-check`, `experiment-enable` and `experiment-disable`, and boot's
 * own `experiment-settle`, which removes experiments when a manifest is applied: their enablements deleted, and the
 * removal kept as its time, which voids every enablement made before it, so a re-shipped id revives nothing. The
 * gates read here decide presence, never permission: no experiment is an input to any access decision (P4-E2). An
 * unload never loses a dirty tab (R14). In the `late-settings` chunk, beside the settings.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { type ExperimentV1, gatesOf } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { workspaceNotice, workspaceToken } from './experiment-notices.js';
import {
	compareSemver,
	type DeclaredExperimentV1,
	EXPERIMENT_ID,
	type ExperimentByV1,
	type ExperimentStateV1,
	enablementChanged,
	experimentOn,
	isSemver,
	isStaleVersion,
	LISTED_STAGES,
	live,
	overdue,
	type PersonEnablementV1,
	settledAway,
	type WorkspaceEnablementV1,
} from './experiment-rules.js';
import { isHumanGesture, type StoredSettingV1, sharedRecordUnavailable } from './setting-rules.js';

/** The workspace store's table of the owners' enablements (5.2). */
export const EXPERIMENT_TABLE = 'experiment-enablement';

/** The shell's section the experiments are listed in, which only `experiment-*` writes (3.7). */
export const EXPERIMENTS_SECTION = 'loam.experiments';

/** Each command's output budget, in UTF-8 bytes (D115): at most 8 experiments an app, each at most about 600 bytes. */
export const EXPERIMENT_OUTPUT_BUDGETS: Readonly<
	Record<string, { defaultBytes: number; maxBytes: number }>
> = Object.freeze({
	'experiment-list': { defaultBytes: 65_536, maxBytes: 65_536 },
	'experiment-check': { defaultBytes: 1_024, maxBytes: 1_024 },
	'experiment-enable': { defaultBytes: 1_024, maxBytes: 1_024 },
	'experiment-disable': { defaultBytes: 1_024, maxBytes: 1_024 },
});

/** What this module reads of first paint's modules, given by `late/` (phase 3 specification, 13). */
export type ExperimentsKit = Pick<
	DocumentKit,
	'define' | 'success' | 'kernelFailure' | 'z' | 'callNow' | 'personOf'
> & { personKey(actor: AccessActorV1): string | undefined };

/** A row of a listing (5.4). */
export interface ExperimentRowV1 {
	fullId: string;
	owner: string;
	title: string;
	changes: string;
	ends: string;
	stage: DeclaredExperimentV1['stage'];
	on: boolean;
	by: ExperimentByV1;
	/** Whether the workspace has it on, for the `changes` shown now. */
	workspace: boolean;
	/** Whether an enablement was made for other `changes` than those shown now, so it counts as off. */
	changed: boolean;
	/** Whether `ends` has passed (`EXPERIMENT_OVERDUE`); nothing turns off on a date. */
	overdue: boolean;
}

/** A tab holding an unsaved change of one of an app's document types (R14). */
export interface UnsavedTabV1 {
	tab: string;
	document: string;
}

export interface ExperimentsDeps {
	store: DataAdapter;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	/** Whether the deployment's identity is `provider`: `hidden: true` is for an author in `local` alone (5.1). */
	provider: boolean;
	/** Section 13's hosted `provider` deployment, which refuses a workspace enablement. */
	hosted(): boolean;
	/** Whether `person` is an owner, on the membership `call` reads: on the server its principal's (phase 3 specification, 7.1 and 9.5). */
	isOwner(person: string | undefined, call: { actor?: unknown }): boolean;
	/** The person the shell is for, whose gates the shell shows; undefined signed out in `provider` mode. */
	person(): string | undefined;
	/** One section's entries of `person`'s `loam.settings`, read from the store at each call. */
	ownSection(person: string | undefined, section: string): Promise<Record<string, StoredSettingV1>>;
	/** The call's person's own key in their `loam.settings`, written one at a time with the settings' writes. */
	writeOwn(
		section: string,
		key: string,
		entry: StoredSettingV1 | undefined,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined>;
	/** `sha256:<hex>` of a text (5.2). */
	digest(text: string): Promise<string>;
	/** A notice from the shell to `person` in their inbox (5.2, 10.2); absent, none is pushed. */
	notice?(
		context: CommandContext,
		person: string,
		fields: { title: string; body: string; tone: 'info' | 'warning' }
	): Promise<void>;
	/**
	 * The tabs holding an unsaved change of `instance`'s document types, the shell's person's (R14). A tab whose
	 * document cannot be read is counted as `instance`'s, so a failed read never lets an unload lose it.
	 */
	unsavedTabs(instance: string): Promise<UnsavedTabV1[]>;
	/** Whether the shell's person has a pending confirmation for one of `instance`'s commands (R14 at boot). */
	pending(instance: string): Promise<boolean>;
	/** Close every clean open tab of `instance`'s document types when its experiment holds it out (#2113). */
	closeTabs?(instance: string, context: CommandContext | undefined): Promise<{ dirty: boolean }>;
	/** Unload `instance` (R14): closes clean tabs (returning false if a tab became dirty mid-read), cancels dialogs, withdraws confirmations, closes if active. */
	unload(instance: string, context: CommandContext | undefined): Promise<boolean>;
	/** An app's gate opened or closed: its commands are registered again, or not. */
	regate(): void;
	/** Notify other tabs that experiment enablements changed (#2108). */
	onTabWrite?(person?: string): void;
	/** Whether a replay is running (skip live `noticedHeld` dedupe so repeated journaled `defer` notices replay identically). */
	replaying?(): boolean;
	kit: ExperimentsKit;
}

export interface Experiments {
	commands: ZodCommandDefinition[];
	/** Boot's own `experiment-settle`, run at the manifest's apply: in `BOOT_ONLY`, so no caller reaches it. */
	settleCommand: ZodCommandDefinition;
	/** Whether `experiment` is on for the person the shell is for, as last read: the gates of surfaces and sections. */
	open(experiment: string): boolean;
	/**
	 * Whether `instance`'s app gate holds it out now: closed, and no dirty tab keeps it loaded (R14). Until the gates are
	 * first read, every app with a gate is held out: a failed read fails closed.
	 */
	gated(instance: string): boolean;
	/**
	 * What a settle would do now (5.1): the experiments to remove, the person's own enablements made for other `changes`,
	 * whether the person has workspace changes to be told of (5.2), and, once the gates are read, the held-out apps
	 * whose pending confirmations must end `withdrawn` (R14). With `postRefresh: true`, skips manifest-drop planning
	 * (`removed`/`declared`) so a post-refresh withdraw/defer pass never retries a commit-time skipped removal.
	 */
	settleChanges(options?: { postRefresh?: boolean }): Promise<SettleInput | undefined>;
	/**
	 * Read the gates again for the person the shell is for, and apply them: at stage B, after a change of person, after
	 * each enablement's write, after another tab's write (#2108), and after each call while an unload waits on a dirty
	 * tab. `context` is the call's, which the notices of 5.2 and the unload's withdrawals are made in; returns true when
	 * any gate or app state changed.
	 */
	refresh(context?: CommandContext): Promise<boolean>;
	/** Whether the gates have been read at least once for this kernel. */
	ready(): boolean;
	/** Stop any further in-flight refreshes from mutating state after kernel disposal (#2108). */
	stop(): void;
	/** Whether an app unload waits on a dirty tab, so each call's end must read the gates again (R14). */
	waiting(): boolean;
}

/** `experiment-settle`'s input (5.1, 5.2, R14, #2114, #2108). */
interface SettleInput {
	removed: string[];
	changed: string[];
	tell: boolean;
	withdraw: string[];
	declared: Array<{ plugin: string; ids: string[]; version?: string }>;
	defer?: string[];
}

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** The key of a person's last-told tokens in their slot (5.2), which no full id can be. */
const TOLD_KEY = '~told';

/** The person's enablement out of a stored setting, or undefined for anything malformed. */
function personEnablementOf(entry: StoredSettingV1 | undefined): PersonEnablementV1 | undefined {
	const value = entry?.value as Partial<PersonEnablementV1> | undefined;
	if (typeof value !== 'object' || value === null) return undefined;
	if (typeof value.on !== 'boolean' || typeof value.digest !== 'string') return undefined;
	return {
		on: value.on,
		digest: value.digest,
		...(typeof value.told === 'string' ? { told: value.told } : {}),
		...(typeof entry?.updatedAt === 'number' ? { at: entry.updatedAt } : {}),
	};
}

/** Everything one decision reads, from the store and the manifests alone (5.3's replay). */
interface Snapshot {
	experiments: Map<string, DeclaredExperimentV1>;
	/** The plugins whose manifest was read, and those the deployment lists at all (5.1's settle). */
	plugins: Set<string>;
	/** Each read plugin's manifest version (`manifest.plugin.version`), for stale-shell detection (#2114). */
	pluginVersions: Map<string, string>;
	listed: Set<string>;
	rows: Map<string, WorkspaceEnablementV1>;
	/** Each removed experiment, by the time of its last removal. */
	removals: Map<string, number>;
	/** By plugin, the ids (and highest manifest version, #2114) declared at the last settle. */
	declaredBefore: Map<string, { ids: string[]; version?: string }>;
	own: Map<string, PersonEnablementV1>;
	told: Record<string, string>;
}

export function createExperiments(deps: ExperimentsDeps): Experiments {
	const { store, scope, kit } = deps;
	const { z } = kit;

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		details?: Record<string, unknown>
	) => kit.kernelFailure(code, message, suggestion, details ? { details } : {});

	/** Where a person's enablements sit in their record: per workspace, since an experiment is a deployment's app's. */
	const slot = () => `${scope.workspace.id}/${EXPERIMENTS_SECTION}`;
	const rowKey = (fullId: string) => `${scope.workspace.id}/${fullId}`;
	const removalKey = (fullId: string) => `${scope.workspace.id}/~removed/${fullId}`;
	const declaredKey = (plugin: string) => `${scope.workspace.id}/~declared/${plugin}`;

	/** The digests of `changes`, each computed once (5.2). */
	const digests = new Map<string, string>();
	const digestOf = async (changes: string): Promise<string> => {
		let held = digests.get(changes);
		if (held === undefined) {
			held = await deps.digest(changes);
			digests.set(changes, held);
		}
		return held;
	};

	const manifestOf = (instance: string) => {
		try {
			return deps.apps().port(instance).manifest;
		} catch {
			return undefined;
		}
	};

	/**
	 * Read everything for `person`: every experiment the loaded apps declare (the first instance of a plugin's: a second
	 * ready instance of one native or view app cannot exist), `listedOnly` leaving out a workspace-disabled instance's;
	 * the workspace's rows and removals; the person's own enablements and last-told tokens.
	 */
	async function snapshot(person: string | undefined, listedOnly = false): Promise<Snapshot> {
		const experiments = new Map<string, DeclaredExperimentV1>();
		const plugins = new Set<string>();
		const pluginVersions = new Map<string, string>();
		const listed = new Set<string>();
		for (const app of deps.apps().summaries()) {
			listed.add(app.app);
			if (listedOnly && scope.workspaceApps.get(app.instance)?.overrides.enabled === false)
				continue;
			const manifest = manifestOf(app.instance);
			if (!manifest) continue;
			const plugin = manifest.plugin.id;
			plugins.add(plugin);
			if (typeof manifest.plugin.version === 'string' && !pluginVersions.has(plugin))
				pluginVersions.set(plugin, manifest.plugin.version);
			for (const experiment of (manifest.ui?.experiments ?? []) as ExperimentV1[]) {
				const fullId = `${plugin}.${experiment.id}`;
				if (experiments.has(fullId)) continue;
				experiments.set(fullId, {
					...experiment,
					fullId,
					owner: app.instance,
					plugin,
					digest: await digestOf(experiment.changes),
				});
			}
		}
		const [table, section] = await Promise.all([
			store.list<WorkspaceEnablementV1 & { kind?: string; removedAt?: number }>(EXPERIMENT_TABLE),
			deps.ownSection(person, slot()),
		]);
		const rows = new Map<string, WorkspaceEnablementV1>();
		const removals = new Map<string, number>();
		const declaredBefore = new Map<string, { ids: string[]; version?: string }>();
		for (const row of table.data as Array<
			WorkspaceEnablementV1 & {
				kind?: string;
				removedAt?: number;
				plugin?: string;
				ids?: unknown;
				version?: unknown;
			}
		>) {
			// A row keyed for another workspace, or not as this table keys it, is never read.
			if (row.workspace !== scope.workspace.id) continue;
			if (row.kind === 'declared') {
				if (
					typeof row.plugin === 'string' &&
					row.id === declaredKey(row.plugin) &&
					Array.isArray(row.ids)
				)
					declaredBefore.set(row.plugin, {
						ids: row.ids.filter((id): id is string => typeof id === 'string'),
						...(typeof row.version === 'string' ? { version: row.version } : {}),
					});
				continue;
			}
			if (typeof row.experiment !== 'string') continue;
			if (row.kind === 'removed') {
				if (row.id === removalKey(row.experiment) && typeof row.removedAt === 'number')
					removals.set(row.experiment, row.removedAt);
			} else if (row.id === rowKey(row.experiment) && typeof row.digest === 'string') {
				rows.set(row.experiment, row);
			}
		}
		const own = new Map<string, PersonEnablementV1>();
		for (const [id, entry] of Object.entries(section)) {
			const enablement = id === TOLD_KEY ? undefined : personEnablementOf(entry);
			if (enablement) own.set(id, enablement);
		}
		const told = section[TOLD_KEY]?.value;
		return {
			experiments,
			plugins,
			pluginVersions,
			listed,
			rows,
			removals,
			declaredBefore,
			own,
			told:
				typeof told === 'object' && told !== null && !Array.isArray(told)
					? (told as Record<string, string>)
					: {},
		};
	}

	const stateIn = (read: Snapshot, id: string): ExperimentStateV1 =>
		experimentOn(
			read.experiments.get(id),
			read.own.get(id),
			read.rows.get(id),
			read.removals.get(id)
		);

	const personOfCall = (context: CommandContext): string | undefined =>
		kit.personKey(context.actor as AccessActorV1) ?? (deps.provider ? undefined : 'local');

	/** The app a port's call is made by, whose own experiments are the only ones it may check (5.4). */
	function callerPlugin(context: CommandContext): string | undefined {
		const caller = (context as KernelFieldContext).caller;
		if (caller === undefined) return undefined;
		return manifestOf(caller)?.plugin.id ?? `\u0000${caller}`;
	}

	/** An id by its syntax, before any key is built from it (5.1): never a slash, a space or anything else. */
	const badId = (experiment: string | undefined) =>
		experiment !== undefined && !EXPERIMENT_ID.test(experiment)
			? fail(
					'VALIDATION_ERROR',
					`'${experiment}' is not an experiment's full id`,
					'Give it as <plugin>.<id>, such as hello.inspector-v2'
				)
			: undefined;

	const notFound = (experiment: string) =>
		fail(
			'EXPERIMENT_NOT_FOUND',
			`There is no experiment '${experiment}' to turn on or off`,
			'List the experiments with experiment-list'
		);

	/** A visible or graduated experiment, or a hidden one for an author in `local` (5.1); a removed one is gone. */
	const listable = (experiment: DeclaredExperimentV1, hidden: boolean) =>
		LISTED_STAGES.includes(experiment.stage) || (hidden && experiment.stage === 'hidden');

	// ─── What each person is told (5.2) ────────────────────────────────────────────

	/** Plugins whose loaded manifest version is older than the highest settled version (#2114). */
	const stalePluginsOf = (read: Snapshot): Set<string> => {
		const stale = new Set<string>();
		for (const plugin of read.plugins) {
			if (isStaleVersion(read.pluginVersions.get(plugin), read.declaredBefore.get(plugin)?.version))
				stale.add(plugin);
		}
		return stale;
	};

	/** The workspace's tokens now, for every experiment declared or removed. */
	function tokens(
		read: Snapshot,
		stale: ReadonlySet<string> = stalePluginsOf(read)
	): Record<string, string> {
		const now: Record<string, string> = {};
		for (const id of new Set([...read.experiments.keys(), ...read.removals.keys()])) {
			const plugin = id.slice(0, id.indexOf('.'));
			if (stale.has(plugin)) continue;
			const experiment = read.experiments.get(id);
			const token = workspaceToken(
				experiment && experiment.stage !== 'removed' ? experiment.digest : undefined,
				read.rows.get(id),
				read.removals.get(id)
			);
			if (token !== 'off' || read.told[id] !== undefined) now[id] = token;
		}
		// An app whose package could not be read, or whose manifest is stale (#2114), decides nothing: what its person was told stands.
		for (const [id, token] of Object.entries(read.told)) {
			const plugin = id.slice(0, id.indexOf('.'));
			if (
				!(id in now) &&
				read.listed.has(plugin) &&
				(!read.plugins.has(plugin) || stale.has(plugin))
			)
				now[id] = token;
		}
		return now;
	}

	const toldDiffers = (read: Snapshot): boolean => {
		const now = tokens(read);
		const ids = new Set([...Object.keys(now), ...Object.keys(read.told)]);
		return [...ids].some((id) => (now[id] ?? 'off') !== (read.told[id] ?? 'off'));
	};

	/**
	 * Tell the call's person of each change of the workspace's tokens since they were last told, skipping an experiment
	 * they opted out of, then keep the new tokens. Only for the person the shell is for, whose record this browser holds.
	 */
	async function tell(
		context: CommandContext,
		skip: ReadonlySet<string> = new Set()
	): Promise<void> {
		const person = deps.person();
		if (person === undefined || personOfCall(context) !== person) return;
		const read = await snapshot(person);
		if (!toldDiffers(read)) return;
		const now = tokens(read);
		for (const [id, after] of Object.entries(now)) {
			const experiment = read.experiments.get(id);
			const notice = workspaceNotice(
				experiment?.title ?? id,
				experiment?.changes,
				read.told[id],
				after
			);
			const own = read.own.get(id);
			const optedOut = own?.on === false && live(own.at, read.removals.get(id));
			if (!notice || skip.has(id) || optedOut || !deps.notice) continue;
			await deps.notice(context, person, notice);
		}
		// What was told, not when: no clock is read, so telling never moves a call's clock past another's.
		await deps.writeOwn(
			slot(),
			TOLD_KEY,
			{ value: now, updatedAt: 0, updatedBy: kit.personOf(context) },
			context
		);
	}

	// ─── The gates ─────────────────────────────────────────────────────────────────

	/** For the person the shell is for, as last read: each experiment's state, and the apps held out or kept loaded. */
	let states = new Map<string, boolean>();
	/** Full listing signature (`on:by:workspace:changed`) so cross-tab workspace switches also emit `experiments: true`. */
	let listingSig = new Map<string, string>();
	const gatedApps = new Set<string>();
	/** Closed, but kept loaded while a dirty tab of the app's document types is open (R14). */
	const held = new Set<string>();
	/** Held instances whose R14 deferral notice was already sent to the current person. */
	const noticedHeld = new Set<string>();
	/** Apps whose unload/tab cleanup was interrupted (e.g. store error) and must retry before settling (#2113). */
	const needsCleanup = new Set<string>();
	let readOnce = false;
	/** The person `states` and `gatedApps` were last evaluated for (so person switches refresh cleanly). */
	let evaluatedPerson: string | undefined;

	const appGateOf = (instance: string): string | undefined => {
		const manifest = manifestOf(instance);
		return manifest
			? gatesOf(manifest).find((each) => each.place === 'app')?.experiment
			: undefined;
	};

	/** Each app's own gate (5.3): its instance, and the experiment `app.requires_experiment` names. */
	function appGates(): Array<{ instance: string; experiment: string; title: string }> {
		return deps
			.apps()
			.summaries()
			.flatMap((app) => {
				const experiment = appGateOf(app.instance);
				return experiment ? [{ instance: app.instance, experiment, title: app.title }] : [];
			});
	}

	const shellPerson = () => {
		const person = deps.person();
		return deps.provider && person === undefined ? undefined : person;
	};

	let stopped = false;
	let refreshing: Promise<unknown> = Promise.resolve();
	async function refreshNow(context: CommandContext | undefined): Promise<boolean> {
		if (stopped) return false;
		const person = shellPerson();
		const read = await snapshot(person);
		if (stopped || shellPerson() !== person) return false;
		const next = new Map<string, boolean>();
		const nextSig = new Map<string, string>();
		for (const [id, exp] of read.experiments) {
			const removedAt = read.removals.get(id);
			const mine = live(read.own.get(id)?.at, removedAt) ? read.own.get(id) : undefined;
			const theirs = live(read.rows.get(id)?.updatedAt, removedAt) ? read.rows.get(id) : undefined;
			const state = stateIn(read, id);
			next.set(id, state.on);
			nextSig.set(
				id,
				`${state.on}:${state.by ?? ''}:${theirs?.digest === exp.digest}:${enablementChanged(exp, mine, theirs)}`
			);
		}
		const gates = appGates();
		const first = !readOnce;
		const personChanged = !first && person !== evaluatedPerson;
		const unsavedByInstance = new Map<string, UnsavedTabV1[]>();
		if (!first) {
			for (const { instance, experiment } of gates) {
				if (next.get(experiment) === true) continue;
				if (gatedApps.has(instance) && !personChanged && !needsCleanup.has(instance)) continue;
				unsavedByInstance.set(instance, await deps.unsavedTabs(instance));
				if (stopped || shellPerson() !== person) return false;
			}
		}
		if (personChanged) noticedHeld.clear();
		const changedAny =
			next.size !== states.size ||
			nextSig.size !== listingSig.size ||
			[...next].some(([id, on]) => states.get(id) !== on) ||
			[...nextSig].some(([id, sig]) => listingSig.get(id) !== sig);
		states = next;
		listingSig = nextSig;
		let regate = false;
		readOnce = true;
		const abortRefresh = () => {
			if (regate && !stopped) deps.regate();
			return false;
		};
		const tellable = person !== undefined && context !== undefined && deps.notice;
		const deferDirty = async (instance: string, title: string): Promise<boolean> => {
			if (!held.has(instance)) {
				held.add(instance);
				if (tellable) {
					noticedHeld.add(instance);
					await deps.notice?.(context, person, {
						title: `${title} stays open until your changes are saved`,
						body: `The experiment that shows ${title} was turned off. It closes once you save or discard the open tabs that hold unsaved changes.`,
						tone: 'info',
					});
					if (stopped || shellPerson() !== person) return false;
				}
			}
			return true;
		};
		for (const { instance, experiment, title } of gates) {
			const closed = next.get(experiment) !== true;
			if (!closed) {
				held.delete(instance);
				noticedHeld.delete(instance);
				needsCleanup.delete(instance);
				if (gatedApps.delete(instance) || first) regate = true;
				continue;
			}
			if (gatedApps.has(instance) && !personChanged && !needsCleanup.has(instance)) continue;
			// At stage B nothing is loaded yet, and no tab is dirty: a closed app is simply held out, any persisted
			// tabs of its documents closed (#2113), and boot's settle withdraws what it had pending. After stage B,
			// including cross-tab sync (#2108), R14's dirty-tab check runs.
			if (first) {
				gatedApps.add(instance);
				regate = true;
				try {
					const done = await deps.closeTabs?.(instance, context);
					if (done?.dirty) needsCleanup.add(instance);
					else needsCleanup.delete(instance);
				} catch {
					needsCleanup.add(instance);
				}
				if (stopped || shellPerson() !== person) return abortRefresh();
				continue;
			}
			const unsaved = unsavedByInstance.get(instance) ?? [];
			if (unsaved.length > 0) {
				if (!(await deferDirty(instance, title))) return abortRefresh();
				continue;
			}
			// Only mark cleanup pending if unload actually throws, so concurrent calls (like editor-dirty-set) don't
			// block in settle on the in-flight refresh chain while unload awaits store reads.
			let unloaded: boolean;
			try {
				unloaded = await deps.unload(instance, context);
			} catch (cause) {
				needsCleanup.add(instance);
				throw cause;
			}
			if (stopped || shellPerson() !== person) return abortRefresh();
			if (!unloaded) {
				needsCleanup.delete(instance);
				if (!(await deferDirty(instance, title))) return abortRefresh();
				continue;
			}
			needsCleanup.delete(instance);
			const wasHeld = held.delete(instance);
			noticedHeld.delete(instance);
			gatedApps.add(instance);
			regate = true;
			if (wasHeld && tellable) {
				await deps.notice?.(context, person, {
					title: `${title} has closed`,
					body: `Your changes are saved, so ${title} closed: the experiment that shows it is off.`,
					tone: 'info',
				});
				if (stopped || shellPerson() !== person) return abortRefresh();
			}
		}
		evaluatedPerson = person;
		if (regate) deps.regate();
		// Undeclare and close any layout part whose surface gate just closed, or re-declare one that opened (#2112).
		const gatesMoved = changedAny || regate || (personChanged && next.size > 0);
		if (gatesMoved) deps.apps().reconcileLayouts();
		if (context) await tell(context);
		if (gatesMoved && context) scope.note(context.traceId, { experiments: true });
		return gatesMoved;
	}

	const refresh = (context?: CommandContext): Promise<boolean> => {
		const run = refreshing.then(
			() => refreshNow(context),
			() => refreshNow(context)
		);
		refreshing = run.catch(() => undefined);
		return run;
	};

	/**
	 * R14's refusal: the person's own change that would unload an app while a tab of it holds an unsaved change. Read
	 * for the person the shell is for alone, whose tabs these are.
	 */
	async function ownUnloadRefusal(
		experiment: string,
		after: ExperimentStateV1,
		context: CommandContext
	): Promise<CommandResult<never> | undefined> {
		if (after.on || personOfCall(context) !== deps.person()) return undefined;
		for (const gate of appGates()) {
			if (gate.experiment !== experiment || gatedApps.has(gate.instance)) continue;
			const [first] = await deps.unsavedTabs(gate.instance);
			if (!first) continue;
			return fail(
				'EDITOR_TAB_DIRTY',
				`The tab '${first.tab}' holds unsaved changes of ${gate.title}, which this experiment shows`,
				'Save or discard the tab first, then turn the experiment off',
				{ tab: first.tab, document: first.document, instance: gate.instance }
			);
		}
		return undefined;
	}

	// ─── Commands ──────────────────────────────────────────────────────────────────

	const EXPERIMENT = z.string().check(z.minLength(3), z.maxLength(105));
	// An experiment's full id, `<plugin>.<id>`, its syntax checked in the handler (`badId`), as the kit's Zod has no pattern.
	const EXPERIMENT_JSON = { type: 'string', minLength: 3, maxLength: 105 };

	const listInput = z.strictObject({
		experiment: z.optional(EXPERIMENT),
		hidden: z.optional(z.boolean()),
	});
	const experimentList = kit.define<typeof listInput, { experiments: ExperimentRowV1[] }>({
		name: 'experiment-list',
		title: 'List experiments',
		description:
			"List the apps' experiments: what each may change, when it ends, and whether it is on for you or the workspace",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				experiment: EXPERIMENT_JSON,
				hidden: { type: 'boolean' },
			},
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			const bad = badId(input.experiment);
			if (bad) return bad;
			if (input.hidden === true && deps.provider)
				return fail(
					'VALIDATION_ERROR',
					'Hidden experiments are listed only in a local deployment',
					'Leave hidden out, or list them in a local deployment, where the author works'
				);
			const read = await snapshot(personOfCall(context), true);
			const { experiments, rows, own, removals } = read;
			const now = kit.callNow(context);
			const listed: ExperimentRowV1[] = [];
			for (const [id, experiment] of experiments) {
				if (input.experiment !== undefined && id !== input.experiment) continue;
				if (!listable(experiment, input.hidden === true)) continue;
				const removedAt = removals.get(id);
				const mine = live(own.get(id)?.at, removedAt) ? own.get(id) : undefined;
				const theirs = live(rows.get(id)?.updatedAt, removedAt) ? rows.get(id) : undefined;
				const state = stateIn(read, id);
				listed.push({
					fullId: id,
					owner: experiment.owner,
					title: experiment.title,
					changes: experiment.changes,
					ends: experiment.ends,
					stage: experiment.stage,
					on: state.on,
					by: state.by,
					workspace: theirs?.digest === experiment.digest,
					changed: enablementChanged(experiment, mine, theirs),
					overdue: overdue(experiment.ends, now),
				});
			}
			const late = listed.filter((row) => row.overdue && row.stage !== 'graduated');
			const data = { experiments: listed };
			if (bytesOf(data) > (EXPERIMENT_OUTPUT_BUDGETS['experiment-list']?.maxBytes ?? 0))
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					'The experiments are more than one answer can hold',
					'Name one with experiment'
				);
			return kit.success(
				data,
				late.length > 0
					? {
							warnings: late.map((row) => ({
								code: 'EXPERIMENT_OVERDUE',
								message: `'${row.fullId}' was to end on ${row.ends}; nothing turns off on a date, so its author should graduate or remove it`,
							})),
						}
					: {}
			);
		},
	});

	const checkInput = z.strictObject({ experiment: EXPERIMENT });
	const experimentCheck = kit.define<typeof checkInput, ExperimentStateV1>({
		name: 'experiment-check',
		title: 'Check an experiment',
		description:
			'Whether an experiment is on for the person, and what decided it; an app checks only its own. Unknown and hidden ids answer the same',
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: checkInput,
		jsonSchema: {
			type: 'object',
			properties: { experiment: EXPERIMENT_JSON },
			required: ['experiment'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			const bad = badId(input.experiment);
			if (bad) return bad;
			// By the id's plugin, never by whether it exists, so an app learns nothing of another app's experiments.
			const plugin = callerPlugin(context);
			if (plugin !== undefined && !input.experiment.startsWith(`${plugin}.`))
				return fail(
					'EXPERIMENT_NOT_OWNED',
					`'${input.experiment}' is another app's experiment`,
					"Check only this app's own experiments, by their full id"
				);
			return kit.success(stateIn(await snapshot(personOfCall(context)), input.experiment));
		},
	});

	const writeInput = z.strictObject({
		experiment: EXPERIMENT,
		audience: z.enum(['person', 'workspace']),
	});
	const WRITE_JSON = {
		type: 'object',
		properties: {
			experiment: EXPERIMENT_JSON,
			audience: { type: 'string', enum: ['person', 'workspace'] },
		},
		required: ['experiment', 'audience'],
		additionalProperties: false,
	} as unknown as JsonSchema;

	/** The hand-off (3.2, F2): `HUMAN_REQUIRED` with the place the person turns it on, and what the call would write. */
	const handOff = (experiment: string, level: 'person' | 'workspace') => {
		// The section's route: a full id holds a dot, which `section-open`'s `<section>.<key>` target would read as a key.
		const route = `~/settings/${EXPERIMENTS_SECTION}`;
		return fail(
			'HUMAN_REQUIRED',
			level === 'workspace'
				? 'Only an owner, in person, turns an experiment on or off for the workspace'
				: 'Only the person, in the shell, turns an experiment on or off for themselves',
			`Ask your person to do it at ${route}`,
			{ route, section: EXPERIMENTS_SECTION, key: experiment, level }
		);
	};

	/** 5.4's order: the caller, the hand-off, the experiment, section 13's refusal, the owner. */
	async function writeRefusal(
		input: { experiment: string; audience: 'person' | 'workspace' },
		context: CommandContext
	): Promise<{ experiment: DeclaredExperimentV1 } | CommandResult<never>> {
		const bad = badId(input.experiment);
		if (bad) return bad;
		if ((context as KernelFieldContext).caller !== undefined)
			return fail(
				'CALL_NOT_GRANTED',
				'No app turns an experiment on or off',
				'Let the person do it in the shell'
			);
		if (!isHumanGesture(context)) return handOff(input.experiment, input.audience);
		const experiment = (await snapshot(personOfCall(context), true)).experiments.get(
			input.experiment
		);
		// Hidden and removed answer as unknown: nobody turns either on (5.1).
		if (!experiment || !LISTED_STAGES.includes(experiment.stage)) return notFound(input.experiment);
		if (input.audience === 'workspace') {
			if (sharedRecordUnavailable(deps.hosted(), 'experiment-enable', input))
				return fail(
					'SHARED_RECORD_UNAVAILABLE',
					"The workspace's experiments have no record on this hosted deployment yet, so nothing was written",
					'Turn it on for yourself, with audience person, or wait for the release that serves it'
				);
			if (!deps.isOwner(personOfCall(context), context))
				return fail(
					'OWNER_REQUIRED',
					'Only an owner of the workspace turns an experiment on or off for everyone',
					'Turn it on or off for yourself with audience person, or ask an owner'
				);
		}
		return { experiment };
	}

	/** One write at a time, so two calls never both read the same rows and lose one's write. */
	let writing: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = writing.then(work, work);
		writing = run.catch(() => undefined);
		return run;
	};

	async function write(
		input: { experiment: string; audience: 'person' | 'workspace' },
		on: boolean,
		context: CommandContext
	): Promise<CommandResult<ExperimentStateV1>> {
		const checked = await writeRefusal(input, context);
		if ('success' in checked) return checked;
		const { experiment } = checked;
		const id = experiment.fullId;
		const person = personOfCall(context);
		const at = kit.callNow(context);
		const by = kit.personOf(context);
		const before = await snapshot(person);
		const { rows } = before;
		if (input.audience === 'person') {
			// An opt-out holds whatever the workspace does (D155); turning on stores the `changes` shown.
			const mine: PersonEnablementV1 = { on, digest: experiment.digest, at };
			const after = experimentOn(experiment, mine, rows.get(id), before.removals.get(id));
			const refused = await ownUnloadRefusal(id, after, context);
			if (refused) return refused;
			await deps.writeOwn(slot(), id, { value: mine, updatedAt: at, updatedBy: by }, context);
		} else {
			const key = rowKey(id);
			const held = rows.get(id);
			if (on) {
				const row: WorkspaceEnablementV1 = {
					id: key,
					workspace: scope.workspace.id,
					experiment: id,
					digest: experiment.digest,
					updatedAt: at,
					updatedBy: by,
				};
				if (held) await store.update(EXPERIMENT_TABLE, key, row);
				else await store.create(EXPERIMENT_TABLE, row);
			} else if (held) {
				await store.remove(EXPERIMENT_TABLE, key);
			}
		}
		scope.note(context.traceId, { settings: [EXPERIMENTS_SECTION], experiments: true });
		// The gates, and each affected person told on their own next call (5.2), this one's now.
		await refresh(context);
		deps.onTabWrite?.(input.audience === 'person' && deps.provider ? person : undefined);
		return kit.success(stateIn(await snapshot(person), id));
	}

	const experimentEnable = kit.define<typeof writeInput, ExperimentStateV1>({
		name: 'experiment-enable',
		title: 'Turn an experiment on',
		description:
			"Turn an experiment on for yourself, or as an owner for the workspace. A person's command, after reading what it may change",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: writeInput,
		jsonSchema: WRITE_JSON,
		handler: (input, context) => serial(() => write(input, true, context)),
	});

	const experimentDisable = kit.define<typeof writeInput, ExperimentStateV1>({
		name: 'experiment-disable',
		title: 'Turn an experiment off',
		description:
			"Turn an experiment off for yourself, even when the workspace has it on, or as an owner for the workspace. A person's command",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: writeInput,
		jsonSchema: WRITE_JSON,
		handler: (input, context) => serial(() => write(input, false, context)),
	});

	// ─── experiment-settle ─────────────────────────────────────────────────────────

	const IDS = z.array(EXPERIMENT).check(z.maxLength(1_000));
	const IDS_JSON = { type: 'array', maxItems: 1_000, items: EXPERIMENT_JSON };
	const INSTANCES = z
		.array(z.string().check(z.minLength(1), z.maxLength(128)))
		.check(z.maxLength(100));
	const settleInput = z.strictObject({
		removed: IDS,
		changed: IDS,
		tell: z.boolean(),
		withdraw: INSTANCES,
		declared: z
			.array(
				z.strictObject({
					plugin: z.string().check(z.minLength(1), z.maxLength(64)),
					ids: IDS,
					version: z.optional(z.string().check(z.minLength(1))),
				})
			)
			.check(z.maxLength(1_000)),
		defer: z.optional(INSTANCES),
	});
	const settle = kit.define<typeof settleInput, { removed: number; changed: number }>({
		name: 'experiment-settle',
		description:
			"Boot's own: remove experiments their apps removed, tell of changed ones once, and withdraw a held-out app's pending confirmations",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				removed: IDS_JSON,
				changed: IDS_JSON,
				tell: { type: 'boolean' },
				withdraw: {
					type: 'array',
					maxItems: 100,
					items: { type: 'string', minLength: 1, maxLength: 128 },
				},
				declared: {
					type: 'array',
					maxItems: 1_000,
					items: {
						type: 'object',
						properties: {
							plugin: { type: 'string', minLength: 1, maxLength: 64 },
							ids: IDS_JSON,
							version: { type: 'string', minLength: 1 },
						},
						required: ['plugin', 'ids'],
						additionalProperties: false,
					},
				},
				defer: {
					type: 'array',
					maxItems: 100,
					items: { type: 'string', minLength: 1, maxLength: 128 },
				},
			},
			required: ['removed', 'changed', 'tell', 'withdraw', 'declared'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		handler: (input, context) =>
			serial(async () => {
				// The ids are the journaled ones; what is held now is read from the store, which a replay holds alike.
				const person = deps.person();
				const read = await snapshot(person);
				const at = kit.callNow(context);
				// Re-check against the latest recorded plugin versions at commit time so a concurrent newer shell cannot be
				// overwritten by an older or unlisted shell whose settle planned before the newer shell wrote (#2114).
				const incomingDeclared = new Map(
					input.declared.map((entry) => [entry.plugin, entry.version])
				);
				const staleAtCommit = (plugin: string, id?: string): boolean => {
					const recorded = read.declaredBefore.get(plugin)?.version;
					if (incomingDeclared.has(plugin))
						return isStaleVersion(incomingDeclared.get(plugin), recorded);
					if (read.plugins.has(plugin))
						return isStaleVersion(read.pluginVersions.get(plugin), recorded);
					return (
						id !== undefined &&
						isSemver(recorded) &&
						(read.declaredBefore.get(plugin)?.ids.includes(id) ?? false)
					);
				};
				const removed = input.removed.filter(
					(id) => !staleAtCommit(id.slice(0, id.indexOf('.')), id)
				);
				const declared = input.declared.filter(
					(entry) => !isStaleVersion(entry.version, read.declaredBefore.get(entry.plugin)?.version)
				);
				const lost: string[] = [];
				const optedOut: string[] = [];
				const changed: string[] = [];
				/**
				 * Write a removal or declared row idempotently across tabs (#2115): another tab's settle between our
				 * `snapshot` and `create` leaves the row present, which we treat as settled instead of failing.
				 */
				const writeSettled = async (row: { id: string }, existed: boolean): Promise<void> => {
					if (existed) {
						await store.update(EXPERIMENT_TABLE, row.id, row);
						return;
					}
					try {
						await store.create(EXPERIMENT_TABLE, row);
					} catch (cause) {
						if ((await store.get(EXPERIMENT_TABLE, row.id)) === null) throw cause;
					}
				};
				for (const id of removed) {
					// The removal, kept as its time, voids every enablement made before it, every person's (5.1).
					const removal = {
						id: removalKey(id),
						workspace: scope.workspace.id,
						experiment: id,
						kind: 'removed',
						removedAt: at,
					};
					await writeSettled(removal, read.removals.has(id));
					if (read.rows.has(id)) await store.remove(EXPERIMENT_TABLE, rowKey(id));
					const own = read.own.get(id);
					if (own) {
						await deps.writeOwn(slot(), id, undefined, context);
						if (own.on && live(own.at, read.removals.get(id))) lost.push(id);
						else if (!own.on && live(own.at, read.removals.get(id))) optedOut.push(id);
					}
				}
				for (const id of input.changed) {
					if (staleAtCommit(id.slice(0, id.indexOf('.')), id)) continue;
					const own = read.own.get(id);
					const digest = read.experiments.get(id)?.digest;
					if (!own?.on || digest === undefined || own.told === digest) continue;
					const { at: _at, ...kept } = own;
					await deps.writeOwn(
						slot(),
						id,
						{
							value: { ...kept, told: digest },
							updatedAt: own.at ?? at,
							updatedBy: kit.personOf(context),
						},
						context
					);
					changed.push(id);
				}
				const titleOf = (id: string) => read.experiments.get(id)?.title ?? id;
				if (deps.notice && person !== undefined) {
					for (const id of lost)
						await deps.notice(context, person, {
							title: `${titleOf(id)} has ended`,
							body: 'Its app no longer offers it, so it is off for you, and turning it on again later starts afresh.',
							tone: 'info',
						});
					for (const id of changed)
						await deps.notice(context, person, {
							title: `${titleOf(id)} has changed`,
							body: 'What it may change is new, so it is off for you until you turn it on again in Settings, Experiments.',
							tone: 'warning',
						});
					// R14 deferral notices for dirty tabs held open after a cross-tab disable (#2108).
					const isReplaying = deps.replaying?.() === true;
					for (const instance of input.defer ?? []) {
						if (!isReplaying && noticedHeld.has(instance)) continue;
						if (!isReplaying) noticedHeld.add(instance);
						const title =
							deps
								.apps()
								.summaries()
								.find((app) => app.instance === instance)?.title ?? instance;
						await deps.notice(context, person, {
							title: `${title} stays open until your changes are saved`,
							body: `The experiment that shows ${title} was turned off. It closes once you save or discard the open tabs that hold unsaved changes.`,
							tone: 'info',
						});
					}
				}
				// Each held-out app's pending confirmations end `withdrawn`, as an unload's do (R14).
				for (const instance of input.withdraw) await deps.unload(instance, context);
				// Each plugin's ids (and highest manifest version, #2114) as declared now, so a dropped id is seen gone.
				for (const { plugin, ids, version } of declared) {
					const row = {
						id: declaredKey(plugin),
						workspace: scope.workspace.id,
						kind: 'declared',
						plugin,
						ids,
						...(version !== undefined ? { version } : {}),
					};
					await writeSettled(row, read.declaredBefore.has(plugin));
				}
				if (input.tell) await tell(context, new Set([...lost, ...optedOut]));
				if (removed.length + changed.length > 0) {
					scope.note(context.traceId, { settings: [EXPERIMENTS_SECTION], experiments: true });
					if (removed.length > 0) deps.onTabWrite?.();
				}
				return kit.success({ removed: removed.length, changed: changed.length });
			}),
	});

	return {
		commands: [
			experimentList,
			experimentCheck,
			experimentEnable,
			experimentDisable,
		] as unknown as ZodCommandDefinition[],
		settleCommand: settle as unknown as ZodCommandDefinition,
		open: (experiment) => states.get(experiment) === true,
		// Fail closed until the gates are first read: an app with a gate of its own is held out.
		gated: (instance) => (readOnce ? gatedApps.has(instance) : appGateOf(instance) !== undefined),
		ready: () => readOnce && evaluatedPerson === shellPerson(),
		waiting: () => held.size > 0,
		refresh,
		stop: () => {
			stopped = true;
		},
		async settleChanges(options) {
			const read = await snapshot(shellPerson());
			const stalePlugins = stalePluginsOf(read);
			const removed: string[] = [];
			const declared: Array<{ plugin: string; ids: string[]; version?: string }> = [];
			if (!options?.postRefresh) {
				const removable = new Set<string>();
				// An enablement still standing for an experiment now removed or gone, or a removal not yet recorded.
				for (const [id, row] of read.rows)
					if (live(row.updatedAt, read.removals.get(id))) removable.add(id);
				for (const [id, own] of read.own)
					if (live(own.at, read.removals.get(id))) removable.add(id);
				for (const [id, experiment] of read.experiments)
					if (
						!stalePlugins.has(experiment.plugin) &&
						experiment.stage === 'removed' &&
						!read.removals.has(id)
					)
						removable.add(id);
				// An id a plugin declared live at the last settle and no longer does (dropped, or staged `removed`), whoever
				// holds an enablement of it and whatever removal it had before a re-ship: the row then forgets it, so once.
				// Stale shells (older `plugin.version` than recorded, #2114) never drop or void newer declarations.
				const liveNow = (id: string) => {
					const experiment = read.experiments.get(id);
					return experiment !== undefined && experiment.stage !== 'removed';
				};
				for (const [plugin, entry] of read.declaredBefore) {
					if (stalePlugins.has(plugin)) continue;
					for (const id of entry.ids) if (!liveNow(id)) removable.add(id);
				}
				const currentPlugins =
					stalePlugins.size === 0
						? read.plugins
						: new Set([...read.plugins].filter((plugin) => !stalePlugins.has(plugin)));
				const currentExperiments =
					stalePlugins.size === 0
						? read.experiments
						: new Map([...read.experiments].filter(([, exp]) => !stalePlugins.has(exp.plugin)));
				removed.push(
					...settledAway([...removable], currentExperiments, currentPlugins, read.listed)
				);
				// Each plugin's live ids (and highest manifest version, #2114) now, where they differ from those kept:
				// a read non-stale plugin's, and none for a plugin the deployment no longer lists.
				for (const plugin of new Set([...read.plugins, ...read.declaredBefore.keys()])) {
					if (stalePlugins.has(plugin)) continue;
					if (!read.plugins.has(plugin) && read.listed.has(plugin)) continue;
					const ids = [...read.experiments.values()]
						.filter((experiment) => experiment.plugin === plugin && experiment.stage !== 'removed')
						.map(({ fullId }) => fullId)
						.sort();
					const before = read.declaredBefore.get(plugin);
					const beforeIds = [...(before?.ids ?? [])].sort();
					const rawVersion = read.pluginVersions.get(plugin);
					const version = isSemver(rawVersion) ? rawVersion : undefined;
					const beforeVersion = isSemver(before?.version) ? before.version : undefined;
					const versionAdvanced =
						version !== undefined &&
						(beforeVersion === undefined
							? before !== undefined || ids.length > 0
							: (compareSemver(version, beforeVersion) ?? 0) > 0);
					if (ids.join() !== beforeIds.join() || versionAdvanced) {
						const nextVersion = version ?? beforeVersion;
						declared.push({
							plugin,
							ids,
							...(nextVersion !== undefined ? { version: nextVersion } : {}),
						});
					}
				}
			}
			const gone = new Set(removed);
			const changed = [...read.own]
				.filter(([id, own]) => {
					const experiment = read.experiments.get(id);
					if (!experiment || stalePlugins.has(experiment.plugin)) return false;
					const digest = experiment.digest;
					return (
						!gone.has(id) &&
						own.on &&
						own.digest !== digest &&
						own.told !== digest &&
						live(own.at, read.removals.get(id))
					);
				})
				.map(([id]) => id);
			const tell = shellPerson() !== undefined && toldDiffers(read);
			// Once the gates are read: each held-out app with a confirmation still pending (R14 at boot or cross-tab),
			// and each dirty-tab held app whose deferral notice has not yet been sent (#2108).
			const withdraw: string[] = [];
			const defer: string[] = [];
			if (readOnce) {
				for (const instance of gatedApps) if (await deps.pending(instance)) withdraw.push(instance);
				for (const instance of held) if (!noticedHeld.has(instance)) defer.push(instance);
			}
			return removed.length + changed.length + withdraw.length + declared.length + defer.length >
				0 || tell
				? {
						removed,
						changed,
						tell,
						withdraw,
						declared,
						...(defer.length > 0 ? { defer } : {}),
					}
				: undefined;
		},
	};
}
