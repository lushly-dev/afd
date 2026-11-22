/**
 * @fileoverview The settings' pure rules (phase 4 specification, 3.2, 3.3, 6.5 and 13): who writes a value at which
 * level, what a human gesture is, how a key resolves, and what a hosted `provider` deployment refuses. In the
 * `late-settings` chunk, imported by its commands alone; each is a pure function its unit tests hold.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { SettingKeyV1, SettingLevelV1, SettingSectionV1 } from '@lushly-dev/loam-manifest';

/** A section the kernel knows, with its full id and who declared it: the shell, or an app instance. */
export interface KnownSectionV1 {
	/** `<plugin.id>.<id>`, or the shell's `loam.<id>`. */
	fullId: string;
	section: SettingSectionV1;
	/** The declaring instance, or `shell`. */
	owner: string;
	/** The declaring app's plugin id: whose own sections the `settings` grant reads (3.8). Absent for the shell's. */
	plugin?: string;
	/**
	 * The shell's own checks of the keys whose shapes 3.1's subset cannot express (3.7), by key. An app's section has
	 * none: each of its keys is checked by the manifest's `checkSettingValue`.
	 */
	checks?: Readonly<Record<string, ShellKeyCheckV1>>;
	/**
	 * A rule between the section's keys (phase 4 specification, section 11's quarter rule), given the section's values
	 * as a write would leave them at its level: what is wrong, and the suggestion naming the order to write them in.
	 */
	relate?: (values: Record<string, unknown>) => { problem: string; suggestion: string } | undefined;
	/**
	 * A person-level section kept per workspace in the person's record, at `<workspace>/<section>` (phase 4 specification,
	 * 3.4 as amended by step 7's R5): `loam.keybindings`. One stored under its bare id is not this workspace's, never read.
	 */
	workspaceKeyed?: true;
}

/** Why a value of one of the shell's custom keys is refused (3.7): in words, and with a code of its own when 16 has one. */
export type ShellKeyCheckV1 = (value: unknown) => SettingValueProblemV1 | undefined;

export interface SettingValueProblemV1 {
	/** `VALIDATION_ERROR` when absent. */
	code?: 'SETTING_MUTE_SHELL' | 'KEYBINDING_RESERVED';
	/** What is wrong, as the end of a sentence about the key: "must be a list". */
	problem: string;
	/** How to put it right, where the key's own rule says more than "read the key's schema". */
	suggestion?: string;
}

/**
 * Why `value` is not a value of `key` (3.1, 3.7), or undefined: the shell's own check for a custom key, else `check`,
 * the manifest's `checkSettingValue`.
 */
export function checkKnownValue(
	known: Pick<KnownSectionV1, 'section' | 'checks'>,
	key: string,
	value: unknown,
	check: (key: SettingKeyV1, value: unknown) => string | undefined
): SettingValueProblemV1 | undefined {
	const own = known.checks?.[key];
	if (own) return own(value);
	const problem = check(known.section.schema.properties[key] as SettingKeyV1, value);
	return problem === undefined ? undefined : { problem };
}

/**
 * The human keys (3.2): an agent may not write them even for its person, `HUMAN_REQUIRED`. A whole section by its
 * full id, or one key as `<section>.<key>`.
 */
export const HUMAN_SETTING_KEYS: readonly string[] = Object.freeze([
	'loam.autonomy',
	'loam.keybindings',
	'loam.notifications.muted',
	'loam.experiments',
]);

/** Whether `key` of the section `fullId` is a human key (3.2). */
export const isHumanKey = (fullId: string, key: string): boolean =>
	HUMAN_SETTING_KEYS.includes(fullId) || HUMAN_SETTING_KEYS.includes(`${fullId}.${key}`);

/**
 * Who may write a value (3.2's table), by level alone: a person's own value is theirs, `human` when only the
 * person may write it; a project's is a member's who may enter it; the workspace's an owner's. A level the key does
 * not allow is `unavailable`, with the levels it does.
 */
export type SettingWriteRuleV1 =
	| { rule: 'person'; human: boolean }
	| { rule: 'member' }
	| { rule: 'owner' }
	| { rule: 'unavailable'; levels: SettingLevelV1[] };

/**
 * The one rule for a write of `key` at `level` (3.2): the handler, the owner check, the human check and the membership
 * re-read all decide from it. `level` is required on every write, so the caller always names one.
 */
export function settingWriteRule(
	known: Pick<KnownSectionV1, 'fullId' | 'section'>,
	key: string,
	level: SettingLevelV1
): SettingWriteRuleV1 {
	const declared = known.section.schema.properties[key] as SettingKeyV1 | undefined;
	const levels = declared?.levels ?? known.section.levels;
	if (!levels.includes(level)) return { rule: 'unavailable', levels: [...levels] };
	if (level === 'person') return { rule: 'person', human: isHumanKey(known.fullId, key) };
	return level === 'project' ? { rule: 'member' } : { rule: 'owner' };
}

/**
 * A human gesture (the terms; 6.5; R7): a call through the chrome or the palette interface, with no `caller`, whose
 * actor is anything but an agent, none at all included, as in `local` signed out, and a scenario's `kind: 'test'`.
 */
export function isHumanGesture(
	context: Pick<CommandContext, 'interface' | 'actor'> & { caller?: string }
): boolean {
	return (
		context.interface === 'palette' &&
		context.caller === undefined &&
		context.actor?.kind !== 'agent'
	);
}

/** A stored value at one level, with who wrote it and when (3.2). */
export interface StoredSettingV1 {
	value: unknown;
	updatedAt: number;
	updatedBy: string;
}

/** Where a resolved value came from (3.3). */
export type SettingFromV1 = SettingLevelV1 | 'default';

/** What a key reads for one person in one scope (3.3). */
export interface ResolvedSettingV1 {
	value: unknown;
	from: SettingFromV1;
	updatedAt?: number;
	updatedBy?: string;
}

/**
 * Resolve `key` of a section for one person (3.3): their own value, if the key may be set at `person`; the project's,
 * if a project is in scope and the key may be set there; the workspace's, if it may be set there; else the default.
 * A stored value that no longer validates, after a manifest narrowed the key, is skipped, and `warn` is told.
 */
export function resolveSetting(
	known: Pick<KnownSectionV1, 'fullId' | 'section' | 'checks'>,
	key: string,
	stored: Partial<Record<SettingLevelV1, StoredSettingV1>>,
	inProject: boolean,
	check: (key: SettingKeyV1, value: unknown) => string | undefined,
	warn?: (message: string) => void
): ResolvedSettingV1 {
	const declared = known.section.schema.properties[key] as SettingKeyV1;
	const levels = declared.levels ?? known.section.levels;
	const order: SettingLevelV1[] = inProject
		? ['person', 'project', 'workspace']
		: ['person', 'workspace'];
	for (const level of order) {
		const held = stored[level];
		if (!held || !levels.includes(level)) continue;
		const wrong = checkKnownValue(known, key, held.value, check)?.problem;
		if (wrong) {
			warn?.(`${known.fullId}.${key} at ${level} ${wrong}, so it is skipped`);
			continue;
		}
		return {
			value: held.value,
			from: level,
			updatedAt: held.updatedAt,
			updatedBy: held.updatedBy,
		};
	}
	return { value: declared.default, from: 'default' };
}

/**
 * Whether a hosted `provider` deployment refuses this write with `SHARED_RECORD_UNAVAILABLE` (section 13): a shared
 * value has no server record until phase 5's shell commands over MCP, and the browser's copy is never written in its
 * place. `setting-set` and `setting-reset` at `workspace` or `project` level; `autonomy-set` at every level, the
 * person's cap included; `experiment-*` for the workspace. Reusable by steps 8 and 9.
 */
export function sharedRecordUnavailable(
	hosted: boolean,
	command: string,
	input: { level?: unknown; audience?: unknown }
): boolean {
	if (!hosted) return false;
	if (command === 'setting-set' || command === 'setting-reset')
		return input.level === 'workspace' || input.level === 'project';
	if (command === 'autonomy-set') return true;
	if (command.startsWith('experiment-')) return input.audience === 'workspace';
	return false;
}

/** The settings section's address for a key, the hand-off's `route` (3.2): `~/settings/<section>#<key>`. */
export const settingRoute = (fullId: string, key: string): string => `~/settings/${fullId}#${key}`;

/** A writer's name in `updatedBy` (3.2): the person's id, or `agent:<id>` for an agent acting for them. */
export const writerOf = (actor: CommandContext['actor'], person: string): string =>
	actor?.kind === 'agent' ? `agent:${actor.id}` : person;

/** The writes whose own handler refuses every agent, at every level, with its hand-off (3.2, F2; 4.3; 5.4; 11). */
export const AGENT_REFUSED: readonly string[] = Object.freeze([
	'autonomy-set',
	'limit-usage-get',
	'experiment-enable',
	'experiment-disable',
]);
