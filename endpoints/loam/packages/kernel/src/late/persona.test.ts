/**
 * Phase 3's step 5 units (phase 3 specification, 6; D89): the `persona-*` commands and their refusals, the
 * `persona` context field, `persona-set`'s density and theme, emphasis in the palette, a sign-in's landing and
 * project, what other members see, `AccessInputV2`'s keys and the scan. The sweep is `scope/persona-sweep.test.ts`.
 * E2's rows carry `P3-E2:`.
 */

import { readFileSync } from 'node:fs';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { AccessInputV2, MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../scope/fixtures.js';
import type { PersonaV1 } from '../scope/records.js';
import type { KernelEventV3, LoamKernelV3 } from '../types.js';
import { createPersona, DEFAULT_PERSONA, PERSONA_LIMIT } from './persona.js';
import { PERSONA_TABLE } from './tables.js';

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ACME: MembershipV1 = {
	mode: 'provider',
	members: new Map([
		[BEA, 'member'],
		[OLU, 'owner'],
	]),
	digest: 'd1',
};

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace(options);
	kernels.push(made.kernel);
	return made;
}

const signIn = (kernel: LoamKernelV3, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });

const REVIEWER = {
	title: 'Reviewer',
	presentation: { name: 'Bea R.', pronouns: 'she/her', avatar: 'system/folder' },
	defaults: { density: 'compact', theme: 'dark' },
	emphasis: { apps: ['tasks'], sections: ['projects'] },
};

async function create(kernel: LoamKernelV3, fields: object = REVIEWER): Promise<PersonaV1> {
	const made = await kernel.call<PersonaV1>('persona-create', fields);
	expect(made.success, JSON.stringify(made.error)).toBe(true);
	return made.data as PersonaV1;
}

const codeOf = (result: { error?: { code: string } }) => result.error?.code;

describe('P3-E2: the persona commands (6.3)', () => {
	it('P3-E2: lists default first, then a created persona, with which is active', async () => {
		const { kernel } = await workspace();
		await signIn(kernel, 'bea@example.com');
		const before = await kernel.call<{ personas: PersonaV1[]; active: string }>('persona-list');
		expect(before.data?.active).toBe(DEFAULT_PERSONA);
		expect(before.data?.personas.map((persona) => persona.id)).toEqual([DEFAULT_PERSONA]);
		const made = await create(kernel);
		expect(made.id).toMatch(/^per_[a-z0-9]{16}$/);
		expect(made).toMatchObject({ person: BEA, workspace: 'personal', title: 'Reviewer' });
		const after = await kernel.call<{ personas: PersonaV1[] }>('persona-list');
		expect(after.data?.personas.map((persona) => persona.id)).toEqual([DEFAULT_PERSONA, made.id]);
	});

	it('P3-E2: PERSONA_LIMIT at the ninth, with a suggestion', async () => {
		const { kernel } = await workspace();
		for (let at = 0; at < PERSONA_LIMIT; at++) await create(kernel, { title: `P${at}` });
		const ninth = await kernel.call('persona-create', { title: 'One more' });
		expect(codeOf(ninth)).toBe('PERSONA_LIMIT');
		expect(ninth.error?.suggestion).toMatch(/persona-remove/);
	});

	it.each([
		['an emphasized app that is not an instance', { title: 'x', emphasis: { apps: ['nowhere'] } }],
		['an avatar that is not an icon', { title: 'x', presentation: { avatar: 'not/an-icon' } }],
		[
			'a landing naming a section and an app',
			{ title: 'x', defaults: { landing: { section: 'projects', app: 'tasks' } } },
		],
		['a landing naming neither', { title: 'x', defaults: { landing: {} } }],
		['an app emphasized twice', { title: 'x', emphasis: { apps: ['tasks', 'tasks'] } }],
		['an id that is not a persona id', { title: 'x', id: 'prj_atlas' }],
	])('P3-E2: PERSONA_INVALID for %s', async (_case, input) => {
		const { kernel } = await workspace();
		const result = await kernel.call('persona-create', input);
		expect(codeOf(result)).toBe('PERSONA_INVALID');
		expect(result.error?.suggestion).toBeTruthy();
	});

	it('P3-E2: default is never changed or removed', async () => {
		const { kernel } = await workspace();
		expect(
			codeOf(await kernel.call('persona-update', { persona: DEFAULT_PERSONA, title: 'x' }))
		).toBe('PERSONA_INVALID');
		expect(codeOf(await kernel.call('persona-remove', { persona: DEFAULT_PERSONA }))).toBe(
			'PERSONA_INVALID'
		);
	});

	it("P3-E2: another person's persona answers as missing, to every command", async () => {
		const { kernel } = await workspace();
		await signIn(kernel, 'bea@example.com');
		const beas = await create(kernel);
		await signIn(kernel, 'olu@example.com');
		const listed = await kernel.call<{ personas: PersonaV1[] }>('persona-list');
		expect(listed.data?.personas.map((persona) => persona.id)).toEqual([DEFAULT_PERSONA]);
		for (const [name, input] of [
			['persona-set', { persona: beas.id }],
			['persona-update', { persona: beas.id, title: 'Mine now' }],
			['persona-remove', { persona: beas.id }],
		] as const) {
			const result = await kernel.call(name, input);
			expect(codeOf(result), name).toBe('PERSONA_NOT_FOUND');
			expect(result.error?.message).not.toContain('Reviewer');
		}
		// Unknown and another person's look the same.
		expect(await kernel.call('persona-set', { persona: 'per_0000000000000000' })).toMatchObject({
			error: { code: 'PERSONA_NOT_FOUND', message: 'You have no persona with this id' },
		});
		// Bea's record is unchanged, and is still hers.
		await signIn(kernel, 'bea@example.com');
		const still = await kernel.call<{ personas: PersonaV1[] }>('persona-list');
		expect(still.data?.personas[1]).toEqual(beas);
	});

	it("P3-E2: an agent lists its person's personas; every persona change is HUMAN_REQUIRED", async () => {
		const { kernel } = await workspace();
		await signIn(kernel, 'bea@example.com');
		const made = await create(kernel);
		const listed = await kernel.agent.call<{ personas: PersonaV1[] }>('persona-list');
		expect(listed.data?.personas.map((persona) => persona.id)).toEqual([DEFAULT_PERSONA, made.id]);
		for (const [name, input] of [
			['persona-create', { title: 'Agent made' }],
			['persona-update', { persona: made.id, title: 'x' }],
			['persona-remove', { persona: made.id }],
			['persona-set', { persona: made.id }],
		] as const) {
			expect(codeOf(await kernel.agent.call(name, input)), name).toBe('HUMAN_REQUIRED');
		}
	});

	it('P3-E2: persona-set applies density and theme through appearance-set, moves no scope or main, and its undo', async () => {
		const { kernel, scopes } = await workspace();
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('app-open', { instance: 'tasks' });
		const made = await create(kernel);
		const events: KernelEventV3[] = [];
		kernel.subscribe((event) => events.push(event));
		const set = await kernel.call<{ persona: string; previous: string }>('persona-set', {
			persona: made.id,
		});
		expect(set.data).toEqual({ persona: made.id, previous: DEFAULT_PERSONA });
		expect(set.undoCommand).toBe('persona-set');
		expect(set.undoArgs).toEqual({ persona: DEFAULT_PERSONA });
		expect((await kernel.call('appearance-get')).data).toMatchObject({
			density: 'compact',
			theme: 'dark',
		});
		const event = events.find((heard) => heard.command === 'persona-set');
		expect(event?.personaChanged).toBe(true);
		// A switch never moves the person (6.2).
		expect(event?.scopeChanged).toBeUndefined();
		expect(event?.mainChanged).toBeUndefined();
		expect((await kernel.call('scope-get')).data).toMatchObject({ scope: scopes.atlas });
		expect((await kernel.call<{ active: string }>('app-list')).data?.active).toBe('tasks');
		// Setting it again changes nothing that is announced.
		events.length = 0;
		await kernel.call('persona-set', { persona: made.id });
		expect(events[0]?.personaChanged).toBeUndefined();
	});

	it('P3-E2: persona-remove makes the active one default in the same call; its undo brings it back by id', async () => {
		const { kernel } = await workspace();
		const made = await create(kernel);
		await kernel.call('persona-set', { persona: made.id });
		const events: KernelEventV3[] = [];
		kernel.subscribe((event) => events.push(event));
		const removed = await kernel.call('persona-remove', { persona: made.id });
		expect(removed.data).toEqual({ removed: true });
		expect(events[0]?.personaChanged).toBe(true);
		expect((await kernel.call<{ active: string }>('persona-list')).data?.active).toBe(
			DEFAULT_PERSONA
		);
		expect(removed.undoCommand).toBe('persona-create');
		const back = await kernel.call<PersonaV1>('persona-create', removed.undoArgs);
		expect(back.data).toMatchObject({
			id: made.id,
			title: made.title,
			presentation: made.presentation,
			defaults: made.defaults,
			emphasis: made.emphasis,
		});
		// The same id twice is refused.
		expect(codeOf(await kernel.call('persona-create', removed.undoArgs))).toBe('PERSONA_INVALID');
	});

	it('P3-E2: persona-update replaces each field given, and its undo restores', async () => {
		const { kernel } = await workspace();
		const made = await create(kernel);
		const updated = await kernel.call<PersonaV1>('persona-update', {
			persona: made.id,
			title: 'Writer',
			emphasis: { apps: ['dual'] },
		});
		expect(updated.data).toMatchObject({
			title: 'Writer',
			emphasis: { apps: ['dual'] },
			presentation: made.presentation,
		});
		const undone = await kernel.call<PersonaV1>('persona-update', updated.undoArgs);
		expect(undone.data).toMatchObject({ title: 'Reviewer', emphasis: made.emphasis });
	});
});

describe('P3-E2: the persona context field (6.2)', () => {
	const personaOf = (entry: JournalEntry | undefined) =>
		(entry?.context as { persona?: string } | undefined)?.persona;

	it('P3-E2: journaled on each call while a persona is active, never under default', async () => {
		const { kernel, journal } = await workspace();
		const made = await create(kernel);
		await kernel.call('project-list');
		await kernel.call('persona-set', { persona: made.id });
		await kernel.call('project-list');
		await kernel.agent.call('project-list');
		await kernel.call('persona-set', { persona: DEFAULT_PERSONA });
		await kernel.call('project-list');
		const lists = (await journal.read()).filter((entry) => entry.command === 'project-list');
		expect(lists.map(personaOf)).toEqual([undefined, made.id, made.id, undefined]);
	});

	it("P3-E2: a local sign-out carries the signed-out person's persona, read then", async () => {
		const store = new MemoryAdapter();
		// The signed-out person's persona, set by an earlier page.
		const before = await workspace({ store });
		const mine = await create(before.kernel);
		await before.kernel.call('persona-set', { persona: mine.id });
		await before.kernel.flush();
		// This page starts signed in as Bea, so stage A reads hers, not the signed-out person's.
		const auth = new MockAuthAdapter();
		await auth.signIn({ email: 'bea@example.com', password: 'x' } as never);
		const journal = new MemoryJournalSink();
		const { kernel } = await workspace({ store, auth, journal });
		await kernel.call('auth-sign-out');
		await kernel.call('project-list');
		const entry = (await journal.read()).find((held) => held.command === 'project-list');
		expect(personaOf(entry)).toBe(mine.id);
	});

	it("P3-E2: stage A reads the person's active persona, so a reload's first call carries it", async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		const made = await create(first.kernel);
		await first.kernel.call('persona-set', { persona: made.id });
		await first.kernel.flush();
		const journal = new MemoryJournalSink();
		const second = await workspace({ store, journal });
		await second.kernel.call('project-list');
		const entry = (await journal.read()).find((held) => held.command === 'project-list');
		expect(personaOf(entry)).toBe(made.id);
	});

	it('P3-E2: never a key of the access decision', () => {
		// The decision's whole input: no persona, no active organization (6.2's type).
		expectTypeOf<keyof AccessInputV2>().toEqualTypeOf<
			'actor' | 'scope' | 'project' | 'membership' | 'agent'
		>();
	});

	it('P3-E2: no persona and no active organization in the decision, the gate, the port or the owner and human checks', () => {
		const read = (path: string) =>
			readFileSync(new URL(path, import.meta.url), 'utf8')
				// Comments say what is not an input; only code is scanned.
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
		const sources: Record<string, string> = {
			'scope/access.ts': read('../scope/access.ts'),
			'scope/middleware.ts': read('../scope/middleware.ts'),
			'late/port-callable.ts': read('./port-callable.ts'),
			'late/port-refusals.ts': read('./port-refusals.ts'),
			'late/owners.ts': read('./owners.ts'),
			'late/auth-gate.ts': read('./auth-gate.ts'),
		};
		// `late-identity`'s human check: `humanRequired` alone, not the list of names it checks.
		const identity = read('./identity-commands.ts');
		const human = identity.slice(identity.indexOf('humanRequired('));
		expect(human.length).toBeGreaterThan(0);
		sources['late/identity-commands.ts humanRequired'] = human;
		for (const [path, source] of Object.entries(sources)) {
			expect(source, path).not.toMatch(/persona/i);
			expect(source, path).not.toMatch(/activeOrganization/);
		}
	});
});

describe('P3-E2: emphasis in the palette (6.2)', () => {
	it("P3-E2: ranks the emphasized apps' commands and sections first, hiding none", async () => {
		const { kernel } = await workspace();
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('app-open', { instance: 'tasks' });
		const search = async () =>
			(
				await kernel.call<{ items: { name: string }[] }>('palette-search', {
					query: 'list',
					limit: 50,
				})
			).data?.items.map((item) => item.name) ?? [];
		const plain = await search();
		const made = await create(kernel, {
			title: 'Planner',
			emphasis: { apps: ['tasks'], sections: ['projects'] },
		});
		await kernel.call('persona-set', { persona: made.id });
		const emphasized = await search();
		expect([...emphasized].sort()).toEqual([...plain].sort());
		const first = emphasized.findIndex(
			(name) => !name.startsWith('tasks-') && !name.startsWith('project-')
		);
		expect(first).toBeGreaterThan(0);
		// Every emphasized command before every other.
		for (const name of emphasized.slice(first)) {
			expect(name.startsWith('tasks-') || name.startsWith('project-'), name).toBe(false);
		}
		expect(emphasized.slice(0, first).some((name) => name.startsWith('tasks-'))).toBe(true);
		expect(emphasized.slice(0, first).some((name) => name.startsWith('project-'))).toBe(true);
		expect(emphasized).not.toEqual(plain);
	});
});

describe('P3-E2: at sign-in, the persona lands the person (6.2)', () => {
	it("P3-E2: a sign-in enters the persona's project and section; one they may not enter is refused silently", async () => {
		const made = await workspace({ identity: PROVIDER, membership: ACME, empty: true });
		const { kernel } = made;
		await signIn(kernel, 'olu@example.com');
		expect(
			(
				await kernel.call('project-create', {
					name: 'Ledger',
					access: { mode: 'restricted', members: [OLU] },
				})
			).success
		).toBe(true);
		expect((await kernel.call('project-create', { name: 'Open' })).success).toBe(true);
		await signIn(kernel, 'bea@example.com');
		const into = await create(kernel, {
			title: 'Open first',
			defaults: { project: 'open', landing: { section: 'documents' } },
		});
		const barred = await create(kernel, {
			title: 'Ledger first',
			defaults: { project: 'ledger', landing: { section: 'documents' } },
		});
		await kernel.call('persona-set', { persona: into.id });
		// A switch never moves the person: the sign-in does.
		expect(
			(await kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
		).toBe(undefined);
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		const at = (
			await kernel.call<{ scope: { project?: string }; project?: { slug: string } }>('scope-get')
		).data;
		expect(at?.project?.slug).toBe('open');
		expect((await kernel.call<{ section: string | null }>('section-get')).data?.section).toBe(
			'documents'
		);
		// Ledger is Olu's alone: Bea's persona naming it lands her at the workspace, with nothing said.
		await kernel.call('persona-set', { persona: barred.id });
		await kernel.call('auth-sign-out');
		const back = await signIn(kernel, 'bea@example.com');
		expect(back.success).toBe(true);
		// Ledger is refused, so the scope she left stands: never Ledger, and nothing journaled says why.
		const there = (await kernel.call<{ project?: { slug: string } }>('scope-get')).data;
		expect(there?.project?.slug).toBe('open');
		expect(JSON.stringify(await made.journal.read())).not.toMatch(
			/PROJECT_NOT_FOUND|ledger.*refus/i
		);
	});
});

describe('P3-E2: what other members see (6.1)', () => {
	it("P3-E2: the active persona's presentation, and nothing else of it", async () => {
		const store = new MemoryAdapter();
		const persona = createPersona({
			store,
			scope: {
				workspace: { id: 'personal', name: 'Personal' },
				note() {},
				project: () => undefined,
			} as never,
			apps: () => ({ summaries: () => [{ instance: 'tasks' }] }) as never,
			personas: new Map(),
			icons: ['system/folder'],
			themes: ['system', 'dark'],
			densities: ['comfortable', 'compact'],
			canOpen: () => undefined,
			setMain() {},
			appearance: async () => ({ success: true }),
			kit: (await import('./document-kit.js')).DOCUMENT_KIT,
		});
		expect(await persona.presentationOf(BEA)).toEqual({});
		const row: PersonaV1 = {
			id: 'per_aaaaaaaaaaaaaaaa',
			workspace: 'personal',
			person: BEA,
			title: 'Secret title',
			presentation: { name: 'Bea R.', pronouns: 'she/her' },
			defaults: { project: 'vault' },
			emphasis: { apps: ['tasks'] },
			createdAt: 1,
			updatedAt: 1,
			updatedBy: BEA,
		};
		await store.create(PERSONA_TABLE, row);
		await store.create(PERSONA_TABLE, { ...row, id: 'per_bbbbbbbbbbbbbbbb', title: 'Other' });
		// Not active: default's empty presentation.
		expect(await persona.presentationOf(BEA)).toEqual({});
		await store.create('settings', {
			id: `loam.persona~${BEA}`,
			category: 'view-state',
			value: { active: row.id },
		});
		persona.reload();
		const seen = await persona.presentationOf(BEA);
		expect(seen).toEqual({ name: 'Bea R.', pronouns: 'she/her' });
		expect(JSON.stringify(seen)).not.toMatch(/Secret|Other|vault|tasks|per_/);
		// Another person's record naming Bea's persona is not theirs: default.
		await store.create('settings', {
			id: `loam.persona~${OLU}`,
			category: 'view-state',
			value: { active: row.id },
		});
		expect(await persona.presentationOf(OLU)).toEqual({});
	});

	it("P3-E2: no command reads or writes a person's active persona record but persona-*", async () => {
		const { kernel } = await workspace();
		const made = await create(kernel);
		await kernel.call('persona-set', { persona: made.id });
		const id = 'loam.persona~local';
		expect(codeOf(await kernel.call('view-state-get', { id }))).toBe('VIEW_STATE_NOT_FOUND');
		expect(codeOf(await kernel.call('view-state-set', { id, state: { active: 'default' } }))).toBe(
			'VIEW_STATE_NOT_FOUND'
		);
		const listed = await kernel.call<{ id: string }[]>('view-state-list');
		expect(JSON.stringify(listed.data)).not.toContain('loam.persona');
		expect((await kernel.call<{ active: string }>('persona-list')).data?.active).toBe(made.id);
	});
});
