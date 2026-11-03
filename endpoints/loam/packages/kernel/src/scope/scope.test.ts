/**
 * Scope in the context, the journal and replay (phase 2 specification, 3.2, 3.4 and 10; E4's units),
 * and `decideAccess` (3.4).
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createScopedWorkspace,
	createSteppingClock,
	diffJournals,
	replayKernel,
	type ScopedWorkspace,
	scopedDeployment,
	scopedPorts,
} from '../testing.js';
import type { KernelEventV2, LoamKernelV2, ProjectV1, ScopeV1 } from '../types.js';
import { decideAccess, LOCAL_ACTOR } from './access.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const WORKSPACE: ScopeV1 = { workspace: 'personal' };
/** Atlas's scope, set by the test's workspace: its id comes off the journal's tape. */
let ATLAS: ScopeV1;
const PERSON = 'mock-user-person@example.com';

async function scoped(options: Parameters<typeof createScopedWorkspace>[0] = {}) {
	const workspace = await createScopedWorkspace(options);
	kernels.push(workspace.kernel);
	if (!options.empty) ATLAS = workspace.scopes.atlas;
	return workspace;
}

const entries = (workspace: ScopedWorkspace) => workspace.journal.read();
const lastEntry = async (workspace: ScopedWorkspace) =>
	(await entries(workspace)).at(-1) as JournalEntry;
const replayOf = (journal: readonly JournalEntry[]) =>
	replayKernel(journal, { deployment: scopedDeployment(), ports: scopedPorts() });

async function signIn(workspace: ScopedWorkspace) {
	return workspace.kernel.call('auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});
}

/** A project restricted to the person, created while they are signed in, and entered. */
async function enterRestricted(workspace: ScopedWorkspace): Promise<ProjectV1> {
	await signIn(workspace);
	const created = await workspace.kernel.call<ProjectV1>('project-create', {
		name: 'Vault',
		access: { mode: 'restricted', members: [PERSON] },
	});
	expect(created.success).toBe(true);
	expect((await workspace.kernel.call('scope-set', { project: 'vault' })).success).toBe(true);
	return created.data as ProjectV1;
}

describe('decideAccess', () => {
	const project = (access: ProjectV1['access']): ProjectV1 =>
		({ id: 'prj_a', access }) as ProjectV1;

	it('allows the workspace with no project, and a workspace-access project to anyone', () => {
		expect(decideAccess({ actor: LOCAL_ACTOR, scope: WORKSPACE, project: undefined })).toEqual({
			allowed: true,
		});
		expect(
			decideAccess({
				actor: 'anyone',
				scope: { workspace: 'w', project: 'prj_a' },
				project: project({ mode: 'workspace' }),
			}).allowed
		).toBe(true);
	});

	it('refuses a missing project, a mismatched record, and a restricted one without the actor', () => {
		const scope = { workspace: 'w', project: 'prj_a' };
		const restricted = project({ mode: 'restricted', members: ['someone'] });
		expect(decideAccess({ actor: 'someone', scope, project: undefined }).allowed).toBe(false);
		expect(
			decideAccess({ actor: 'someone', scope: { ...scope, project: 'prj_b' }, project: restricted })
				.allowed
		).toBe(false);
		expect(decideAccess({ actor: LOCAL_ACTOR, scope, project: restricted }).allowed).toBe(false);
		expect(decideAccess({ actor: 'someone', scope, project: restricted }).allowed).toBe(true);
	});
});

describe('P2-E4: each path of 3.2 reaches `context.scope`', () => {
	it('defaults to the active scope, on both interfaces, and takes an explicit one', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		expect((await kernel.call<{ scope: ScopeV1 }>('dual-where')).data?.scope).toEqual(WORKSPACE);
		await kernel.call('scope-set', { project: 'atlas' });
		expect((await kernel.call<{ scope: ScopeV1 }>('dual-where')).data?.scope).toEqual(ATLAS);
		expect((await kernel.agent.call<{ scope: ScopeV1 }>('dual-where')).data?.scope).toEqual(ATLAS);
		const wide = await kernel.call<{ scope: ScopeV1 }>('dual-where', {}, { scope: 'workspace' });
		expect(wide.data?.scope).toEqual(WORKSPACE);
		const beacon = workspace.scopes.beacon;
		const named = await kernel.agent.call<{ scope: ScopeV1 }>('dual-where', {}, { scope: beacon });
		expect(named.data?.scope).toEqual(beacon);
		expect((await lastEntry(workspace)).context?.scope).toEqual(beacon);
	});

	it('gives a nested call the outer effective scope, and a port the active scope', async () => {
		const workspace = await scoped();
		await workspace.kernel.call('scope-set', { project: 'atlas' });
		const nested = await workspace.kernel.call<{ here: ScopeV1; wide: ScopeV1 }>('dual-nested');
		expect(nested.data).toEqual({ here: ATLAS, wide: WORKSPACE });
		// `projects.active()` makes a nested `project-get` of its own in Atlas.
		const parented = (await entries(workspace)).filter(
			(entry) => entry.context?.parent && entry.command === 'dual-where'
		);
		expect(parented.map((entry) => entry.context?.scope)).toEqual([ATLAS, WORKSPACE]);
		const port = await workspace.kernel.appPort('dual').call<{ scope: ScopeV1 }>('dual-where');
		expect(port.data?.scope).toEqual(ATLAS);
	});

	it('refuses a malformed scope as VALIDATION_ERROR, before the journal', async () => {
		const workspace = await scoped();
		const before = (await entries(workspace)).length;
		const result = await workspace.kernel.call(
			'dual-where',
			{},
			{
				scope: { workspace: '' } as ScopeV1,
			}
		);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.details).toMatchObject({ field: 'scope', meta: 'dev.loam/scope' });
		expect((await entries(workspace)).length).toBe(before);
	});

	it("puts the call's effective scope and the change on the event", async () => {
		const workspace = await scoped();
		const events: KernelEventV2[] = [];
		workspace.kernel.subscribe((event) => events.push(event));
		await workspace.kernel.call('app-open', { instance: 'solo' });
		await workspace.kernel.call('scope-set', { project: 'atlas' });
		await workspace.kernel.call('solo-where');
		expect(events[0]).toMatchObject({ command: 'app-open', mainChanged: 'push', scope: WORKSPACE });
		expect(events[1]).toMatchObject({
			command: 'scope-set',
			mainChanged: 'push',
			scopeChanged: { from: WORKSPACE, to: ATLAS, left: 'solo', reason: 'scope-set' },
		});
		// A workspace-only app's call, narrowed.
		expect(events[2]).toMatchObject({ command: 'solo-where', scope: WORKSPACE });
		expect(events[2]?.scopeChanged).toBeUndefined();
	});
});

describe("P2-E4: 4.3's switch rules, in applyScopeChange", () => {
	it('keeps a dual-scope app, and leaves a project-only one for the projects section', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('app-open', { instance: 'dual' });
		const kept = await kernel.call('scope-set', { project: 'atlas' });
		expect(kept.data).toMatchObject({ active: 'dual', app: 'kept', previous: null });
		await kernel.call('app-open', { instance: 'tasks' });
		const left = await kernel.call('scope-set', { project: null });
		expect(left.data).toMatchObject({ active: null, app: 'left', previous: ATLAS.project });
		expect((await kernel.call('section-get')).data).toEqual({ section: 'projects', path: '' });
		// Its undo goes back, and opens the app it left.
		expect(left.undoCommand).toBe('scope-set');
		expect(left.undoArgs).toEqual({ project: ATLAS.project, app: 'tasks' });
		await kernel.call('scope-set', left.undoArgs);
		expect((await kernel.call<{ active: string }>('app-list')).data?.active).toBe('tasks');
	});

	it('clears every selection on a change of scope, and refuses under a shell modal', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('app-open', { instance: 'dual' });
		await kernel.call('app-selection-set', { instance: 'dual', id: 'a' });
		await kernel.call('scope-set', { project: 'atlas' });
		expect((await kernel.call('app-selection-get', { instance: 'dual' })).data).toEqual({
			id: null,
		});
		await kernel.call('modal-open', { title: 'Sure?', body: 'Say so.' });
		const refused = await kernel.call('scope-set', { project: 'beacon' });
		expect(refused.error?.code).toBe('OVERLAY_MODAL_BUSY');
		expect((await kernel.call<{ scope: ScopeV1 }>('scope-get')).data?.scope).toEqual(ATLAS);
	});

	it('writes `loam.scope`, which view-state-set may not', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		expect((await kernel.call('view-state-get', { id: 'loam.scope' })).data).toEqual({
			id: 'loam.scope',
			state: { project: ATLAS.project },
		});
		const refused = await kernel.call('view-state-set', {
			id: 'loam.scope',
			state: { project: workspace.scopes.beacon.project },
		});
		expect(refused.error?.code).toBe('VIEW_STATE_READ_ONLY');
		expect(refused.error?.suggestion).toContain('scope-set');
	});
});

describe('P2-E4: a person is never locked out of the shell', () => {
	it('lands at workspace level on signing out inside a restricted project, with the shell working throughout', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await enterRestricted(workspace);
		await kernel.call('app-open', { instance: 'dual' });
		await kernel.call('dual-put', { key: 'k', value: 'vault' });
		const events: KernelEventV2[] = [];
		kernel.subscribe((event) => events.push(event));
		const out = await kernel.call('auth-sign-out');
		expect(out.success).toBe(true);
		expect(events.at(-1)?.scopeChanged).toMatchObject({ to: WORKSPACE, reason: 'actor' });
		expect((await kernel.call<{ scope: ScopeV1 }>('scope-get')).data?.scope).toEqual(WORKSPACE);
		expect((await kernel.call('layout-get')).success).toBe(true);
		expect(
			(await kernel.call<{ value: unknown }>('dual-get', { key: 'k' })).data?.value
		).toBeNull();
		expect((await signIn(workspace)).success).toBe(true);
		expect((await kernel.call('scope-set', { project: null })).success).toBe(true);
		const { report } = await replayOf(await entries(workspace));
		expect(report.diverged).toBe(false);
	});

	it('takes an expired session into account at the next call, with no auth command', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.UTC(2026, 10, 3));
		const workspace = await scoped();
		await enterRestricted(workspace);
		vi.setSystemTime(Date.UTC(2026, 10, 3, 2));
		const where = await workspace.kernel.call<{ scope: ScopeV1 }>('dual-where');
		expect((await lastEntry(workspace)).context?.scope).toEqual(WORKSPACE);
		expect(where.data?.scope).toEqual(WORKSPACE);
		vi.useRealTimers();
		const { report } = await replayOf(await entries(workspace));
		expect(report.diverged).toBe(false);
	});

	it('moves the active scope to the workspace when the active project is archived, and restores it', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		const archived = await kernel.call<{ project: ProjectV1; scope: ScopeV1 }>('project-archive', {
			project: 'atlas',
		});
		expect(archived.data?.scope).toEqual(WORKSPACE);
		expect(archived.data?.project.status).toBe('archived');
		expect((await kernel.call('project-list')).data).toMatchObject({ total: 1 });
		expect((await kernel.call('project-get', { project: 'atlas' })).success).toBe(true);
		const restored = await kernel.call<{ project: ProjectV1 }>('project-restore', {
			project: 'atlas',
		});
		expect(restored.data?.project.status).toBe('active');
		expect((await replayOf(await entries(workspace))).report.diverged).toBe(false);
	});

	it("answers a restricted project's `@` records as never registered, signed out", async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		const vault = await enterRestricted(workspace);
		await kernel.call('app-open', { instance: 'dual' });
		await kernel.call('layout-set', { sidebar: { width: 300 } });
		const id = `loam.layout.dual@${vault.id}`;
		expect((await kernel.call('view-state-get', { id })).success).toBe(true);
		await kernel.call('auth-sign-out');
		const refused = await kernel.call('view-state-get', { id });
		const never = await kernel.call('view-state-get', { id: 'loam.layout.dual@prj_none' });
		expect(refused.error?.code).toBe('VIEW_STATE_NOT_FOUND');
		expect(refused.error?.message.replace(vault.id, 'x')).toBe(
			never.error?.message.replace('prj_none', 'x')
		);
		const listed = await kernel.call<{ states: Array<{ id: string }> }>('view-state-list');
		expect(listed.data?.states.map((state) => state.id)).not.toContain(id);
		expect(
			(await kernel.call('view-state-set', { id, state: { sidebar: { width: 280 } } })).error?.code
		).toBe('VIEW_STATE_NOT_FOUND');
	});

	it('refuses, in each named-project command, a project the actor may not enter, as a missing one', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		const calls: Array<[string, Record<string, unknown>]> = [
			['scope-set', { project: 'citadel' }],
			['project-get', { project: 'citadel' }],
			['project-update', { project: 'citadel', name: 'Mine' }],
			['project-archive', { project: 'citadel' }],
			['project-restore', { project: 'citadel' }],
		];
		for (const [name, input] of calls) {
			const refused = await kernel.call(name, input);
			const missing = await kernel.call(name, { ...input, project: 'nowhere' });
			expect(refused.error?.code, name).toBe('PROJECT_NOT_FOUND');
			expect(JSON.stringify(refused.error), name).toBe(JSON.stringify(missing.error));
		}
		const list = await kernel.call<{ projects: ProjectV1[] }>('project-list', { status: 'all' });
		expect(list.data?.projects.map((project) => project.slug)).toEqual(['atlas', 'beacon']);
		// A `layout-*` call in a project it may not enter is refused the same way.
		const layout = await kernel.call(
			'layout-get',
			{},
			{
				scope: workspace.scopes.citadel,
			}
		);
		expect(layout.error?.code).toBe('PROJECT_NOT_FOUND');
	});
});

describe('P2-E4: the project commands', () => {
	it('creates a project with a slug from its name, an id off the tape, and the workspace row', async () => {
		const workspace = await scoped({ empty: true });
		const { kernel } = workspace;
		const created = await kernel.call<ProjectV1>('project-create', { name: '  Big Plans! ' });
		expect(created.data).toMatchObject({
			slug: 'big-plans',
			name: '  Big Plans! ',
			icon: 'system/folder',
			status: 'active',
			access: { mode: 'workspace' },
			createdBy: LOCAL_ACTOR,
			workspace: 'personal',
		});
		expect(created.data?.id).toMatch(/^prj_[0-9a-z]{10}$/);
		expect(created.undoCommand).toBe('project-archive');
		expect(await workspace.store.get('workspace', 'personal')).toMatchObject({ id: 'personal' });
		const refusals: Array<[Record<string, unknown>, string]> = [
			[{ name: 'Again', slug: 'big-plans' }, 'PROJECT_SLUG_TAKEN'],
			[{ name: 'All', slug: 'all' }, 'PROJECT_SLUG_INVALID'],
			[{ name: 'x', slug: 'Bad_Slug' }, 'PROJECT_SLUG_INVALID'],
			[{ name: '' }, 'PROJECT_NAME_INVALID'],
			[{ name: 'x'.repeat(81) }, 'PROJECT_NAME_INVALID'],
			[
				{ name: 'Mine', access: { mode: 'restricted', members: ['someone'] } },
				'PROJECT_MEMBER_SELF_REQUIRED',
			],
			[{ name: 'Iconic', icon: 'nope/none' }, 'VALIDATION_ERROR'],
		];
		for (const [input, code] of refusals) {
			expect((await kernel.call('project-create', input)).error?.code, code).toBe(code);
		}
		expect((await replayOf(await entries(workspace))).report.diverged).toBe(false);
	});

	it('updates name and access with an undo, keeping the slug and raising the epoch', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		const updated = await kernel.call<ProjectV1>('project-update', {
			project: 'atlas',
			name: 'Atlas Two',
			access: { mode: 'restricted', members: [LOCAL_ACTOR] },
		});
		expect(updated.data).toMatchObject({ slug: 'atlas', name: 'Atlas Two', memberEpoch: 1 });
		expect(updated.undoArgs).toEqual({
			project: ATLAS.project,
			name: 'Atlas',
			access: { mode: 'workspace' },
		});
		await kernel.call('project-update', updated.undoArgs);
		expect((await kernel.call<ProjectV1>('project-get', { project: 'atlas' })).data?.name).toBe(
			'Atlas'
		);
	});
});

describe('P2-E4: replay with scope', () => {
	it('replays a scoped session with zero differences, and diffJournals compares context', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('tasks-add', { task: 't-1', title: 'One' });
		await kernel.call('scope-set', { project: 'beacon' });
		await kernel.call('tasks-complete', { task: 't-1' });
		await kernel.call('dual-put', { key: 'k', value: 'v' }, { scope: 'workspace' });
		const recorded = await entries(workspace);
		expect((await replayOf(recorded)).report.diverged).toBe(false);
		// The same calls in another project differ only in `context`.
		const moved = recorded.map((entry) =>
			entry.command === 'tasks-add'
				? {
						...entry,
						context: { ...entry.context, scope: { workspace: 'personal', project: 'x' } },
					}
				: entry
		);
		const diff = diffJournals(recorded, moved);
		expect(diff.equal).toBe(false);
		expect(diff.firstDifference).toMatchObject({ field: 'context', path: 'scope.project' });
	});

	it('applies the deployment once, never again in a replay, and replays an entry with no scope at the workspace', async () => {
		const workspace = await scoped({ empty: true });
		const recorded = await entries(workspace);
		expect(recorded.map((entry) => entry.command)).toEqual(['workspace-deployment-apply']);
		await workspace.kernel.call('solo-put', { key: 'k', value: 'v' });
		const journal = await entries(workspace);
		// As a journal written before phase 2 has it: no `scope`.
		const old = journal.map((entry) => {
			const { scope: _scope, ...context } = entry.context ?? {};
			return { ...entry, context };
		});
		const { report } = await replayOf(old);
		expect(report.diverged).toBe(false);
		expect(
			report.entries.filter((entry) => entry.command === 'workspace-deployment-apply')
		).toHaveLength(1);
	});

	it('gives a replay the journal’s actor, whatever its one Mock holds', async () => {
		const workspace = await scoped();
		await enterRestricted(workspace);
		await workspace.kernel.call('dual-put', { key: 'k', value: 'v' });
		const recorded = await entries(workspace);
		const signIn = recorded.findIndex((entry) => entry.command === 'auth-sign-in');
		// Drop the sign-in: the replay's Mock stays signed out, and the recorded actor still enters.
		const { report } = await replayOf(
			recorded
				.filter((_entry, index) => index !== signIn)
				.map((entry, index) => ({ ...entry, seq: index + 1 }))
		);
		expect(report.entries.find((entry) => entry.command === 'dual-put')?.status).toBe('same');
	});

	it("forgets the session at a reload, as the Mock's page does, and keeps the persisted scope", async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const first = await scoped({ store, journal });
		await first.kernel.call('scope-set', { project: 'atlas' });
		await enterRestricted(first);
		await first.kernel.dispose();
		// The reload: the Mock is signed out, so stage A refuses the persisted project.
		const second = await scoped({
			store,
			journal,
			auth: new MockAuthAdapter(),
			clock: createSteppingClock(Date.UTC(2026, 0, 2)),
		});
		expect((await second.kernel.call<{ scope: ScopeV1 }>('scope-get')).data?.scope).toEqual(
			WORKSPACE
		);
		expect((await second.kernel.call('scope-set', { project: null })).data).toMatchObject({
			previous: expect.stringMatching(/^prj_/),
		});
		const { report } = await replayOf(await journal.read());
		expect(report.diverged).toBe(false);
	});
});
