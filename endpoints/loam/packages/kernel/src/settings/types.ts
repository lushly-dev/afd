/**
 * @fileoverview Pure types for the settings domain (phase 4 specification, section 3).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import type { AppearanceStateV0 } from '../appearance.js';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KeybindingRegistry } from '../keybindings.js';
import type { KernelLimits } from '../limits.js';
import type { createPaletteIndex, SettingRows } from '../palette-index.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { KnownSectionV1, StoredSettingV1 } from './setting-rules.js';

/**
 * A shared row of the `setting` table (3.4): `<workspace>/<section>/workspace` or `<workspace>/<section>/project/<project
 * id>`, keyed by workspace since phase 4's step 10 (R1, #1614), so two workspaces in one browser's store never share a
 * row; one keyed without its workspace is never read, and never written over.
 */
export interface SettingRowV1 {
	id: string;
	workspace: string;
	section: string;
	level: 'workspace' | 'project';
	project?: string;
	values: Record<string, StoredSettingV1>;
	updatedAt: number;
	updatedBy: string;
}

/** The person's record (3.4): `{ [section]: { [key]: { value, updatedAt, updatedBy } } }`. */
export type PersonSettingsV1 = Record<string, Record<string, StoredSettingV1>>;

/** What this chunk reads of first paint's modules, given by `late/` (13). */
export interface SettingsKit
	extends Pick<
		DocumentKit,
		'define' | 'success' | 'kernelFailure' | 'z' | 'callNow' | 'archivedRefusal'
	> {
	personKey(actor: AccessActorV1): string | undefined;
}

export interface SettingsDeps {
	store: DataAdapter;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	state: Pick<
		ShellState,
		| 'appearance'
		| 'setOwnAppearance'
		| 'setLastAppearance'
		| 'legacyAppearance'
		| 'dropLegacyAppearance'
	>;
	/** Whether the deployment's identity is `provider` (phase 3 specification, 2.1). */
	provider: boolean;
	/** The person the adapter reports now: the one the shell is for, once settled. */
	person(): string | undefined;
	/** The person's record's id: suffixed by `personalRecordId` in `provider` mode, unsuffixed in `local` (3.4, 3.6). */
	recordId(person: string | undefined): string;
	/** Whether the applied projection is a hosted `provider` deployment (section 13). */
	hosted(): boolean;
	/** Whether a replay runs, whose entries are what ran (phase 2 specification, 10). */
	replaying(): boolean;
	/** Whether `person` is an owner, on the membership `call` reads: on the server its principal's (phase 3 specification, 7.1 and 9.5). */
	isOwner(person: string | undefined, call: { actor?: unknown }): boolean;
	/** Why `instance` cannot open in `project`: a project write of an app's key needs the app enabled there (3.2). */
	canOpen(instance: string, project: string | undefined): CommandResult<never> | undefined;
	/**
	 * Write `WorkspaceV1.trashDays` through (A-P2-2), in one store batch with `also`, the `setting` row's own write, so
	 * the value shown and the retention applied never diverge.
	 */
	trashDays(days: number, context: CommandContext, also: BatchOperation[]): Promise<void>;
	/** The palette's index, given by `late/` so this chunk imports no module first paint may hold (13). */
	paletteIndex: typeof createPaletteIndex;
	/** The limits the kernel enforces, which `loam.limits` sets once read (section 11); absent, nothing is set. */
	limits?: KernelLimits;
	/** The kernel's keybindings, given the person's overrides once read (8.3); absent, nothing is set. */
	keybindings?: KeybindingRegistry;
	/** Whether an experiment is on for the person the shell is for (5.3): a gated section is absent while it is off. */
	experimentOpen?(experiment: string): boolean;
	/** Notify other tabs when limits or keybinding overrides are written (#2108). */
	onTabWrite?(kind: 'limits' | 'keybindings', person?: string): void;
	kit: SettingsKit;
}

export interface Settings {
	commands: ZodCommandDefinition[];
	/** Every section the kernel knows now: the shell's, then each app's, in rail order (3.5). */
	sections(): KnownSectionV1[];
	/**
	 * `appearance-set`'s and the alias's write (3.6): the person's own `loam.appearance` keys, or, signed out in
	 * `provider` mode, `loam.appearance.last` alone. Returns the keys' previous values.
	 */
	writeAppearance(patch: Partial<AppearanceStateV0>, context: CommandContext): Promise<void>;
	/** After a call: the person's record, read again when the person the shell is for changed (4.4; 3.6). */
	follow(): Promise<void>;
	/**
	 * The first stage B's move of an old `loam.appearance` record into the person's `loam.settings`, journaled as
	 * `setting-set` with `migrated: true` through `run` (3.6, R12): in `local` mode, and in `provider` mode only signed
	 * in. Never in a replay, whose entries are what ran.
	 */
	migrate(run: (name: string, input: unknown) => Promise<CommandResult>): Promise<void>;
	/** The palette's setting rows (3.10), built here on the first query that needs them, never in first paint. */
	rows: SettingRows;
	/** The person's own rail order, `loam.rail.order`, for the call (3.7; R8): instance ids, first to last. */
	railOrder(context: CommandContext): Promise<readonly string[]>;
	/**
	 * The call's person's `loam.notifications` (3.7): which toasts also land in the inbox, and the apps whose notices are
	 * kept quiet. Read from the store at each call; a value that does not read is its default.
	 */
	notificationPrefs(context: CommandContext): Promise<NotificationPrefsV1>;
	/**
	 * `section-open { section: 'settings', target }`'s place (3.5, 3.10): `target` is `<section>` or `<section>.<key>`, a
	 * section the call may see. Its main path, `<section>` or `<section>/<key>`, or the refusal `setting-get` would give.
	 */
	target(target: string, context: CommandContext): { path: string } | CommandResult<never>;
	/** Whether `name` with `input` is a write whose own handler refuses every agent with its hand-off (3.2, F2). */
	refusesAgent(name: string, input: unknown): boolean;
	/** Read workspace `loam.limits` into the kernel's limits (section 11, #2108); returns true when enforced values changed. */
	readLimits(): Promise<boolean>;
	/** Read the person's `loam.keybindings.overrides` into the kernel's keybindings (8.3, #2108). */
	readOverrides(): Promise<boolean>;
	/** The kernel is disposed: the overrides' retry and any read in flight end (the third round's improvement). */
	stop(): void;
	ownValue(
		section: string,
		key: string,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined>;
	writeOwn(
		section: string,
		key: string,
		entry: StoredSettingV1 | undefined,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined>;
	/** One section's entries of `person`'s record, read from the store (the experiments' enablements, 5.2). */
	ownSection(person: string | undefined, section: string): Promise<Record<string, StoredSettingV1>>;
}

/** The person's `loam.notifications` (3.7), as the inbox reads it. */
export interface NotificationPrefsV1 {
	toastSticky: 'never' | 'danger' | 'always';
	muted: readonly string[];
}
