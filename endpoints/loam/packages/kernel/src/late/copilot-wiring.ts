/**
 * @fileoverview What `late/` gives phase 5's enforcement and the copilot of phase 4's confirmations (phase 5
 * specification, 3.5, 6.1 to 6.3): a confirmation as the panel's card draws it, the confirmations an agent raised that
 * still wait, and the shell's own words for a command asked with no `confirm_prompt`. Reads of the inbox's table, by
 * its own rules, so neither the `late-copilot` nor the `late-settings` chunk is imported here.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ConfirmationRecordV1, NotificationV1 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import { mountCallGranted } from '../call-grant.js';
import { INTERNAL_COMMANDS } from '../commands.js';
import type { CopilotConfirmationCardV1, CopilotParts } from '../copilot/commands.js';
import type { AccessActorV1 } from '../scope/access.js';
import { personOf } from '../scope/access.js';
import { sessionActor } from '../scope/middleware.js';
import { teamListed } from '../scope/owners.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { slugOf } from '../scope/scope-commands.js';
import type { Autonomy } from '../settings/autonomy.js';
import type { Confirmations } from '../settings/confirmations.js';
import { DOCUMENT_KIT } from './command-kit.js';
import type { LateCommandDeps } from './index.js';

/** The inbox's table (phase 4's 10.1), where a confirmation is a row. */
const TABLE = 'notification';
const ID = /^ntf_[a-z0-9]{16}$/;

type Row = NotificationV1 & { kind: 'confirmation'; confirmation: ConfirmationRecordV1 };

const stateOf = (record: ConfirmationRecordV1, now: number): CopilotConfirmationCardV1['state'] =>
	record.state === 'pending' && now >= record.expiresAt ? 'expired' : record.state;

const isConfirmation = (row: unknown, workspace: string, person: string): row is Row =>
	typeof row === 'object' &&
	row !== null &&
	(row as Row).kind === 'confirmation' &&
	(row as Row).workspace === workspace &&
	(row as Row).person === person &&
	typeof (row as Row).confirmation === 'object' &&
	(row as { cslot?: unknown }).cslot === undefined;

/** One of the person's confirmations, as the panel's card draws it (6.2), or undefined for none of theirs. */
export async function confirmationCardOf(
	store: DataAdapter,
	workspace: string,
	id: string,
	person: string,
	now: number
): Promise<CopilotConfirmationCardV1 | undefined> {
	if (!ID.test(id)) return undefined;
	const row = await store.get<Row>(TABLE, id);
	if (!isConfirmation(row, workspace, person)) return undefined;
	const record = row.confirmation;
	return {
		id: row.id,
		state: stateOf(record, now),
		title: record.title,
		header: record.header,
		prompt: record.prompt,
		command: record.command,
		// Whole: the person confirms what they read (the review's B11); the card is read by id, as the inbox's whole read.
		input: structuredClone(record.input ?? {}),
		scope: row.scope,
		danger: record.danger === true,
		...(record.session !== undefined ? { session: record.session } : {}),
		...(record.trace !== undefined
			? { raisedBy: { turn: record.trace.turn, call: record.trace.call } }
			: {}),
		...(record.asked !== undefined ? { asked: structuredClone(record.asked) } : {}),
		// A released mounted command's preview, for the person who reads the card (phase 5 specification, 7.2).
		...(record.preview !== undefined ? { preview: structuredClone(record.preview) } : {}),
		expiresAt: record.expiresAt,
	};
}

/** The person's confirmations an agent raised that still wait now, for approval health's `expired` (6.3). */
export async function pendingAskedOf(
	store: DataAdapter,
	workspace: string,
	person: string,
	now: number
): Promise<
	Array<{ command: string; scope: ScopeV1; reason: 'policy' | 'taint' | 'unit'; createdAt: number }>
> {
	const listed = await store.list<Row>(TABLE, { person } as never);
	return listed.data.flatMap((row) =>
		isConfirmation(row, workspace, person) &&
		row.confirmation.asked !== undefined &&
		stateOf(row.confirmation, now) === 'pending'
			? [
					{
						command: row.confirmation.command,
						scope: row.scope,
						reason: row.confirmation.asked.reason,
						createdAt: row.createdAt,
					},
				]
			: []
	);
}

/**
 * A mounted instance's refusal of a project it does not serve, as `apps/mounted.ts`'s `unlistedProject` words it (its
 * `copilot/enforce.test.ts` holds the two alike), so enforcement refuses before asking (6.1's order). Not imported
 * from there, so `late` parts no chunk of the apps'.
 */
export function mountProjectRefusal(
	listed: readonly string[] | undefined,
	slug: string | undefined,
	visible: (slug: string) => boolean
): CommandResult<never> | undefined {
	if (listed === undefined || (slug !== undefined && listed.includes(slug))) return undefined;
	const shown = listed.filter(visible);
	return {
		success: false,
		error: {
			code: 'MOUNT_PROJECT_NOT_LISTED',
			message:
				slug === undefined
					? 'This instance serves only its projects'
					: `This instance does not serve the project \`${slug}\``,
			suggestion: `Switch to a project this instance serves${shown.length > 0 ? `: ${shown.join(', ')}` : ''}`,
			retryable: false,
		},
	};
}

/**
 * The shell's own words for an agent's call asked with no `confirm_prompt` (6.1, 6.2): the command's title, and why it
 * asked. The chain of rows is on the record, which the card and the inbox draw in words.
 */
export function genericAskedOf(
	command: { name: string; title?: string | undefined; destructive?: boolean | undefined },
	instance: string,
	held: 'destructive' | 'approval' | undefined,
	/** The sources a taint names, when taint asked (5.3). */
	tainted?: readonly string[]
): { prompt: string; instance: string; title: string; danger: boolean } {
	return {
		prompt:
			tainted && tainted.length > 0 && held === undefined
				? `Asked because the conversation includes content from ${tainted.join(', ')}.`
				: held === 'destructive'
					? 'Agents always ask before a command that cannot be undone.'
					: held === 'approval'
						? 'Agents always ask before a command that needs a person’s approval.'
						: 'Your autonomy setting asks before agents run this.',
		instance,
		title: (command.title ?? command.name).slice(0, 120),
		danger: held === 'destructive' || command.destructive === true,
	};
}

/**
 * Phase 3's 3.4 fifth row: an agent's `project-create` of a slug a team instance lists, or with `access`, and
 * `project-update` with `access`, are `HUMAN_REQUIRED` in their handlers, never asked (phase 5's 6.1). By value, as
 * the handlers decide (the reviews' I5): an `access` key holding `undefined` is no `access`.
 */
export function membersHandOff(
	name: string,
	input: unknown,
	listed: (slug: string) => boolean
): boolean {
	if (name !== 'project-create' && name !== 'project-update') return false;
	const asked =
		typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
	if (asked.access !== undefined) return true;
	if (name !== 'project-create') return false;
	const slug =
		typeof asked.slug === 'string'
			? asked.slug
			: typeof asked.name === 'string'
				? slugOf(asked.name)
				: undefined;
	return slug !== undefined && listed(slug);
}

/**
 * What bounds a command at `ask` for an agent (6.1): a destructive definition, an AFD `approval`, or a mounted tool's
 * `approval: 'required'`, which is the mount's, not its definition's (the review's B6).
 */
export function heldByOf(
	name: string,
	definition: (ZodCommandDefinition & { approval?: unknown }) | undefined,
	apps: AppsRuntime
): 'destructive' | 'approval' | undefined {
	if (definition?.destructive === true) return 'destructive';
	// `required`, or a policy decided per call (held, failing safe); `not-required` holds nothing (re-check 2, B6).
	if (definition?.approval !== undefined && definition.approval !== 'not-required')
		return 'approval';
	const owner = apps.owners.get(name);
	if (!owner?.recorded) return undefined;
	// Its registration's, which an agent-only command's palette row would not show (the review's B6).
	if (owner.approval === 'required') return 'approval';
	const rows = apps.commandList(owner.instance);
	const row = rows.success ? rows.data?.commands.find((each) => each.name === name) : undefined;
	// `required` alone: a server's `not-required` holds nothing (the re-check's N3).
	return (row as { approval?: unknown } | undefined)?.approval === 'required'
		? 'approval'
		: undefined;
}

/** A mounted instance that does not serve the call's project, refused before any question (6.1's order, B7). */
export function mountPreflight(
	name: string,
	context: CommandContext,
	apps: AppsRuntime,
	scope: ScopeRuntime
): CommandResult<never> | undefined {
	const owner = apps.owners.get(name);
	if (!owner?.recorded) return undefined;
	const call = context as { actor?: AccessActorV1; scope?: ScopeV1 };
	const project = call.scope?.project;
	return mountProjectRefusal(
		scope.workspaceApps.get(owner.instance)?.projects,
		project === undefined ? undefined : scope.projects.get(project)?.slug,
		(slug) => {
			const found = scope.projects.all().find((each) => each.slug === slug);
			return (
				found !== undefined &&
				scope.allows(call.actor as AccessActorV1, {
					workspace: scope.workspace.id,
					project: found.id,
				})
			);
		}
	);
}

/**
 * A confirmation's card for the copilot (6.2): a reader's, by the inbox's rule, an absent actor too (a signed-out
 * `local` page), so a row of a scope they may not enter now is none (re-checks 3 and 4); the kernel's own lookups name
 * no reader.
 */
export const readerCard =
	(store: DataAdapter, scope: ScopeRuntime, clock: () => number) =>
	async (
		id: string,
		person: string,
		options: { now?: number; reader?: { actor: unknown } }
	): Promise<CopilotConfirmationCardV1 | undefined> => {
		const card = await confirmationCardOf(
			store,
			scope.workspace.id,
			id,
			person,
			options.now ?? clock()
		);
		if (card && options.reader && !scope.allows(options.reader.actor as AccessActorV1, card.scope))
			return undefined;
		return card;
	};

/** Which pending rows a turn's end withdraws (3.5): by the session and turn stored on each, or one by id. */
export const withdrawalMatch =
	(match: { session: string; turn: number } | { id: string }) =>
	(row: { id: string; confirmation: ConfirmationRecordV1 }): boolean =>
		'id' in match
			? row.id === match.id
			: row.confirmation.session === match.session && row.confirmation.trace?.turn === match.turn;

/** A native or view app's `confirm_prompt` (phase 4's 7.2); a mounted tool's is refused. */
export function confirmPromptFor(
	apps: AppsRuntime,
	command: string
): { prompt: string; instance: string; title: string; danger: boolean } | undefined {
	const owner = apps.owners.get(command);
	const definition = owner && apps.commands.find((each) => each.name === command);
	const prompt = (definition as { confirmPrompt?: string } | undefined)?.confirmPrompt;
	if (!owner || !definition || typeof prompt !== 'string' || owner.recorded) return undefined;
	return {
		prompt,
		instance: owner.instance,
		title: definition.title ?? command,
		danger: definition.destructive === true,
	};
}

/**
 * A mounted command as 4.5 and 5.1 read it: its instance, its entry's `labels`, whether the entry names it, and the
 * deployer's words for the instance (its entry's or manifest's title), never the server's.
 */
export function mountOf(
	apps: AppsRuntime,
	name: string
):
	| { instance: string; labels: 'whole' | 'per-part'; named: boolean; deployerText: string }
	| undefined {
	const owner = apps.owners.get(name);
	if (!owner?.recorded) return undefined;
	const title = apps.summaries().find((app) => app.instance === owner.instance)?.title;
	return {
		instance: owner.instance,
		labels: owner.labels === 'per-part' ? 'per-part' : 'whole',
		named: owner.named === true,
		deployerText: title ? `A command of ${title.slice(0, 80)}, a mounted server.` : '',
	};
}

/**
 * The confirmed run's re-check of its caller (phase 4's 7.2, phase 5's 7.5): an app calls its own commands, and a
 * mounted callee's under its `calls` grant, the port's own rule, read live (B7). Undefined when it still may.
 */
export const badCaller = (
	apps: AppsRuntime,
	caller: string | undefined,
	owner: string,
	command: string
): string | undefined =>
	caller === undefined || caller === owner || callsGranted(apps, caller, command)
		? undefined
		: `'${caller}' may not call it`;

/** An app's call to a mounted callee (7.5): the port's own rule, read live (B7). */
export function callsGranted(apps: AppsRuntime, caller: string, command: string): boolean {
	const detail = apps.detail(caller);
	let calls: ReturnType<AppsRuntime['port']>['manifest']['calls'];
	try {
		calls = apps.port(caller).manifest.calls;
	} catch {
		return false;
	}
	const granted = new Set(
		detail.success
			? (detail.data?.grants ?? []).filter((each) => each.served).map((each) => each.name)
			: []
	);
	return mountCallGranted(apps.owners.get(command), command, caller, granted, calls);
}

/** Shell reads whose result lists a mounted catalog: its servers' names, descriptions and schemas (B1). */
const CATALOG_READS: readonly string[] = [
	'app-command-list',
	'app-instance-list',
	'app-instance-refresh',
	'app-get',
	'app-list',
	'palette-search',
];

/**
 * The mounted instances whose servers' words a shell read's result can carry (B1): the instance it names, and every
 * mounted instance or command of one the result names.
 */
export function mountWordsIn(
	apps: AppsRuntime,
	name: string,
	input: unknown,
	result: CommandResult
): { whole: string[]; vouched: string[] } {
	if (!CATALOG_READS.includes(name)) return { whole: [], vouched: [] };
	const text = JSON.stringify((result as { data?: unknown }).data ?? {});
	const asked = (input as { instance?: unknown } | null)?.instance;
	const named = new Set<string>();
	// A `per-part` instance's words are its claims, which taint nothing (5.1); an instance with no command known yet is
	// read as `whole`.
	const vouched = new Set(
		[...apps.owners.values()].flatMap((owner) =>
			owner.recorded && owner.labels === 'per-part' ? [owner.instance] : []
		)
	);
	for (const [command, owner] of apps.owners) {
		if (!owner.recorded || vouched.has(owner.instance)) continue;
		if (
			owner.instance === asked ||
			text.includes(`"${command}"`) ||
			text.includes(`"${owner.instance}"`)
		)
			named.add(owner.instance);
	}
	for (const row of apps.instances())
		if (
			!vouched.has(row.instance) &&
			(row.instance === asked || text.includes(`"${row.instance}"`))
		)
			named.add(row.instance);
	const claims = [...vouched].filter(
		(instance) =>
			instance === asked ||
			text.includes(`"${instance}"`) ||
			[...apps.owners].some(
				([command, owner]) => owner.instance === instance && text.includes(`"${command}"`)
			)
	);
	return { whole: [...named], vouched: claims };
}

/** Whether the app owning a native or view command holds `grant`, served (5.3's `http`). */
export function holdsGrant(apps: AppsRuntime, name: string, grant: string): boolean {
	const owner = apps.owners.get(name);
	if (!owner || owner.recorded) return false;
	const detail = apps.detail(owner.instance);
	return (
		detail.success === true &&
		(detail.data?.grants ?? []).some((each) => each.name === grant && each.served)
	);
}

/** What the copilot's wiring reads of `late/`, built after it: each by a getter, read at a call, never at the wiring. */
export interface CopilotWiringRefs {
	settings(): { refusesAgent(name: string, input: unknown): boolean } | undefined;
	autonomy(): Pick<Autonomy, 'resolveFor'>;
	confirmations(): Pick<Confirmations, 'withdraw' | 'chain'>;
	definitionOf(name: string): (ZodCommandDefinition & { approval?: unknown }) | undefined;
	confirmPromptOf(name: string): unknown;
	digest(value: unknown): Promise<string>;
	/** `HUMAN_COMMANDS` and `OWNER_COMMANDS`, from the `late-identity` chunk, which this module does not import. */
	humanOnly(name: string): boolean;
	/** `PERSON_SESSION`, `late/`'s own. */
	personSession(name: string): boolean;
}

/**
 * The copilot's records, commands and phase 5's enforcement (its 6.1), wired to `late/`'s parts: the `late-copilot`
 * chunk's factory is given, so this module imports nothing of that chunk.
 */
export function copilotPartsOf(
	create: typeof import('../copilot/commands.js').createCopilotParts,
	deps: LateCommandDeps,
	refs: CopilotWiringRefs
): CopilotParts {
	return create({
		store: deps.store,
		workspace: deps.scope.workspace.id,
		options: deps.copilot,
		kit: DOCUMENT_KIT,
		isMutation: deps.isMutation,
		isMounted: (name) => deps.apps().owners.get(name)?.recorded === true,
		instanceOf: (name) => deps.apps().owners.get(name)?.instance,
		// 7.3: a unit's submit names its server's tool; the shell's name for it is the instance's own.
		commandOfTool: (instance, tool) => {
			for (const [name, owner] of deps.apps().owners)
				if (owner.recorded && owner.instance === instance && owner.tool === tool) return name;
			return undefined;
		},
		// 4.5 and 5.1: the entry's `labels`, whether it names the command, and the deployer's words for the instance.
		mountOf: (name) => mountOf(deps.apps(), name),
		// 5.3: a native or view app whose `http` grant is served.
		holdsHttp: (name) => holdsGrant(deps.apps(), name, 'http'),
		// B1: a shell read listing a mounted catalog carries its servers' words.
		mountWordsOf: (name, input, result) => mountWordsIn(deps.apps(), name, input, result),
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
		humanOnly: refs.humanOnly,
		// A write whose own handler refuses every agent with its hand-off reaches that handler (phase 4's 3.2, F2).
		handlerRefuses: (name, input) =>
			refs.settings()?.refusesAgent(name, input) === true ||
			membersHandOff(name, input, (slug) => teamListed(deps.scope.workspaceApps.all(), slug)),
		enterable: (context) =>
			deps.scope.allows(
				context.actor as AccessActorV1,
				(context as { scope?: ScopeV1 }).scope ?? {
					workspace: deps.scope.workspace.id,
				}
			),
		internal: (name) => INTERNAL_COMMANDS.includes(name),
		digest: async (value) => refs.digest(value),
		now: () => deps.clock?.now() ?? Date.now(),
		person: () => personOf({ actor: sessionActor(deps.auth, deps.clock) }),
		// Phase 5's enforcement (its 6.1), over phase 4's autonomy and confirmations, built below.
		resolve: (name, context) => refs.autonomy().resolveFor(name, context),
		heldBy: (name) => heldByOf(name, refs.definitionOf(name), deps.apps()),
		// A mounted instance that does not serve the call's project refuses before any question (6.1's order, B7).
		preflight: (name, context) => mountPreflight(name, context, deps.apps(), deps.scope),
		journaled: (name, context) => deps.journaled?.(name, context) ?? true,
		declares: (name) => refs.confirmPromptOf(name) !== undefined,
		personSession: refs.personSession,
		confirmationOf: (id, person, options = {}) => {
			if (options.traceId !== undefined) {
				deps.recordOrder?.(options.traceId, 'record:confirmation')?.read();
				if (options.reader) deps.recordOrder?.(options.traceId, 'record:project')?.read();
			}
			// Serialize with the person's confirmation writes so a reshow batch and its observe swap
			// are never observed mid-transition (#2307).
			return refs
				.confirmations()
				.chain(person, () =>
					readerCard(deps.store, deps.scope, () => deps.clock?.now() ?? Date.now())(
						id,
						person,
						options
					)
				);
		},
		allows: (actor, scope) => deps.scope.allows(actor as AccessActorV1, scope),
		pendingAsked: (person, traceId) => {
			if (traceId !== undefined) deps.recordOrder?.(traceId, 'record:confirmation')?.read();
			return pendingAskedOf(
				deps.store,
				deps.scope.workspace.id,
				person,
				deps.clock?.now() ?? Date.now()
			);
		},
		// By the session and turn the kernel stored on each, or one id; with no call, on the kernel's clock (3.5).
		withdraw: (context, match, person) =>
			refs
				.confirmations()
				.withdraw(
					context ?? ({ clock: { now: () => deps.clock?.now() ?? Date.now() } } as CommandContext),
					withdrawalMatch(match),
					person
				),
	});
}

/**
 * Phase 5's `ask` of a command that declares no `confirm_prompt` (6.1, 6.2), in the shell's words, naming the bound
 * enforcement put in the chain, if any.
 */
export function genericAskedFor(
	definition: (ZodCommandDefinition & { approval?: unknown }) | undefined,
	instance: string | undefined,
	enforced: {
		asked: { chain: ReadonlyArray<{ id: string }>; reason?: string; sources?: readonly string[] };
	}
): ReturnType<typeof genericAskedOf> | undefined {
	if (!definition) return undefined;
	const held = enforced.asked.chain.find(
		(step) => step.id === 'destructive' || step.id === 'approval'
	)?.id as 'destructive' | 'approval' | undefined;
	return genericAskedOf(
		definition,
		instance ?? 'shell',
		held,
		enforced.asked.reason === 'taint' ? enforced.asked.sources : undefined
	);
}
