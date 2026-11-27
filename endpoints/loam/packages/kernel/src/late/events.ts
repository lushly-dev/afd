/**
 * @fileoverview The bus (phase 5 specification, 9.2): `event-list`, its four tables, `canSeeEvent`, and the projection
 * of journal entries into events, in the `late` chunk. Each projected entry writes `event`, `event_meta`, `event_app`,
 * `event_app_meta` and any pruning in one atomic batch; before every `event-list`, at stage B and after each append,
 * the projection catches up from the durable journal (`(lastProjectedJournalSeq, head]`, in journal order), so a sink
 * error or a crash leaves no hole and no duplicate. No input, result, error message, approval token or content enters
 * an event: only kinds, ids, scopes and actors.
 */

import {
	type Actor,
	type CommandContext,
	type CommandResult,
	failure,
	type JournalEntry,
	type JournalSink,
	type JsonSchema,
	success,
} from '@lushly-dev/afd-core';
import { defineCommandWithSchema, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { EventHintV1, EventKindV1, EventV1, ResourceLinkV2 } from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import { z } from 'zod/mini';
import type { AppsRuntime } from '../apps-runtime.js';
import { type CallsV1, grantedInstances } from '../call-grant.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { type AccessActorV1, personOf } from '../scope/access.js';
import { canOpen } from '../scope/main-state.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { BusConfirmationV1, BusNotesV1 } from '../settings/confirmation-parts.js';

export const EVENT_TABLE = 'event';
export const EVENT_META_TABLE = 'event_meta';
export const EVENT_APP_TABLE = 'event_app';
export const EVENT_APP_META_TABLE = 'event_app_meta';
/** The workspace stream's retention (9.2): past it, the oldest event goes, and its app index entries with it. */
export const EVENT_RETENTION = 10_000;
/** `event-list`'s page (9.2's input bounds). */
export const EVENT_LIST_LIMIT = Object.freeze({ default: 50, max: 200 });

const CURSOR = /^v1\.(0|[1-9][0-9]{0,14})$/;
const pad = (seq: number): string => String(seq).padStart(15, '0');
const cursorOf = (seq: number): string => `v1.${seq}`;

/** An event as the `event` table keeps it: {@link EventV1}'s parts, and what `canSeeEvent` reads. */
export interface StoredEventV1 {
	id: string;
	workspace: string;
	seq: number;
	journalSeq: number;
	at: number;
	kind: EventKindV1;
	command: string;
	actor: string;
	onBehalfOf?: string;
	scope: ScopeV1;
	instance?: string;
	subject: ResourceLinkV2;
	/** Person-private: whose alone. */
	person?: string;
	/** The plugin whose own section, experiment or notice it is; an app sees only its own. */
	owner?: string;
	/** A notice's source instance; a confirmation's raising instance. */
	raiser?: string;
	raiserAgent?: string;
	session?: string;
	/** The `event_app` rows that index it, pruned with it. */
	indexed?: string[];
}

/** Who reads: a person, an agent (the copilot by session), or an app holding the `events` grant. */
export interface EventViewerV1 {
	person: string;
	actor?: AccessActorV1;
	agent?: string;
	session?: string;
	/** An app: its instance, its plugin id, its levels and the instances its `calls` grant reaches. */
	app?: { instance: string; plugin: string; project: boolean; granted: ReadonlySet<string> };
	/** A surface's or call's own project: an event of another project is not its. */
	project?: string;
}

/** What the bus reads of the late deps (`late/index.ts`), and the person the shell is for. */
export interface BusDeps {
	store: DataAdapter;
	/** The durable journal the projection catches up from; absent, nothing is projected live. */
	journal?: JournalSink;
	scope: ScopeRuntime;
	apps: () => AppsRuntime;
	isMutation: (name: string) => boolean;
	/** A replay's own state; the bus sets `events` there, so only `replayKernel` reaches its replay seam (9.2). */
	internals?: { replaying?: boolean; events?: Pick<Bus, 'replayed' | 'flush'> };
	/** A server's kernel (phase 6), and the deployment and identity whose host says whether this page is hosted. */
	gated?: boolean;
	deployment?: unknown;
	identity?: { mode: string };
}

/**
 * Whether the bus keeps its tables in this page (9.2): on the desktop and a static page, not a hosted lane, whose
 * writes are all the server's (phase 6's 6.1) and whose bus waits for milestone C. A `provider` page whose host is not
 * known counts as hosted, as `late/`'s own rule does.
 */
export function busLocal(deps: Pick<BusDeps, 'gated' | 'deployment' | 'identity'>): boolean {
	if (deps.gated) return false;
	const kind = (deps.deployment as { host?: { kind?: string } } | undefined)?.host?.kind;
	if (kind === 'hosted') return false;
	return deps.identity?.mode !== 'provider' || kind === 'desktop' || kind === 'static';
}

const actorString = (entry: JournalEntry): { actor: string; onBehalfOf?: string } => {
	const caller = entry.context?.caller;
	if (typeof caller === 'string') return { actor: `app:${caller}` };
	const actor = entry.actor as (Actor & { onBehalfOf?: string }) | undefined;
	if (actor?.kind === 'human') return { actor: `human:${actor.id}` };
	if (actor?.kind === 'agent')
		return {
			actor: `agent:${actor.id}`,
			...(actor.onBehalfOf ? { onBehalfOf: `human:${actor.onBehalfOf}` } : {}),
		};
	return { actor: 'system:shell' };
};

type Projected = Omit<StoredEventV1, 'id' | 'workspace' | 'seq' | 'journalSeq' | 'indexed'>;

const PROJECT_KINDS: Record<string, EventKindV1> = {
	'project-create': 'project-created',
	'project-update': 'project-updated',
	'project-archive': 'project-archived',
	'project-restore': 'project-restored',
};
const DOCUMENT_KINDS: Record<string, EventKindV1> = {
	'document-create': 'document-created',
	'document-import': 'document-created',
	'document-update': 'document-updated',
	'document-rename': 'document-updated',
	'document-move': 'document-updated',
	'document-link-add': 'document-updated',
	'document-link-remove': 'document-updated',
	'document-trash': 'document-trashed',
	'document-restore': 'document-restored',
};

const str = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
const scopeOf = (value: unknown, workspace: string): ScopeV1 => {
	const held = value as { workspace?: unknown; project?: unknown } | undefined;
	const project = str(held?.project);
	return { workspace: str(held?.workspace) ?? workspace, ...(project ? { project } : {}) };
};

/**
 * The events one journal entry projects (9.2's table), from the entry alone and the apps' owners: pure but for those,
 * so a replay projects what the live kernel did. Each holds ids, kinds, scopes and actors, never an input's value.
 */
export function projectEntry(
	entry: JournalEntry,
	workspace: string,
	apps: Pick<AppsRuntime, 'owners'> & Partial<Pick<AppsRuntime, 'summaries'>>,
	isMutation: (name: string) => boolean
): Projected[] {
	const { command } = entry;
	const at = Date.parse(entry.timestamp) || 0;
	const who = actorString(entry);
	const scope = scopeOf(entry.context?.scope, workspace);
	const person = personOf({ actor: entry.actor as AccessActorV1 });
	const base = { at, command, ...who, scope };
	const out: Projected[] = [];
	const input = (entry.input ?? {}) as Record<string, unknown>;
	const data = (entry.result.data ?? {}) as Record<string, unknown>;
	const caller = str(entry.context?.caller);
	const bus = entry.context?.bus as BusNotesV1 | undefined;
	// The confirmations the gate named (raised new, answered or withdrawn), whatever the call's own outcome.
	const confirmation = (kind: EventKindV1, row: BusConfirmationV1): Projected => ({
		...base,
		kind,
		scope: scopeOf(row.scope, workspace),
		...(apps.owners.get(row.command) ? { instance: apps.owners.get(row.command)?.instance } : {}),
		subject: {
			kind: 'confirmation',
			notification: row.notification,
			scope: scopeOf(row.scope, workspace),
		},
		person: row.person,
		...(row.raiser ? { raiser: row.raiser } : {}),
		...(row.agent ? { raiserAgent: row.agent } : {}),
		...(row.session ? { session: row.session } : {}),
	});
	if (bus?.raised) out.push(confirmation('confirmation-raised', bus.raised));
	for (const row of bus?.answered ?? []) out.push(confirmation('confirmation-answered', row));
	if (command === 'app-call-refuse' && caller) {
		out.push({
			...base,
			kind: 'call-refused',
			instance: caller,
			subject: { kind: 'app', instance: caller, scope },
		});
		return out;
	}
	if (entry.result.success !== true) return out;
	const project = PROJECT_KINDS[command];
	if (project) {
		const id = str(data.id);
		if (id) {
			const at_ = { workspace: scope.workspace, project: id };
			out.push({
				...base,
				kind: project,
				scope: at_,
				subject: { kind: 'project', project: id, scope: at_ },
			});
		}
		return out;
	}
	const documentKind = DOCUMENT_KINDS[command];
	if (documentKind) {
		const record = (data.document ?? data) as Record<string, unknown>;
		const id = str(record.id) ?? str(input.document) ?? str(data.from);
		const where = record.scope ? scopeOf(record.scope, workspace) : scope;
		if (id)
			out.push({
				...base,
				kind: documentKind,
				scope: where,
				subject: { kind: 'document', document: id, scope: where },
			});
		return out;
	}
	if (command === 'setting-set' || command === 'setting-reset') {
		const section = str(input.section);
		if (!section) return out;
		const level = input.level;
		const plugin = section.startsWith('loam.') ? undefined : section.split('.')[0];
		// The table's `instance`: the app's that owns the section, by its plugin id.
		const owning =
			plugin === undefined ? undefined : apps.summaries?.().find((app) => app.app === plugin);
		out.push({
			...base,
			kind: 'setting-changed',
			...(owning ? { instance: owning.instance } : {}),
			subject: { kind: 'section', section: 'settings', target: section, scope },
			...(plugin ? { owner: plugin } : {}),
			...(level === 'person' ? { person } : {}),
		});
		return out;
	}
	if (command === 'experiment-enable' || command === 'experiment-disable') {
		const experiment = str(input.experiment);
		out.push({
			...base,
			kind: 'experiment-changed',
			subject: { kind: 'section', section: 'settings', target: 'loam.experiments', scope },
			...(experiment ? { owner: experiment.split('.')[0] } : {}),
			...(input.audience === 'person' ? { person } : {}),
		});
		return out;
	}
	if (command === 'autonomy-set') {
		out.push({
			...base,
			kind: 'autonomy-changed',
			subject: { kind: 'section', section: 'settings', target: 'loam.autonomy', scope },
			person,
		});
		return out;
	}
	if (command === 'workspace-app-set' || command === 'app-instance-refresh') {
		const instance = str(input.instance);
		if (instance)
			out.push({
				...base,
				kind: 'app-changed',
				instance,
				subject: { kind: 'app', instance, scope },
			});
		return out;
	}
	if (command === 'notification-push' || command === 'toast-show') {
		const notice = data.notification as { id?: unknown } | string | undefined;
		const id = typeof notice === 'string' ? str(notice) : str(notice?.id);
		if (!id) return out;
		out.push({
			...base,
			kind: 'notification-pushed',
			...(caller ? { instance: caller, raiser: caller } : {}),
			subject: { kind: 'section', section: 'inbox', path: id, scope },
			person,
		});
		return out;
	}
	// An app's or a mount's own mutation (9.2): by its owner, read when it is projected.
	const owner = apps.owners.get(command);
	if (owner && isMutation(command)) {
		out.push({
			...base,
			kind: owner.recorded ? 'mount-mutated' : 'app-mutated',
			instance: owner.instance,
			subject: { kind: 'app', instance: owner.instance, scope },
		});
	}
	return out;
}

/**
 * The one visibility rule (9.2's matrix), for `event-list`, the per-app index and the push alike. Access is decided
 * again by the caller at each read, so a project the person left hides its events at once.
 */
export function canSeeEvent(
	event: Pick<
		StoredEventV1,
		| 'kind'
		| 'scope'
		| 'instance'
		| 'person'
		| 'owner'
		| 'raiser'
		| 'raiserAgent'
		| 'session'
		| 'actor'
	>,
	viewer: EventViewerV1,
	access: { allows(scope: ScopeV1): boolean; enabled(instance: string, scope: ScopeV1): boolean }
): boolean {
	if (event.person !== undefined && event.person !== viewer.person) return false;
	const project = event.scope.project;
	if (project !== undefined) {
		if (viewer.project !== undefined && viewer.project !== project) return false;
		if (viewer.app && !viewer.app.project) return false;
		if (viewer.app && !access.enabled(viewer.app.instance, event.scope)) return false;
		if (!access.allows(event.scope)) return false;
	}
	const confirmation =
		event.kind === 'confirmation-raised' || event.kind === 'confirmation-answered';
	const { app } = viewer;
	if (!app) {
		if (!confirmation) return true;
		if (viewer.session !== undefined) return event.session === viewer.session;
		if (viewer.agent !== undefined) return event.raiserAgent === viewer.agent;
		return true;
	}
	const reaches = (instance: string | undefined) =>
		instance !== undefined && (instance === app.instance || app.granted.has(instance));
	switch (event.kind) {
		case 'autonomy-changed':
			return false;
		case 'setting-changed':
		case 'experiment-changed':
			return event.owner === app.plugin;
		case 'notification-pushed':
			return event.raiser === app.instance;
		case 'call-refused':
			return event.actor === `app:${app.instance}`;
		case 'app-changed':
		case 'app-mutated':
		case 'mount-mutated':
		case 'mount-notified':
			return reaches(event.instance);
		case 'confirmation-raised':
		case 'confirmation-answered':
			return event.raiser === app.instance || reaches(event.instance);
		default:
			return true;
	}
}

interface Meta {
	id: string;
	headSeq: number;
	floorSeq: number;
	lastProjectedJournalSeq?: number;
}

const listInput = z.strictObject({
	since: z.optional(z.string().check(z.maxLength(64))),
	kinds: z.optional(
		// Each kind once, checked first in the handler (`kindsTwice`).
		z
			.array(z.string().check(z.minLength(1), z.maxLength(64), z.regex(/^[a-z][a-z0-9-]*$/)))
			.check(z.minLength(1), z.maxLength(32))
	),
	instance: z.optional(z.string().check(z.regex(/^(?!p$)[a-z][a-z0-9]{0,31}$/))),
	limit: z.optional(z.int().check(z.minimum(1), z.maximum(EVENT_LIST_LIMIT.max))),
});

/**
 * The input validator's own refusal of a kind named twice, as `z.refine` gave it: checked first in the handler, since
 * Zod Mini's `refine` would bring its custom type into first paint.
 */
const kindsTwice = (): CommandResult<never> => {
	const expectedFields = Object.keys(listInput.shape);
	return failure({
		code: 'VALIDATION_ERROR',
		message: 'Input validation failed',
		suggestion: `kinds: Name each kind once. Expected fields: ${expectedFields.join(', ')}`,
		details: {
			errors: [{ path: 'kinds', message: 'Name each kind once', code: 'custom' }],
			expectedFields,
		},
	});
};

/** What an app may hear: its manifest's grants, served, and the instances its `calls` grant reaches. */
interface AppReader {
	instance: string;
	plugin: string;
	project: boolean;
	events: boolean;
	granted: ReadonlySet<string>;
}

export type { BusConfirmationV1, BusNotesV1 };

/** `event-list`'s input as JSON Schema, which `literals.test.ts` holds equal to its Zod schema. */
const EVENT_LIST_JSON: JsonSchema = {
	type: 'object',
	properties: {
		since: { type: 'string', maxLength: 64 },
		kinds: {
			type: 'array',
			minItems: 1,
			maxItems: 32,
			items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$', minLength: 1, maxLength: 64 },
		},
		instance: { type: 'string', pattern: '^(?!p$)[a-z][a-z0-9]{0,31}$' },
		limit: { type: 'integer', minimum: 1, maximum: EVENT_LIST_LIMIT.max },
	},
	additionalProperties: false,
};

export interface Bus {
	command: ZodCommandDefinition;
	/**
	 * The sink accepted `entry`: its readers are decided now, with the state it left (9.2's index), and the write follows
	 * in journal order, batched.
	 */
	appended(entry: JournalEntry): void;
	/** Catch up from the durable journal now (stage B, and before each read). */
	catchUp(): Promise<void>;
	/**
	 * A replay's (9.2's replay parity): decide the readers of each original entry up to `through`, in journal order, with
	 * the state the replay has reached, as `appended` decides them live. Call after each entry the replay runs.
	 */
	replayed(entries: readonly JournalEntry[], through: number): void;
	/** Write every decided entry: the end of a replay. */
	flush(): Promise<void>;
	/** An app's push (9.2): its readable kinds, instances and cursor, coalesced within a microtask. */
	subscribe(
		instance: string,
		listener: (hint: EventHintV1) => void,
		boundScope?: ScopeV1
	): () => void;
}

/** Entries written in one atomic batch at most, so the first catch-up of an existing journal is bounded. */
export const PROJECTION_BATCH = 200;
/** Stream positions read in one list call. */
const READ_PAGE = 100;

/** One entry's events and, for each, the app streams that index it, decided with the state the entry left. */
interface Decided {
	entry: JournalEntry;
	events: Array<{ event: Projected; streams: string[] }>;
}

export function createBus(given: BusDeps, shellPerson: () => string | undefined): Bus {
	const { store } = given;
	const provider = given.identity?.mode === 'provider';
	const deps = {
		...given,
		workspace: () => given.scope.workspace.id,
		allows: (actor: AccessActorV1, scope: ScopeV1) => given.scope.allows(actor, scope),
		// Enabled where the scope is: no workspace disable, and a project it opens in (`canOpen`'s rule).
		enabled: (instance: string, scope: ScopeV1) =>
			canOpen(given.apps(), given.scope, instance, scope.project) === undefined,
		replaying: () => given.internals?.replaying === true,
		local: busLocal(given),
	};
	/**
	 * The person whose app streams an event joins (9.2): the signed-in reader on this device in `provider` mode, read from
	 * the settled session (never the clock), and `local` in `local` mode, where one person reads.
	 */
	const readerPerson = (): string => (provider ? (shellPerson() ?? 'local') : 'local');
	/** The same for a caller reading its stream. */
	const streamOf = (context: CommandContext): string =>
		provider ? personOf(context as { actor?: AccessActorV1 }) : 'local';
	let chain: Promise<void> = Promise.resolve();

	const readerOf = (instance: string): AppReader | undefined => {
		const apps = deps.apps();
		const detail = apps.detail(instance);
		if (!detail.success || !detail.data) return undefined;
		let manifest: ReturnType<AppsRuntime['port']>['manifest'];
		try {
			manifest = apps.port(instance).manifest;
		} catch {
			return undefined;
		}
		const grants = new Set(
			(detail.data.grants ?? []).filter((grant) => grant.served).map((grant) => grant.name)
		);
		return {
			instance,
			plugin: manifest.plugin.id,
			project: (manifest.app?.scope_levels ?? ['workspace']).includes('project'),
			events: grants.has('events'),
			granted: grantedInstances(apps.owners, instance, grants, manifest.calls as CallsV1),
		};
	};
	const readers = (): AppReader[] =>
		deps
			.apps()
			.summaries()
			.flatMap((app) => {
				const reader = app.state === 'ready' ? readerOf(app.instance) : undefined;
				return reader?.events ? [reader] : [];
			});
	/** An app reading for `person`; `stream`, the person whose stream it reads (the same in `provider` mode). */
	const viewerOfApp = (reader: AppReader, person: string, project?: string): EventViewerV1 => ({
		person,
		actor: person === 'local' ? undefined : { kind: 'human', id: person },
		app: reader,
		...(project !== undefined ? { project } : {}),
	});
	const accessFor = (viewer: EventViewerV1) => ({
		// `decideAccess` for the reader, a signed-out one included, who enters no member's project.
		allows: (scope: ScopeV1) => deps.allows(viewer.actor as AccessActorV1, scope),
		enabled: deps.enabled,
	});

	const metaId = () => deps.workspace();
	const streamId = (person: string, instance: string) =>
		`${deps.workspace()}:${person}:${instance}`;
	const eventId = (seq: number) => `ev:${deps.workspace()}:${pad(seq)}`;
	const appId = (stream: string, seq: number) => `ea:${stream}:${pad(seq)}`;
	const metaOf = async (table: string, id: string): Promise<Meta> =>
		(await store.get<Meta>(table, id)) ?? {
			id,
			headSeq: 0,
			floorSeq: 0,
			lastProjectedJournalSeq: 0,
		};

	/** Listeners, and what each has not heard yet. */
	const listeners = new Set<{
		instance: string;
		/** The reader, whose privacy and access decide; and the person whose stream it reads. */
		person: string;
		stream: string;
		project?: string;
		listener: (hint: EventHintV1) => void;
		pending?: { kinds: Set<EventKindV1>; instances: Set<string> };
	}>();
	let flushing = false;
	const notify = () => {
		if (flushing) return;
		flushing = true;
		queueMicrotask(async () => {
			flushing = false;
			for (const held of listeners) {
				const pending = held.pending;
				if (!pending) continue;
				held.pending = undefined;
				const head = await metaOf(EVENT_APP_META_TABLE, streamId(held.stream, held.instance));
				try {
					held.listener({
						kinds: [...pending.kinds],
						...(pending.instances.size > 0 ? { instances: [...pending.instances] } : {}),
						cursor: cursorOf(head.headSeq),
					});
				} catch (cause) {
					(globalThis as { reportError?(error: unknown): void }).reportError?.(cause);
				}
			}
		});
	};
	const heard = (event: StoredEventV1) => {
		for (const held of listeners) {
			const reader = readerOf(held.instance);
			if (!reader?.events) continue;
			const viewer = viewerOfApp(reader, held.person, held.project);
			if (!canSeeEvent(event, viewer, accessFor(viewer))) continue;
			held.pending ??= { kinds: new Set(), instances: new Set() };
			held.pending.kinds.add(event.kind);
			if (event.instance) held.pending.instances.add(event.instance);
		}
	};

	/**
	 * One entry's events and the app streams each joins, by `canSeeEvent` on the state as it is now: called when the
	 * entry is appended, or, in a replay, when the replay has run it, so both decide alike (9.2's replay parity).
	 */
	const decide = (entry: JournalEntry): Decided => {
		const events = projectEntry(entry, deps.workspace(), deps.apps(), deps.isMutation);
		if (events.length === 0) return { entry, events: [] };
		const person = readerPerson();
		const apps = readers();
		return {
			entry,
			events: events.map((event) => ({
				event,
				// The per-person, per-app index (T30): contiguous over what that app may read, so a gap tells nothing. A
				// person-private event joins only its own person's streams.
				streams:
					event.person !== undefined && provider && event.person !== person
						? []
						: apps.flatMap((reader) => {
								// In `local` mode the one person's own access decides: the entry's, or the private event's.
								const viewer = viewerOfApp(
									reader,
									provider
										? person
										: (event.person ?? personOf({ actor: entry.actor as AccessActorV1 }))
								);
								return canSeeEvent(event, viewer, accessFor(viewer))
									? [streamId(person, reader.instance)]
									: [];
							}),
			})),
		};
	};
	/** Decided and not yet written, in journal order, contiguous from the last write. */
	const decided: Decided[] = [];
	/** The highest journal seq queued in `decided`, so an entry is queued once, and only after every seq before it. */
	let decidedThrough = 0;
	/**
	 * Live entries decided as they were appended but not yet queued, by journal seq: an append during a catch-up waits
	 * here until the catch-up has read every entry before it, which then takes this decision (9.2's zero holes).
	 */
	const live = new Map<number, Decided>();

	/**
	 * The decided entries, `PROJECTION_BATCH` at a time, each batch one atomic write with its meta rows (9.2). A batch
	 * that is not written goes back to the front of the queue, its decisions kept.
	 */
	async function write(): Promise<void> {
		while (decided.length > 0) {
			const batch = decided.splice(0, PROJECTION_BATCH);
			try {
				await writeBatch(batch);
			} catch (cause) {
				decided.unshift(...batch);
				throw cause;
			}
		}
	}

	async function writeBatch(batch: Decided[]): Promise<void> {
		const meta = await metaOf(EVENT_META_TABLE, metaId());
		const fresh = batch.filter((each) => each.entry.seq > (meta.lastProjectedJournalSeq ?? 0));
		if (fresh.length === 0) return;
		const ops: Array<{ method: 'PUT' | 'DELETE'; path: string; body?: unknown }> = [];
		const written: StoredEventV1[] = [];
		const streams = new Map<string, Meta>();
		const streamMeta = async (key: string) => {
			const held = streams.get(key) ?? (await metaOf(EVENT_APP_META_TABLE, key));
			streams.set(key, held);
			return held;
		};
		const workspace = deps.workspace();
		for (const { entry, events } of fresh) {
			for (const { event: each, streams: joins } of events) {
				meta.headSeq += 1;
				const event: StoredEventV1 = {
					...each,
					id: eventId(meta.headSeq),
					workspace,
					seq: meta.headSeq,
					journalSeq: entry.seq,
				};
				const indexed: string[] = [];
				for (const key of joins) {
					const app = await streamMeta(key);
					app.headSeq += 1;
					const id = appId(key, app.headSeq);
					indexed.push(id);
					ops.push({
						method: 'PUT',
						path: `/${EVENT_APP_TABLE}/${encodeURIComponent(id)}`,
						body: { id, stream: key, eventSeq: event.seq, callerSeq: app.headSeq },
					});
				}
				if (indexed.length > 0) event.indexed = indexed;
				ops.push({
					method: 'PUT',
					path: `/${EVENT_TABLE}/${encodeURIComponent(event.id)}`,
					body: event,
				});
				written.push(event);
			}
		}
		// Retention: the oldest go with their index rows, read as one range, and each app's floor moves past what it lost.
		const over = meta.headSeq - meta.floorSeq - EVENT_RETENTION;
		if (over > 0) {
			const fromStore = (
				await store.list<StoredEventV1>(EVENT_TABLE, {
					workspace,
					sort: 'seq',
					order: 'asc',
					limit: over,
				})
			).data;
			const inBatch = written.filter((event) => event.seq <= meta.floorSeq + over);
			for (const old of [...fromStore, ...inBatch].filter(
				(event) => event.seq > meta.floorSeq && event.seq <= meta.floorSeq + over
			)) {
				ops.push({ method: 'DELETE', path: `/${EVENT_TABLE}/${encodeURIComponent(old.id)}` });
				for (const id of old.indexed ?? []) {
					ops.push({ method: 'DELETE', path: `/${EVENT_APP_TABLE}/${encodeURIComponent(id)}` });
					const key = id.slice(3, id.lastIndexOf(':'));
					const app = await streamMeta(key);
					app.floorSeq = Math.max(app.floorSeq, Number(id.slice(id.lastIndexOf(':') + 1)));
				}
			}
			meta.floorSeq += over;
		}
		for (const app of streams.values())
			ops.push({
				method: 'PUT',
				path: `/${EVENT_APP_META_TABLE}/${encodeURIComponent(app.id)}`,
				body: app,
			});
		meta.lastProjectedJournalSeq = (fresh.at(-1) as Decided).entry.seq;
		ops.push({
			method: 'PUT',
			path: `/${EVENT_META_TABLE}/${encodeURIComponent(meta.id)}`,
			body: meta,
		});
		const { summary } = await store.batch(ops);
		// Nothing of the batch was written: the catch-up's handler decides it again from the durable journal.
		if (summary.failed > 0) throw new Error('The event projection was not written');
		for (const event of written) heard(event);
	}

	// One hint per listener for each batch of work, however many events it projected.
	const run = (work: () => Promise<void>): Promise<void> => {
		const batch = () =>
			work().finally(() => {
				if (listeners.size > 0) notify();
			});
		const next = chain.then(batch, batch);
		chain = next.catch(() => {});
		return next;
	};

	/** Queue an entry read in journal order, with its live decision where it was appended, else decided now. */
	const take = (entry: JournalEntry) => {
		if (entry.seq <= decidedThrough) return;
		decidedThrough = entry.seq;
		decided.push(live.get(entry.seq) ?? decide(entry));
		live.delete(entry.seq);
	};
	/** Queue the live decisions that follow the queue without a gap; with `all`, every one, in seq order. */
	const advance = (all = false) => {
		for (const seq of [...live.keys()].sort((a, b) => a - b)) {
			if (seq > decidedThrough + 1 && !all) break;
			take((live.get(seq) as Decided).entry);
		}
	};
	/** Whether `decidedThrough` has been raised to the store's last write since this bus was made. */
	let synced = false;

	async function catchUpNow(): Promise<void> {
		if (deps.replaying() || !deps.local) return;
		const meta = await metaOf(EVENT_META_TABLE, metaId());
		if (!synced || decidedThrough < (meta.lastProjectedJournalSeq ?? 0)) {
			decidedThrough = Math.max(decidedThrough, meta.lastProjectedJournalSeq ?? 0);
			synced = true;
			for (const seq of live.keys()) if (seq <= decidedThrough) live.delete(seq);
		}
		// With no durable journal, what was appended is all there is.
		if (!deps.journal) {
			advance(true);
			return write();
		}
		// What the journal holds past what was queued, read a range at a time; a live append waits for the range before it.
		advance();
		for (;;) {
			const from = decidedThrough + 1;
			const entries = await deps.journal.read({ from, to: from + PROJECTION_BATCH - 1 });
			for (const entry of entries) take(entry);
			advance();
			if (entries.length < PROJECTION_BATCH) break;
			await write();
		}
		await write();
	}

	const catchUp = () =>
		run(async () => {
			try {
				await catchUpNow();
			} catch (cause) {
				// A failed write: every queued decision past the store's last write, an append's meanwhile included, goes
				// back to `live`, kept for the next catch-up, which reads the rest from the durable journal.
				synced = false;
				const last = await metaOf(EVENT_META_TABLE, metaId()).then(
					(meta) => meta.lastProjectedJournalSeq ?? 0,
					() => 0
				);
				for (const held of decided.splice(0))
					if (held.entry.seq > last) live.set(held.entry.seq, held);
				for (const seq of live.keys()) if (seq <= last) live.delete(seq);
				decidedThrough = last;
				throw cause;
			}
		});

	/** Stream positions `[from, to]` of a stream, read by offset from its floor in one list call per page. */
	async function range(
		reader: AppReader | undefined,
		key: string,
		floor: number,
		from: number,
		to: number
	): Promise<Array<{ seq: number; event: StoredEventV1 | undefined }>> {
		if (to < from) return [];
		const offset = from - floor - 1;
		const limit = to - from + 1;
		if (!reader) {
			const rows = (
				await store.list<StoredEventV1>(EVENT_TABLE, {
					workspace: deps.workspace(),
					sort: 'seq',
					order: 'asc',
					offset,
					limit,
				})
			).data;
			return rows.map((event) => ({ seq: event.seq, event }));
		}
		const rows = (
			await store.list<{ eventSeq: number; callerSeq: number }>(EVENT_APP_TABLE, {
				stream: key,
				sort: 'callerSeq',
				order: 'asc',
				offset,
				limit,
			})
		).data;
		if (rows.length === 0) return [];
		const { results } = await store.batch(
			rows.map((row) => ({
				method: 'GET' as const,
				path: `/${EVENT_TABLE}/${encodeURIComponent(eventId(row.eventSeq))}`,
			}))
		);
		return rows.map((row, index) => ({
			seq: row.callerSeq,
			event: (results[index]?.data ?? undefined) as StoredEventV1 | undefined,
		}));
	}

	/** The stream a caller reads: the workspace's, or its app's own index for this person. */
	async function list(input: z.infer<typeof listInput>, context: CommandContext) {
		if (input.kinds && new Set(input.kinds).size !== input.kinds.length) return kindsTwice();
		const caller = (context as KernelFieldContext).caller;
		const person = personOf(context as { actor?: AccessActorV1 });
		let reader: AppReader | undefined;
		if (caller !== undefined) {
			reader = readerOf(caller);
			if (!reader?.events)
				return kernelFailure(
					'GRANT_REQUIRED',
					'This app holds no events grant',
					"Ask the deployer to add the 'events' grant to this app's manifest"
				);
		}
		if (input.since !== undefined && !CURSOR.test(input.since)) return invalidCursor();
		await catchUp().catch(() => {});
		const callScope = (context as { scope?: ScopeV1 }).scope;
		const viewer: EventViewerV1 = reader
			? viewerOfApp(reader, person, callScope?.project)
			: {
					person,
					actor: context.actor as AccessActorV1,
					...(context.actor?.kind === 'agent' ? { agent: context.actor.id } : {}),
					...(typeof (context as { copilotSession?: unknown }).copilotSession === 'string'
						? { session: (context as { copilotSession: string }).copilotSession }
						: {}),
				};
		const key = reader ? streamId(streamOf(context), reader.instance) : '';
		const stream = reader
			? await metaOf(EVENT_APP_META_TABLE, key)
			: await metaOf(EVENT_META_TABLE, metaId());
		const since = input.since === undefined ? undefined : Number(input.since.slice(3));
		if (since !== undefined) {
			if (since > stream.headSeq) return invalidCursor();
			if (stream.floorSeq > 0 && since < stream.floorSeq)
				return kernelFailure(
					'EVENT_CURSOR_EXPIRED',
					'The events after this cursor are no longer kept',
					'Read the current state again, then call event-list with no since for a new cursor',
					{ retryable: false }
				);
		}
		const limit = input.limit ?? EVENT_LIST_LIMIT.default;
		const kinds = input.kinds ? new Set(input.kinds) : undefined;
		const access = accessFor(viewer);
		const matches = (event: StoredEventV1 | undefined): event is StoredEventV1 =>
			event !== undefined &&
			(!kinds || kinds.has(event.kind)) &&
			(input.instance === undefined || event.instance === input.instance) &&
			canSeeEvent(event, viewer, access);
		const found: Array<{ seq: number; event: StoredEventV1 }> = [];
		let hasMore = false;
		if (since === undefined) {
			// Tail: the most recent, ascending, a page at a time from the head; the cursor is the head, at or past the floor.
			for (let to = stream.headSeq; to > stream.floorSeq && found.length < limit; to -= READ_PAGE) {
				const from = Math.max(stream.floorSeq + 1, to - READ_PAGE + 1);
				const page = (await range(reader, key, stream.floorSeq, from, to)).filter((row) =>
					matches(row.event)
				) as Array<{ seq: number; event: StoredEventV1 }>;
				found.unshift(...page.slice(Math.max(0, page.length - (limit - found.length))));
			}
		} else {
			for (let from = since + 1; from <= stream.headSeq && !hasMore; from += READ_PAGE) {
				const to = Math.min(stream.headSeq, from + READ_PAGE - 1);
				for (const row of await range(reader, key, stream.floorSeq, from, to)) {
					if (!matches(row.event)) continue;
					if (found.length === limit) {
						hasMore = true;
						break;
					}
					found.push({ seq: row.seq, event: row.event });
				}
			}
		}
		const last = found.at(-1)?.seq;
		return success({
			events: found.map(({ seq, event }) => shown(event, seq, reader !== undefined)),
			cursor: cursorOf(hasMore && last !== undefined ? last : stream.headSeq),
			hasMore,
		});
	}

	const command = defineCommandWithSchema({
		name: 'event-list',
		description:
			'List what changed in the shell since a cursor: kinds, actors, scopes and links, never content. Omit since for the latest and a cursor',
		category: 'bus',
		mutation: false,
		executionTime: 'fast',
		input: listInput,
		jsonSchema: EVENT_LIST_JSON,
		handler: (input, context) => list(input, context) as Promise<CommandResult<never>>,
	}) as unknown as ZodCommandDefinition;

	const bus: Bus = {
		command,
		appended(entry) {
			if (deps.replaying() || !deps.local || entry.seq <= decidedThrough || live.has(entry.seq))
				return;
			// Decided now, with the state this entry left; queued once every entry before it is (by `advance`, or the
			// catch-up's read), never past a backlog the catch-up has not read.
			live.set(entry.seq, decide(entry));
			if (synced) advance();
			void catchUp().catch(() => {});
		},
		catchUp,
		replayed(entries, through) {
			if (!deps.local) return;
			for (const entry of entries) if (entry.seq <= through) take(entry);
		},
		flush: () => run(write),
		subscribe(instance, listener, boundScope) {
			const held = {
				instance,
				person: shellPerson() ?? 'local',
				stream: readerPerson(),
				...(boundScope?.project !== undefined ? { project: boundScope.project } : {}),
				listener,
			};
			listeners.add(held);
			return () => void listeners.delete(held);
		},
	};
	// A replay's journal stays empty, so `replayKernel` hands the bus the original entries itself, through here.
	if (given.internals?.replaying) given.internals.events = bus;
	return bus;
}

const invalidCursor = () =>
	kernelFailure(
		'EVENT_CURSOR_INVALID',
		'That cursor is not one event-list gave',
		'Pass the cursor event-list returned, or omit since for the latest',
		{ retryable: false }
	);

/** An event as a caller reads it (9.2): an app's at its own positions, a person never named to it. */
function shown(event: StoredEventV1, seq: number, app: boolean): EventV1 {
	return {
		id: `ev_${seq}`,
		seq,
		cursor: cursorOf(seq),
		at: event.at,
		kind: event.kind,
		command: event.command,
		actor: app && event.actor.startsWith('human:') ? 'human:person' : event.actor,
		...(!app && event.onBehalfOf ? { onBehalfOf: event.onBehalfOf } : {}),
		scope: event.scope,
		...(event.instance !== undefined ? { instance: event.instance } : {}),
		subject: event.subject,
	};
}
