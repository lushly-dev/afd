/**
 * @fileoverview Agent members (phase 3 specification, 8; D90, D111), in the `late-identity` chunk: the `agent-member-*`
 * commands over the kernel's `agent-member` table, the sponsor's journaled membership read (`membership-settle`, 4.4),
 * and the suspension of the agent members whose sponsor left (`agent-member-settle`, 8.3).
 *
 * - **No account at the provider.** A record is a row of Loam's store, never a user, session or credential (8.1).
 * - **Every person and agent a rule names is read from the call's stamped actor** (`personOf(context)` in a handler,
 *   `call.actor` in the scope middleware), after afd-auth's middleware has run: the agent interface gains its
 *   `onBehalfOf` only in the chain (step 5's B1), so nothing here keys on the actor before the chain.
 * - **Line 4** is `decideAccess`'s; this part keeps the table it reads (`scope.agents`) in step with the store.
 * - **The sponsor confirms** (D111): a record naming another person is `pending` until they run `agent-member-confirm`,
 *   and a new sponsor or wider access asks again; an owner naming themselves confirms by doing it. The sponsor may
 *   withdraw an active one (`agent-member-withdraw`), which only takes access away (#2781).
 *
 * Everything a first-paint or `late` module holds reaches this chunk through its deps, so first paint's shared modules
 * are not parted into a chunk of their own (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { LoamKernelErrorCode } from '../errors.js';
import type {
	AccessDecisionV2,
	AccessInputV2,
	MemberRoleV1,
	MembershipV1,
} from '../scope/access.js';
import type { RecordCache } from '../scope/cache.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { AgentMemberV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { AGENT_MEMBER_TABLE, AGENT_MEMBER_UNDO_TABLE } from '../scope/tables.js';
import type { LoamAuthAdapter } from './member-commands.js';

/** An agent member's id: `agt_` and 20 of `[a-z0-9]` (3.2). */
export const AGENT_MEMBER_ID = /^agt_[a-z0-9]{20}$/;

/** Most projects an agent member's `access` names. */
export const AGENT_PROJECTS_MAX = 200;

/** Most bytes of an agent member's `guidance` (8.1). */
export const GUIDANCE_MAX_BYTES = 8 * 1024;

/** The undo window with no workspace row: `trashDays`' default, 30 days. */
export const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Most kept records per agent member: an undo older than the newest twenty is gone. */
export const UNDO_KEPT_MAX = 20;

/** A kept record (`agent-member-undo`). */
interface KeptRow {
	id: string;
	agent: string;
	record: AgentMemberV1;
	createdAt: number;
}

/** A warning `agent-member-list` shows an owner (8.3): the sponsor can no longer enter a project the record names. */
export const SPONSOR_PROJECT_LOST = 'SPONSOR_PROJECT_LOST';

/**
 * An agent member as a caller sees it (8.2): `access.projects` holds only the projects the caller's person may enter,
 * `hiddenProjects` counts the rest; `guidance` only for an owner or the sponsor; the sponsor's name; and, for an owner,
 * `warnings`. Never a seat (7.2, D40).
 */
export interface AgentMemberRowV1 {
	id: string;
	kind: AgentMemberV1['kind'];
	name: string;
	description?: string;
	sponsor: string;
	/**
	 * The sponsor's name, as the members tab shows it; null when they are no member of the workspace. Only a read
	 * answers it, from the provider's members: a write is re-run in a replay, which never reaches the provider (3.4).
	 */
	sponsorName?: string | null;
	installedBy: string;
	access: AgentMemberV1['access'];
	hiddenProjects: number;
	guidance?: string;
	status: AgentMemberV1['status'];
	suspended?: AgentMemberV1['suspended'];
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
	/** For an owner, on a read (as `sponsorName`): `SPONSOR_PROJECT_LOST` when the sponsor lost a project it names. */
	warnings?: string[];
}

/** One person of the workspace as the sponsor rules read them. */
interface RosterPerson {
	name: string;
	role: MemberRoleV1;
	digest?: string | undefined;
}

/** The table the kernel's line 4 reads, written through by this part: a record removed leaves it too. */
export interface AgentMemberCache extends RecordCache<AgentMemberV1> {
	drop(id: string): void;
}

export interface AgentMembersDeps {
	auth: LoamAuthAdapter;
	/** A principal-gated kernel's (9.5): the account is read only by the call's person, through `accountFor`. */
	gated?: boolean;
	identity?: IdentityV1 | undefined;
	/** The workspace store: the `agent-member` table. */
	store: DataAdapter;
	scope: ScopeRuntime;
	/** Boot's own: never queued, top-level and journaled, which the two settles run as (4.4). */
	runBoot(name: string, input: unknown): Promise<{ success: boolean }>;
	/** Whether a replay runs: it replays the settles' entries and reads nothing. */
	replaying(): boolean;
	/**
	 * How long a kept record stays undoable, in ms: the workspace's `trashDays`, the shell's window for restoring what
	 * was removed (documents specification, 4.1). Default 30 days.
	 */
	undoWindowMs?(): Promise<number>;
	kit: Pick<DocumentKit, 'define' | 'success' | 'z' | 'kernelFailure' | 'personOf' | 'callNow'> & {
		decideAccess(input: AccessInputV2): AccessDecisionV2;
		isOwner(membership: MembershipV1, person: string | undefined): boolean;
		/** `MEMBERSHIP_UNAVAILABLE`: the sponsor's read failed before `name`, or its settle did. */
		membershipUnavailable(name: string): CommandResult<never>;
	};
}

const SUGGESTIONS: Readonly<Partial<Record<LoamKernelErrorCode, string>>> = {
	AGENT_MEMBER_NOT_FOUND: 'List the agent members with agent-member-list and name one of them',
	AGENT_MEMBER_SPONSOR_ONLY: 'Only its sponsor confirms, declines or withdraws it; ask them',
	AGENT_MEMBER_NOT_PENDING:
		'Only a pending agent member is confirmed or declined; an owner names its sponsor again with agent-member-update',
	AGENT_MEMBER_NOT_ACTIVE:
		'Only an active agent member is withdrawn: decline a pending one with agent-member-decline; a suspended one can do nothing until an owner names its sponsor again with agent-member-update',
	OWNER_REQUIRED: 'Ask an owner of the workspace to do this',
};

/** A name's control and format characters, which could make it read as another field (step 4's NIT 4). */
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
const VISIBLE = /[^\s\p{Cc}\p{Cf}]/u;

/** Whether `next` gives more than `before`: the workspace, `sponsor`, or a project `before` did not name (8.2). */
export function widens(before: AgentMemberV1['access'], next: AgentMemberV1['access']): boolean {
	if (next.workspace && !before.workspace) return true;
	if (before.projects === 'sponsor') return false;
	return next.projects === 'sponsor' || next.projects.some((id) => !before.projects.includes(id));
}

export function createAgentMembers(deps: AgentMembersDeps) {
	const { store, scope, kit } = deps;
	const { z } = kit;
	const provider = deps.identity?.mode === 'provider';

	// The table line 4 reads: loaded once at stage B, then written through by every write here (3.3).
	const held = new Map<string, AgentMemberV1>();
	const cache: AgentMemberCache = {
		async load(from) {
			held.clear();
			const { data } = await from.list<AgentMemberV1>(AGENT_MEMBER_TABLE);
			for (const record of data) held.set(record.id, record);
		},
		get: (id) => held.get(id),
		all: () => [...held.values()],
		put(record) {
			held.set(record.id, record);
		},
		drop(id) {
			held.delete(id);
		},
	};

	const fail = (code: LoamKernelErrorCode, message: string, suggestion?: string) =>
		kit.kernelFailure(
			code,
			message,
			suggestion ?? SUGGESTIONS[code] ?? 'Read the message, then change the request'
		);
	const notFound = () => fail('AGENT_MEMBER_NOT_FOUND', 'No agent member has this id');
	const invalid = (message: string, suggestion: string) =>
		fail('VALIDATION_ERROR', message, suggestion);

	/** The person the call is for, from its stamped actor (3.1, step 5's B1). */
	const personOf = (context: CommandContext) => kit.personOf(context);
	/** An owner of the workspace (7.1): in `local` mode every actor; in `provider` mode on the membership held. */
	const ownerOf = (context: CommandContext) =>
		kit.isOwner(scope.membershipOf(context), personOf(context));

	/** An installed agent member's record, from the store: a connected one is never in the kernel's table (9.2). */
	async function recordOf(id: string): Promise<AgentMemberV1 | undefined> {
		if (!AGENT_MEMBER_ID.test(id)) return undefined;
		const row = await store.get<AgentMemberV1>(AGENT_MEMBER_TABLE, id);
		return row?.kind === 'installed' ? row : undefined;
	}

	/**
	 * The workspace's people as the sponsor rules read them: in `provider` mode, every page of the provider's members
	 * (`/loam/members`, any member's read); in `local` mode, the one person, the caller's, as `member-list` shows them.
	 */
	async function roster(context: CommandContext): Promise<Map<string, RosterPerson>> {
		const people = new Map<string, RosterPerson>();
		// On the server, the provider's server API by the call's person (9.2); never `local`'s answer in `provider` mode.
		const account = accountOf(context);
		if (provider && !account) {
			throw Object.assign(new Error('The sign-in provider is not reachable from this kernel'), {
				code: 'IDENTITY_PROVIDER_UNAVAILABLE',
			});
		}
		if (!account) {
			const state = deps.auth.getSession();
			const user = state.status === 'authenticated' ? state.user : undefined;
			people.set(personOf(context), {
				name: user?.name ?? user?.email ?? 'You',
				role: 'owner',
			});
			return people;
		}
		// Every page while the offset is short of the total: the provider skips a member row with no user, so a short page
		// is not the last, and a sponsor on a later one would read as gone (the review's I6).
		for (let offset = 0, total = 1; offset < total; offset += 200) {
			const page = await account.members({ limit: 200, offset });
			for (const person of page.people) {
				people.set(person.id, { name: person.name, role: person.role, digest: person.digest });
			}
			total = page.total;
		}
		return people;
	}

	/** The membership the roster says: who may enter what, for the sponsor rules (8.3). */
	const membershipOf = (people: Map<string, RosterPerson>): MembershipV1 =>
		provider
			? {
					mode: 'provider',
					members: new Map([...people].map(([id, person]) => [id, person.role])),
					digest: '',
				}
			: scope.membership;

	/** Whether `person`, a member of `membership`, may enter `project` (3.3, steps 1 to 3 for a person). */
	const mayEnter = (membership: MembershipV1, person: string, project: string): boolean =>
		kit.decideAccess({
			actor: { kind: 'human', id: person },
			scope: { workspace: scope.workspace.id, project },
			project: scope.projects.get(project),
			membership,
			agent: undefined,
		}).allowed;

	/**
	 * On the server's kernel (9.5), the roster `prepare` read for one call, by its context: the sponsor rules decide on it,
	 * since the server holds no kernel-wide membership and runs no `membership-settle` (phase 6's step 5). In a browser,
	 * the kernel's membership, which that settle recorded.
	 */
	const rosters = new WeakMap<object, MembershipV1>();
	const heldFor = (context: CommandContext): MembershipV1 =>
		rosters.get(context) ?? scope.membership;
	// Sponsors a read found no member of the workspace, whose agent members `agent-member-settle` suspends (8.3).
	const left = new Set<string>();
	/** In a hosted `provider` browser, the server suspends them (phase 6's A4) and the copy follows: none here. */
	let heldByServer = false;
	/** The installed agent members a person sponsors that are not suspended yet: the ones their leaving suspends. */
	const sponsoredBy = (person: string) =>
		cache.all().filter((agent) => agent.sponsor === person && agent.status !== 'suspended');
	/**
	 * A read found `person` no member: their agent members are suspended by the next {@link flush}. `provider` mode's
	 * alone: in `local` mode the roster is whoever is signed in, and every actor is a member (2.1).
	 */
	function noteLeft(person: string): string[] {
		if (!provider || deps.replaying() || heldByServer) return [];
		const agents = sponsoredBy(person);
		if (agents.length > 0) left.add(person);
		return agents.map((agent) => agent.id);
	}
	/** A roster read: each active or pending agent member's sponsor it does not hold has left (8.3). */
	function heard(people: Map<string, RosterPerson>): void {
		if (!provider) return;
		for (const agent of cache.all()) if (!people.has(agent.sponsor)) noteLeft(agent.sponsor);
	}
	/**
	 * The suspensions noted, journaled as one top-level `agent-member-settle` (4.4, 8.3), after the call that found
	 * them; a replay replays the entry instead.
	 */
	async function flush(): Promise<void> {
		if (left.size === 0 || deps.replaying()) return;
		const people = [...left];
		left.clear();
		const agents = people.flatMap((person) =>
			sponsoredBy(person).map((agent) => ({ agent: agent.id, suspended: 'sponsor-left' as const }))
		);
		if (agents.length > 0) await deps.runBoot('agent-member-settle', { agents });
	}

	/**
	 * A row filtered for the call's person (8.2). With `people`, a read's, the sponsor's name and an owner's warnings,
	 * from the provider's members; without, a write's, neither (3.4: a write re-runs in a replay, reaching no provider).
	 */
	function rowFor(
		agent: AgentMemberV1,
		context: CommandContext,
		people: Map<string, RosterPerson> | undefined,
		owner: boolean
	): AgentMemberRowV1 {
		const person = personOf(context);
		const listed = agent.access.projects;
		// Another person's connected agent, read in a browser, names none of its projects, only their count (#2784).
		const withheld = (agent as { withheldProjects?: number }).withheldProjects ?? 0;
		const seen =
			listed === 'sponsor'
				? listed
				: listed.filter((id) => mayEnter(scope.membershipOf(context), person, id));
		const read = people
			? (() => {
					const sponsor = people.get(agent.sponsor);
					const roles = membershipOf(people);
					const lost =
						owner &&
						sponsor !== undefined &&
						listed !== 'sponsor' &&
						withheld === 0 &&
						listed.some((id) => !mayEnter(roles, agent.sponsor, id));
					return {
						sponsorName: sponsor?.name ?? null,
						warnings: lost ? [SPONSOR_PROJECT_LOST] : [],
					};
				})()
			: undefined;
		return {
			id: agent.id,
			kind: agent.kind,
			name: agent.name,
			...(agent.description !== undefined ? { description: agent.description } : {}),
			sponsor: agent.sponsor,
			...(read ? { sponsorName: read.sponsorName } : {}),
			installedBy: agent.installedBy,
			access: { workspace: agent.access.workspace, projects: seen },
			hiddenProjects:
				listed === 'sponsor' ? 0 : listed.length - (seen as string[]).length + withheld,
			...(agent.guidance !== undefined && (owner || agent.sponsor === person)
				? { guidance: agent.guidance }
				: {}),
			status: agent.status,
			...(agent.suspended !== undefined ? { suspended: agent.suspended } : {}),
			createdAt: agent.createdAt,
			updatedAt: agent.updatedAt,
			updatedBy: agent.updatedBy,
			...(read ? { warnings: read.warnings } : {}),
		};
	}

	/** The call's person's account capability (9.2): on the server, the provider's by that person; else the adapter's. */
	const accountOf = (context: CommandContext) =>
		provider
			? deps.auth.accountFor
				? deps.auth.accountFor(personOf(context))
				: deps.gated
					? undefined
					: deps.auth.account
			: undefined;

	/** A provider read or write that failed (9.2): its own code where it says one, else an outage, each with its fix. */
	const providerRefusal = (cause: unknown): CommandResult<never> => {
		const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown };
		if (code === 'OWNER_REQUIRED')
			return fail('OWNER_REQUIRED', 'Only an owner of the workspace can remove a connected agent');
		return kit.kernelFailure(
			'IDENTITY_PROVIDER_UNAVAILABLE',
			typeof message === 'string' ? message : 'The sign-in provider did not answer',
			'Try again in a moment; the sign-in provider did not answer',
			{ retryable: true }
		);
	};

	/**
	 * The workspace's connected agents (9.2), from the provider's own table: in `provider` mode, through the account
	 * capability; none in `local` mode, or from a provider that keeps none. A failed read fails the call (the caller's
	 * `try` answers it), never leaving them out silently.
	 */
	async function connectedOf(context: CommandContext): Promise<AgentMemberV1[]> {
		const read = accountOf(context)?.agents;
		if (!read) return [];
		return (await read()).map(({ scopes: _scopes, ...agent }) => ({
			...agent,
			kind: 'connected' as const,
		}));
	}

	/**
	 * Every agent member, oldest first, installed ones from the kernel's table and connected ones from the provider's,
	 * filtered for the call's person (8.2); the roster read is heard (8.3).
	 */
	async function rowsFor(context: CommandContext): Promise<AgentMemberRowV1[]> {
		const agents = [...cache.all(), ...(await connectedOf(context))];
		if (agents.length === 0) return [];
		const people = await roster(context);
		heard(people);
		const owner = ownerOf(context);
		return agents
			.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
			.map((agent) => rowFor(agent, context, people, owner));
	}

	/** `agt_` and 20 of `[a-z0-9]` from the command's random, so a replay reproduces it (3.2). */
	const newId = (context: CommandContext): string => {
		const draw = () => (context.random?.next() ?? Math.random()).toString(36).slice(2);
		return `agt_${`${draw()}${draw()}${draw()}00000000000000000000`.slice(0, 20)}`;
	};

	/** A name a person reads as one: no control or format character, and something visible (8.1, 14). */
	const nameRefusal = (name: string | undefined) =>
		name !== undefined && (HIDDEN.test(name) || !VISIBLE.test(name))
			? invalid(
					"An agent member's name holds a control or format character, or nothing visible",
					'Name it with visible characters only'
				)
			: undefined;
	const guidanceRefusal = (guidance: string | null | undefined) =>
		typeof guidance === 'string' && new TextEncoder().encode(guidance).length > GUIDANCE_MAX_BYTES
			? invalid(
					`Guidance is limited to ${GUIDANCE_MAX_BYTES} bytes`,
					'Shorten the guidance, or keep the rest in a document the agent reads'
				)
			: undefined;

	/**
	 * `access` as given, its projects named by id or slug and kept as ids, repeated ones once (8.1), with each id's
	 * reference as the caller wrote it, which is all a refusal quotes (the review's I2). A malformed value is
	 * `VALIDATION_ERROR`; a project no record has stays as named, so the sponsor rule refuses it as one they may not
	 * enter, in the same words as a restricted one, and no caller learns whether it exists.
	 */
	function accessOf(
		value: unknown,
		context: CommandContext,
		labels: Map<string, string>,
		blind: Set<string>
	): AgentMemberV1['access'] | CommandResult<never> {
		const asked = value as { workspace?: unknown; projects?: unknown };
		const projects = asked.projects;
		if (
			typeof asked.workspace !== 'boolean' ||
			!(
				projects === 'sponsor' ||
				(Array.isArray(projects) &&
					projects.length <= AGENT_PROJECTS_MAX &&
					projects.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256))
			)
		) {
			return invalid(
				'access is { workspace: boolean; projects: string[] | "sponsor" }',
				`Name up to ${AGENT_PROJECTS_MAX} projects by id or slug, or "sponsor" for whatever the sponsor may enter`
			);
		}
		if (projects === 'sponsor') return { workspace: asked.workspace, projects };
		// A reference resolves only to a project the caller may enter; any other stays as written and is refused as a
		// missing one, so an owner learns nothing of a restricted project they cannot see (decided by the coordinator on
		// 2026-11-15; to name one, an owner first adds themselves, D96).
		const caller = personOf(context);
		const ids = (projects as string[]).map((ref) => {
			const found = scope.project(ref);
			const visible = found !== undefined && mayEnter(heldFor(context), caller, found.id);
			const at = visible ? found.id : ref;
			if (!visible) blind.add(at);
			if (!labels.has(at)) labels.set(at, ref);
			return at;
		});
		return { workspace: asked.workspace, projects: [...new Set(ids)] };
	}

	/**
	 * The sponsor rules (8.3): a person member of the workspace, on the membership `membership-settle` recorded before
	 * the call (4.4), who may enter every project the record names. The projects are named only to the owner calling.
	 */
	function sponsorRefusal(
		context: CommandContext,
		sponsor: string,
		access: AgentMemberV1['access'],
		labels: Map<string, string> = new Map(),
		blind: ReadonlySet<string> = new Set()
	): CommandResult<never> | undefined {
		const member = provider ? heldFor(context).members.has(sponsor) : sponsor === personOf(context);
		if (sponsor.startsWith('agt_') || !member) {
			return fail(
				'AGENT_SPONSOR_INVALID',
				'The sponsor must be a person who is a member of the workspace',
				'Name a member as the sponsor: list them with member-list'
			);
		}
		if (access.projects === 'sponsor') return undefined;
		const lost = access.projects.filter(
			(id) => blind.has(id) || !mayEnter(heldFor(context), sponsor, id)
		);
		if (lost.length === 0) return undefined;
		// Each as the caller wrote it; one the record already held is named only when the caller may enter it, and the
		// rest counted, so a refusal names nothing hidden from the caller (I2, I3).
		const caller = personOf(context);
		const named = lost.flatMap((id) => {
			const label = labels.get(id) ?? (mayEnter(heldFor(context), caller, id) ? id : undefined);
			return label === undefined ? [] : [`'${label}'`];
		});
		const unseen = lost.length - named.length;
		const parts = [
			...named,
			...(unseen > 0 ? [`${unseen} ${unseen === 1 ? 'project' : 'projects'} you can't see`] : []),
		];
		return fail(
			'AGENT_SPONSOR_INVALID',
			`The sponsor cannot enter ${parts.join(', ')}`,
			'Name only projects the sponsor can enter, or add the sponsor to them first'
		);
	}

	/** `OWNER_REQUIRED` unless the call's person is an owner, on the membership read again before it (7.1, 7.6). */
	const ownerRefusal = (context: CommandContext) =>
		ownerOf(context)
			? undefined
			: fail(
					'OWNER_REQUIRED',
					'Only an owner of the workspace can add, change or remove an agent member'
				);

	const id = z.string().check(z.minLength(1), z.maxLength(256));
	const ID_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 256 };
	const name = z.string().check(z.minLength(1), z.maxLength(80));
	const NAME_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 80 };
	const DESCRIPTION_JSON: JsonSchema = {
		anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
	} as JsonSchema;
	const GUIDANCE_JSON: JsonSchema = {
		anyOf: [{ type: 'string', maxLength: GUIDANCE_MAX_BYTES }, { type: 'null' }],
	} as JsonSchema;
	const ACCESS_JSON: JsonSchema = {
		type: 'object',
		properties: {
			workspace: { type: 'boolean' },
			projects: {
				anyOf: [
					{
						type: 'array',
						items: { type: 'string', minLength: 1, maxLength: 256 },
						maxItems: AGENT_PROJECTS_MAX,
					},
					{ type: 'string', enum: ['sponsor'] },
				],
			},
		},
		required: ['workspace', 'projects'],
		additionalProperties: false,
	} as unknown as JsonSchema;
	const access = z.optional(
		z.strictObject({
			workspace: z.boolean(),
			projects: z.union([
				z
					.array(z.string().check(z.minLength(1), z.maxLength(256)))
					.check(z.maxLength(AGENT_PROJECTS_MAX)),
				z.enum(['sponsor']),
			]),
		})
	);
	const description = z.optional(z.nullable(z.string().check(z.maxLength(500))));
	const guidance = z.optional(z.nullable(z.string().check(z.maxLength(GUIDANCE_MAX_BYTES))));

	/** The status a write leaves (D111): the caller who is the sponsor confirms by doing it; anyone else, `pending`. */
	const askedOf = (context: CommandContext, sponsor: string): AgentMemberV1['status'] =>
		sponsor === personOf(context) ? 'active' : 'pending';

	/**
	 * The agent-member writes run one at a time, in call order, each from its read to its write (#2781's review): calls
	 * run concurrently, and the server's kernel serves several people at once, so a change that read an active record
	 * before its sponsor withdrew it must not write it back active after. No write calls another while it holds the turn,
	 * and `agent-member-remove` reaches the provider for a connected agent outside it.
	 */
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(run: () => Promise<T>): Promise<T> => {
		const next = tail.then(run, run);
		tail = next.catch(() => {});
		return next;
	};
	const defineWrite: typeof kit.define = (definition) =>
		kit.define({
			...definition,
			handler: (input, context) => serial(() => definition.handler(input, context)),
		});

	/** The whole record, put as one write: a field cleared is gone, which a patch would keep (8.1). */
	const write = async (record: AgentMemberV1) => {
		// The store's `PUT` merges, so the row is deleted and put again in one atomic batch.
		const path = `/${AGENT_MEMBER_TABLE}/${encodeURIComponent(record.id)}`;
		const { summary } = await store.batch([
			{ method: 'DELETE', path },
			{ method: 'PUT', path, body: record },
		]);
		if (summary.failed > 0) throw new Error(`The store could not write '${record.id}'`);
		cache.put(record);
	};
	/** `agu_` and 20 of `[a-z0-9]` from the command's random, so a replay reproduces it. */
	const undoId = (context: CommandContext): string => {
		const draw = () => (context.random?.next() ?? Math.random()).toString(36).slice(2);
		return `agu_${`${draw()}${draw()}${draw()}00000000000000000000`.slice(0, 20)}`;
	};
	/**
	 * Drop the kept records past the undo window, and past the newest {@link UNDO_KEPT_MAX} per agent member, on each
	 * read and write, on the call's clock, so a replay drops the same ones (step 6's final check).
	 */
	const prune = async (context: CommandContext): Promise<void> => {
		const window = (await deps.undoWindowMs?.()) ?? UNDO_WINDOW_MS;
		const now = kit.callNow(context);
		const rows = (await store.list<KeptRow>(AGENT_MEMBER_UNDO_TABLE)).data.sort(
			(a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)
		);
		const seen = new Map<string, number>();
		for (const row of rows) {
			const count = (seen.get(row.agent) ?? 0) + 1;
			seen.set(row.agent, count);
			if (row.createdAt < now - window || count > UNDO_KEPT_MAX)
				await store.remove(AGENT_MEMBER_UNDO_TABLE, row.id);
		}
	};
	/** Keep the record a write replaces, under an opaque id its undo names (8.2; the review's I3). */
	const keep = async (record: AgentMemberV1, context: CommandContext): Promise<string> => {
		const undo = undoId(context);
		await store.create(AGENT_MEMBER_UNDO_TABLE, {
			id: undo,
			agent: record.id,
			record,
			createdAt: kit.callNow(context),
		});
		await prune(context);
		return undo;
	};
	/** The record an undo restores, for that agent member's id alone when given, or undefined; pruned first. */
	const kept = async (
		undo: string,
		agent: string | undefined,
		context: CommandContext
	): Promise<AgentMemberV1 | undefined> => {
		await prune(context);
		const row = await store.get<KeptRow>(AGENT_MEMBER_UNDO_TABLE, undo);
		return row && (agent === undefined || row.agent === agent) ? row.record : undefined;
	};
	const noUndo = () =>
		invalid(
			'Nothing to undo with this id for this agent member',
			'Run the undo the shell offered, once; or change the agent member with agent-member-update'
		);
	/** The fields an undo restores, as an input would give them: the record's own ids, no reference to quote. */
	const fieldsOf = (record: AgentMemberV1) => ({
		name: record.name,
		sponsor: record.sponsor,
		access: record.access,
		description: record.description ?? null,
		guidance: record.guidance ?? null,
	});

	/** A write's row for the caller, with nothing read of the provider (3.4). */
	const answer = (record: AgentMemberV1, context: CommandContext) =>
		rowFor(record, context, undefined, ownerOf(context));

	const undoString = z.string().check(z.minLength(1), z.maxLength(64));
	const undoRef = z.optional(undoString);
	const UNDO_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 64 };
	// Either an undo of `-remove`, naming the kept record alone, or a new agent member's fields: exactly one.
	const addInput = z.xor([
		z.strictObject({ undo: undoString }),
		z.strictObject({ name, sponsor: id, access, description, guidance }),
	]);
	const add = defineWrite<typeof addInput, AgentMemberRowV1>({
		name: 'agent-member-add',
		title: 'Add an agent member',
		description:
			'Add an agent member sponsored by a person member: pending until the sponsor confirms, unless you are its sponsor. It has no account and cannot sign in; it is not a seat',
		category: 'member',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: addInput,
		jsonSchema: {
			type: 'object',
			oneOf: [
				{
					type: 'object',
					properties: { undo: UNDO_JSON },
					required: ['undo'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: {
						name: NAME_JSON,
						sponsor: ID_JSON,
						access: ACCESS_JSON,
						description: DESCRIPTION_JSON,
						guidance: GUIDANCE_JSON,
					},
					required: ['name', 'sponsor'],
					additionalProperties: false,
				},
			],
		} as unknown as JsonSchema,
		async handler(input, context) {
			const owned = ownerRefusal(context);
			if (owned) return owned;
			// An undo of `agent-member-remove` names the record it kept, alone (8.2; I3); a new one names its fields.
			const undo = 'undo' in input ? input.undo : undefined;
			const restored = undo === undefined ? undefined : await kept(undo, undefined, context);
			if (undo !== undefined && !restored) return noUndo();
			const given = restored
				? fieldsOf(restored)
				: (input as Exclude<typeof input, { undo: string }>);
			const refused = nameRefusal(given.name) ?? guidanceRefusal(given.guidance);
			if (refused) return refused;
			const labels = new Map<string, string>();
			const blind = new Set<string>();
			// A kept record's projects are its own ids, already the sponsor's to check; a new one's are references.
			const access = restored
				? restored.access
				: accessOf(given.access ?? { workspace: false, projects: [] }, context, labels, blind);
			if ('success' in access) return access;
			const sponsored = sponsorRefusal(context, given.sponsor, access, labels, blind);
			if (sponsored) return sponsored;
			const agent = restored?.id ?? newId(context);
			if (await store.get(AGENT_MEMBER_TABLE, agent)) {
				return invalid(
					'That agent member is in the workspace already',
					'Change it with agent-member-update'
				);
			}
			const person = personOf(context);
			const now = kit.callNow(context);
			const record: AgentMemberV1 = {
				id: agent,
				workspace: scope.workspace.id,
				kind: 'installed',
				name: given.name,
				...(typeof given.description === 'string' ? { description: given.description } : {}),
				sponsor: given.sponsor,
				installedBy: person,
				access,
				...(typeof given.guidance === 'string' ? { guidance: given.guidance } : {}),
				status: askedOf(context, given.sponsor),
				createdAt: now,
				updatedAt: now,
				updatedBy: person,
			};
			await write(record);
			if (undo !== undefined) await store.remove(AGENT_MEMBER_UNDO_TABLE, undo);
			return kit.success(answer(record, context), {
				undoCommand: 'agent-member-remove',
				undoArgs: { agent },
			});
		},
	});

	const updateInput = z.strictObject({
		agent: id,
		name: z.optional(name),
		description,
		access,
		guidance,
		sponsor: z.optional(id),
		undo: undoRef,
	});
	const update = defineWrite<typeof updateInput, AgentMemberRowV1>({
		name: 'agent-member-update',
		title: 'Change an agent member',
		description:
			'Change an agent member; a new sponsor, or wider access, waits for the sponsor to confirm again unless you are its sponsor. Naming a sponsor reactivates a suspended one',
		category: 'member',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: updateInput,
		jsonSchema: {
			type: 'object',
			properties: {
				agent: ID_JSON,
				name: NAME_JSON,
				description: DESCRIPTION_JSON,
				access: ACCESS_JSON,
				guidance: GUIDANCE_JSON,
				sponsor: ID_JSON,
				undo: UNDO_JSON,
			},
			required: ['agent'],
			additionalProperties: false,
		},
		async handler(asked, context) {
			const owned = ownerRefusal(context);
			if (owned) return owned;
			const before = await recordOf(asked.agent);
			if (!before) return notFound();
			// An undo names the record the change replaced, alone, and restores its every field (8.2; I3).
			const restored =
				asked.undo === undefined ? undefined : await kept(asked.undo, asked.agent, context);
			if (asked.undo !== undefined) {
				const others = Object.keys(asked).filter((key) => key !== 'undo' && key !== 'agent');
				if (!restored || others.length > 0) return noUndo();
			}
			// The kept sponsor counts as named only when it differs, so undoing a rename of a suspended record leaves it
			// suspended (8.3; step 6's final check).
			const { sponsor: keptSponsor, ...keptFields } = restored
				? fieldsOf(restored)
				: { sponsor: '' };
			const input = restored
				? {
						agent: asked.agent,
						...keptFields,
						...(keptSponsor !== before.sponsor ? { sponsor: keptSponsor } : {}),
					}
				: asked;
			const refused = nameRefusal(input.name) ?? guidanceRefusal(input.guidance);
			if (refused) return refused;
			const labels = new Map<string, string>();
			const blind = new Set<string>();
			const access =
				input.access === undefined
					? before.access
					: restored
						? restored.access
						: accessOf(input.access, context, labels, blind);
			if ('success' in access) return access;
			const sponsor = input.sponsor ?? before.sponsor;
			// The sponsor rules run when the access or the sponsor is given (8.3).
			if (input.access !== undefined || input.sponsor !== undefined) {
				const sponsored = sponsorRefusal(context, sponsor, access, labels, blind);
				if (sponsored) return sponsored;
			}
			// A suspended one is reactivated only by naming a sponsor, who then confirms (8.3); otherwise a new sponsor or
			// wider access asks the sponsor again (D111).
			const asks =
				before.status === 'suspended'
					? input.sponsor !== undefined
					: sponsor !== before.sponsor || widens(before.access, access);
			const person = personOf(context);
			// `null` removes a description or guidance; absent keeps it.
			const described = input.description === undefined ? before.description : input.description;
			const guided = input.guidance === undefined ? before.guidance : input.guidance;
			const { suspended: _suspended, description: _d, guidance: _g, ...unchanged } = before;
			const next: AgentMemberV1 = {
				...unchanged,
				...(input.name !== undefined ? { name: input.name } : {}),
				...(typeof described === 'string' ? { description: described } : {}),
				...(typeof guided === 'string' ? { guidance: guided } : {}),
				access,
				sponsor,
				status: asks ? askedOf(context, sponsor) : before.status,
				...(!asks && before.suspended !== undefined ? { suspended: before.suspended } : {}),
				updatedAt: kit.callNow(context),
				updatedBy: person,
			};
			await write(next);
			if (asked.undo !== undefined) await store.remove(AGENT_MEMBER_UNDO_TABLE, asked.undo);
			// Undo restores the record this replaced, by an id that names nothing (8.2; I3); the status it leaves is the
			// rules' own, so an undo never confirms.
			return kit.success(answer(next, context), {
				undoCommand: 'agent-member-update',
				undoArgs: { agent: before.id, undo: await keep(before, context) },
			});
		},
	});

	const removeInput = z.strictObject({ agent: id, forget: z.optional(z.boolean()) });
	const remove = kit.define<typeof removeInput, { removed: true }>({
		name: 'agent-member-remove',
		title: 'Remove an agent member',
		description:
			'Remove an agent member: it can no longer act in the workspace. Undo adds it again, pending until its sponsor confirms unless you are its sponsor',
		category: 'member',
		mutation: true,
		undoable: true,
		destructive: true,
		executionTime: 'fast',
		input: removeInput,
		jsonSchema: {
			type: 'object',
			properties: { agent: ID_JSON, forget: { type: 'boolean' } },
			required: ['agent'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const refused = ownerRefusal(context);
			if (refused) return refused;
			if (!(await recordOf(input.agent))) {
				// A connected agent, not in the kernel's table, is removed at the provider (9.2): kept `suspended: 'owner'`,
				// or deleted with `forget`. Recorded, so a replay answers it from its entry; no undo. Outside the write
				// turn: it writes nothing of the kernel's, and a provider that never answers then holds no other write.
				const removeAgent = accountOf(context)?.removeAgent;
				try {
					const connected = removeAgent
						? (await connectedOf(context)).some((agent) => agent.id === input.agent)
						: false;
					if (!connected || !removeAgent) return notFound();
					await removeAgent(input.agent, input.forget === true);
				} catch (cause) {
					return providerRefusal(cause);
				}
				return kit.success({ removed: true as const });
			}
			// An installed one, read again in the write turn.
			return serial(async () => {
				const before = await recordOf(input.agent);
				if (!before) return notFound();
				const undo = await keep(before, context);
				await store.remove(AGENT_MEMBER_TABLE, before.id);
				cache.drop(before.id);
				// Undo adds the record again by the id it was kept under, naming nothing else (8.2; I3).
				return kit.success(
					{ removed: true as const },
					{ undoCommand: 'agent-member-add', undoArgs: { undo } }
				);
			});
		},
	});

	const listInput = z.strictObject({
		status: z.optional(z.enum(['active', 'pending', 'suspended', 'all'])),
	});
	const list = kit.define<typeof listInput, { agents: AgentMemberRowV1[] }>({
		name: 'agent-member-list',
		description:
			"List the workspace's agent members with their sponsors, filtered to what you may see; none is a seat",
		category: 'member',
		mutation: false,
		executionTime: 'fast',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: ['active', 'pending', 'suspended', 'all'] },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const status = input.status ?? 'all';
			const agents = await rowsFor(context);
			return kit.success({
				agents: status === 'all' ? agents : agents.filter((agent) => agent.status === status),
			});
		},
	});

	const agentInput = z.strictObject({ agent: id });
	const AGENT_JSON: JsonSchema = {
		type: 'object',
		properties: { agent: ID_JSON },
		required: ['agent'],
		additionalProperties: false,
	};
	const get = kit.define<typeof agentInput, AgentMemberRowV1>({
		name: 'agent-member-get',
		description: 'Get one agent member with its sponsor, filtered to what you may see',
		category: 'member',
		mutation: false,
		executionTime: 'fast',
		input: agentInput,
		jsonSchema: AGENT_JSON,
		async handler(input, context) {
			const held = cache.get(input.agent);
			// An installed one from the kernel's table, else a connected one from the provider's (9.2).
			const record =
				held?.kind === 'installed'
					? held
					: held === undefined
						? await connectedOf(context).then(
								(agents) => agents.find((agent) => agent.id === input.agent),
								(cause: unknown) => providerRefusal(cause)
							)
						: undefined;
			if (record && 'success' in record) return record;
			if (!record) return notFound();
			const people = await roster(context);
			heard(people);
			return kit.success(rowFor(record, context, people, ownerOf(context)));
		},
	});

	/**
	 * `agent-member-confirm` and `-decline`, the sponsor alone, of a pending record (8.2, D111); and `-withdraw`, the
	 * sponsor alone, of an active one (#2781). Withdrawing only takes access away: the record is suspended and says why,
	 * keeps its access as it was, and has no undo; an owner reactivates it only by naming a sponsor, who confirms (8.3).
	 * A connected agent is not in the kernel's table: its person disconnects it with `account-agent-disconnect` (5.3).
	 */
	const answerAsSponsor = (verb: 'confirm' | 'decline' | 'withdraw') =>
		defineWrite<typeof agentInput, AgentMemberRowV1>({
			name: `agent-member-${verb}`,
			title:
				verb === 'confirm'
					? 'Confirm an agent member you sponsor'
					: verb === 'decline'
						? 'Decline to sponsor an agent member'
						: 'Withdraw an agent member you sponsor',
			description:
				verb === 'confirm'
					? 'As its sponsor, confirm an agent member an owner named you for: it may then act within its access and yours'
					: verb === 'decline'
						? 'As its sponsor, decline an agent member an owner named you for: it is suspended and allowed nothing'
						: 'As its sponsor, withdraw an active agent member: it is suspended and allowed nothing until an owner names a sponsor again, who confirms',
			category: 'member',
			mutation: true,
			...(verb === 'confirm' ? {} : { destructive: true }),
			executionTime: 'fast',
			input: agentInput,
			jsonSchema: AGENT_JSON,
			async handler(input, context) {
				const before = await recordOf(input.agent);
				if (!before) {
					return verb === 'withdraw'
						? fail(
								'AGENT_MEMBER_NOT_FOUND',
								'No installed agent member has this id',
								'List them with agent-member-list; disconnect a connected agent of yours with account-agent-disconnect'
							)
						: notFound();
				}
				if (before.sponsor !== personOf(context)) {
					return fail(
						'AGENT_MEMBER_SPONSOR_ONLY',
						`Only the agent member's sponsor can ${verb} it`
					);
				}
				const from = verb === 'withdraw' ? 'active' : 'pending';
				if (before.status !== from) {
					return fail(
						from === 'active' ? 'AGENT_MEMBER_NOT_ACTIVE' : 'AGENT_MEMBER_NOT_PENDING',
						`This agent member is ${before.status}, not ${from}`
					);
				}
				const { suspended: _suspended, ...unchanged } = before;
				const next: AgentMemberV1 =
					verb === 'confirm'
						? { ...unchanged, status: 'active' }
						: {
								...unchanged,
								status: 'suspended',
								suspended: verb === 'decline' ? 'sponsor-declined' : 'sponsor-withdrew',
							};
				next.updatedAt = kit.callNow(context);
				next.updatedBy = personOf(context);
				await write(next);
				return kit.success(answer(next, context));
			},
		});

	const settleInput = z.strictObject({
		person: z.string().check(z.minLength(1), z.maxLength(256)),
		role: z.nullable(z.enum(['owner', 'admin', 'member'])),
		digest: z.nullable(z.string().check(z.maxLength(256))),
	});
	/**
	 * `membership-settle` (4.4): a sponsor's membership, read before `agent-member-add` and `-update`, journaled so a
	 * replay's sponsor check reads it from the journal. It never changes who the shell is for.
	 */
	const membershipSettle = kit.define<
		typeof settleInput,
		{ person: string; role: MemberRoleV1 | null }
	>({
		name: 'membership-settle',
		description: "The kernel's own: a sponsor's membership, read before an agent member's change",
		category: 'session',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				person: { type: 'string', minLength: 1, maxLength: 256 },
				role: { anyOf: [{ type: 'string', enum: ['owner', 'admin', 'member'] }, { type: 'null' }] },
				digest: { anyOf: [{ type: 'string', maxLength: 256 }, { type: 'null' }] },
			} as unknown as Record<string, JsonSchema>,
			required: ['person', 'role', 'digest'],
			additionalProperties: false,
		},
		async handler(input) {
			if (provider) {
				const members = new Map(scope.membership.members);
				if (input.role === null) members.delete(input.person);
				else members.set(input.person, input.role);
				scope.membership = { ...scope.membership, members };
				if (input.role === null) noteLeft(input.person);
			}
			return kit.success({ person: input.person, role: input.role });
		},
	});

	const agentSettleInput = z.strictObject({
		agents: z
			.array(
				z.strictObject({
					agent: id,
					suspended: z.enum(['sponsor-left', 'sponsor-declined', 'disconnected', 'owner']),
				})
			)
			.check(z.minLength(1), z.maxLength(1000)),
	});
	/** `agent-member-settle` (8.3): suspensions a membership read found, persisted so the record says why. */
	const agentSettle = defineWrite<typeof agentSettleInput, { suspended: string[] }>({
		name: 'agent-member-settle',
		description: "The kernel's own: agent members whose sponsor left, suspended",
		category: 'member',
		mutation: true,
		executionTime: 'instant',
		input: agentSettleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				agents: {
					type: 'array',
					minItems: 1,
					maxItems: 1000,
					items: {
						type: 'object',
						properties: {
							agent: ID_JSON,
							suspended: {
								type: 'string',
								enum: ['sponsor-left', 'sponsor-declined', 'disconnected', 'owner'],
							},
						},
						required: ['agent', 'suspended'],
						additionalProperties: false,
					},
				},
			},
			required: ['agents'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const suspended: string[] = [];
			for (const { agent, suspended: why } of input.agents) {
				const before = await recordOf(agent);
				if (!before || before.status === 'suspended') continue;
				// Who changed it stays as it was: the kernel's settle is no one's action (8.3).
				await write({
					...before,
					status: 'suspended',
					suspended: why,
					updatedAt: kit.callNow(context),
				});
				suspended.push(agent);
			}
			return kit.success({ suspended });
		},
	});

	return {
		cache,
		commands: [
			add,
			list,
			get,
			update,
			remove,
			answerAsSponsor('confirm'),
			answerAsSponsor('decline'),
			answerAsSponsor('withdraw'),
			membershipSettle,
			agentSettle,
		] as unknown as ZodCommandDefinition[],
		/** `member-list`'s agents (7.2): the same rows `agent-member-list` answers. */
		rowsFor,
		/** `agent-member-remove` of an id the kernel's table does not hold: a connected agent's, recorded (3.4, 9.2). */
		recordedCall: (name: string, input: unknown) =>
			name === 'agent-member-remove' &&
			typeof (input as { agent?: unknown } | null)?.agent === 'string' &&
			cache.get((input as { agent: string }).agent) === undefined,
		/**
		 * `member-remove`'s suspensions (7.2, 8.3): the agent members `person` sponsors, suspended by the
		 * `agent-member-settle` that follows the call.
		 */
		removed: (person: string): string[] => noteLeft(person),
		/** A settle found `person` no member (4.4): their agent members are suspended after it. */
		noteLeft,
		/** Phase 6's hosted lane: the server's removal hook suspends a sponsor's agent members, never this kernel. */
		holdSettles() {
			heldByServer = true;
		},
		/** Whether a suspension waits for {@link flush}. */
		pending: () => left.size > 0,
		flush,
		/**
		 * Before `agent-member-add` and `-update`, top-level from the scope middleware's `run` (4.4): the sponsor's
		 * membership read, journaled as `membership-settle`, and the suspensions it finds; the sponsor rule then reads it
		 * from the kernel's membership, in the original and the replay alike. A read or a settle that fails refuses the
		 * call `MEMBERSHIP_UNAVAILABLE` (fail closed).
		 */
		async prepare(
			name: string,
			input: unknown,
			call: CommandContext
		): Promise<CommandResult<never> | undefined> {
			if (!provider || deps.replaying()) return undefined;
			if (name !== 'agent-member-add' && name !== 'agent-member-update') return undefined;
			// The handler refuses anyone else OWNER_REQUIRED, with nothing read for them.
			if (!kit.isOwner(scope.membershipOf(call), personOf(call))) return undefined;
			// The server reads the whole roster for this call, by its person, and decides on it (9.5; phase 6's step 5).
			if (deps.gated) {
				try {
					rosters.set(call, membershipOf(await roster(call)));
				} catch {
					return kit.membershipUnavailable(name);
				}
				return undefined;
			}
			const asked = (input ?? {}) as {
				agent?: unknown;
				sponsor?: unknown;
				access?: unknown;
				undo?: unknown;
			};
			let sponsor = asked.sponsor;
			if (typeof asked.undo === 'string') {
				// An undo restores a kept record, its sponsor included (I3).
				sponsor = (
					await kept(asked.undo, typeof asked.agent === 'string' ? asked.agent : undefined, call)
				)?.sponsor;
			} else if (name === 'agent-member-update') {
				if (asked.sponsor === undefined && asked.access === undefined) return undefined;
				if (sponsor === undefined && typeof asked.agent === 'string')
					sponsor = (await recordOf(asked.agent))?.sponsor;
			}
			// Malformed, or no person's id: validation or the sponsor rule refuses it, with nothing read.
			if (typeof sponsor !== 'string' || sponsor.length === 0 || sponsor.length > 256)
				return undefined;
			if (sponsor.startsWith('agt_')) return undefined;
			let found: RosterPerson | undefined;
			try {
				found = (await roster(call)).get(sponsor);
			} catch {
				return kit.membershipUnavailable(name);
			}
			const settled = await deps.runBoot('membership-settle', {
				person: sponsor,
				role: found?.role ?? null,
				digest: found?.digest ?? null,
			});
			if (!settled.success) return kit.membershipUnavailable(name);
			await flush();
			return undefined;
		},
	};
}

export type AgentMembers = ReturnType<typeof createAgentMembers>;
