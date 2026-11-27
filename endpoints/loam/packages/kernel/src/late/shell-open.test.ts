/**
 * P5-B3 (phase 5 specification, 9.3 and 18): `shell-open` and `canOpenInboxTarget`. It opens a document (its anchor
 * kept), an app, a project, a section and a confirmation within what the caller may enter; refuses a URL, a project the
 * caller cannot enter, a workspace-only app's project target, a background app, a nested handler and an embed; one
 * refusal for an inbox row the caller may not see, by either way in; a mounted view only by the deployer's opt-in; and
 * a tainted copilot's open of a view outside its sources, or of a route into an `http` app, asks.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT } from '../../scenarios/mailfix-mount.js';
import {
	P4_PERSON,
	P4_PROJECTS,
	P4_SEED,
	P5_CALLER,
	p5Base,
	type SeededKernel,
} from '../../scenarios/seeds.js';
import type { AppsRuntime } from '../apps-runtime.js';
import { createCopilotParts } from '../copilot/commands.js';
import type { MembershipV1 } from '../scope/access.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { replayKernel } from '../testing.js';
import type { KernelEvent } from '../types.js';
import { APP_CALLABLE_SHELL_COMMANDS_V3 } from '../types.js';
import { canOpenInboxTarget } from './shell-open.js';

let seeded: SeededKernel | undefined;
afterEach(async () => {
	KEPT.client = undefined;
	await seeded?.dispose();
	seeded = undefined;
});

const WS = { workspace: 'personal' };
const ATLAS = { workspace: 'personal', project: 'prj_atlas' };
const base = async () => {
	seeded = await p5Base({ provider: false });
	return seeded;
};
const open = (made: SeededKernel, target: unknown) =>
	made.kernel.call<{ opened: unknown; changed: boolean }>('shell-open', { target });

describe('P5-B3: shell-open in the kernel', () => {
	it('P5-B3: is a journaled mutation every app may reach, hidden from palette-search', async () => {
		const made = await base();
		expect(APP_CALLABLE_SHELL_COMMANDS_V3).toContain('shell-open');
		const before = (await made.journal.read()).length;
		const opened = await open(made, { kind: 'section', section: 'inbox', scope: WS });
		expect(opened.data).toMatchObject({
			opened: { kind: 'section', section: 'inbox' },
			changed: true,
		});
		const entries = (await made.journal.read()).slice(before);
		expect(entries.map((entry) => entry.command)).toContain('shell-open');
		// Already open there: nothing changed.
		expect((await open(made, { kind: 'section', section: 'inbox', scope: WS })).data?.changed).toBe(
			false
		);
		const found = await made.kernel.call<{ items: Array<{ name: string }> }>('palette-search', {
			query: 'open',
		});
		expect(found.data?.items.map((item) => item.name)).not.toContain('shell-open');
	});

	it('P5-B3: opens a project and a document in it, keeping the document link’s anchor, and refuses one it cannot enter', async () => {
		const made = await base();
		const project = await open(made, { kind: 'project', project: 'prj_atlas', scope: WS });
		expect(project.success, JSON.stringify(project.error)).toBe(true);
		expect((await made.kernel.call<{ scope: unknown }>('scope-get')).data?.scope).toMatchObject(
			ATLAS
		);
		const anchor = { block: 'b1' };
		const document = await open(made, {
			kind: 'document',
			document: P4_SEED.documents[0]?.id as string,
			scope: ATLAS,
			anchor,
		});
		expect(document.success, JSON.stringify(document.error)).toBe(true);
		expect(document.data?.opened).toMatchObject({ anchor });
		for (const target of [
			{ kind: 'project', project: 'prj_missing', scope: WS },
			{ kind: 'app', instance: 'hello', scope: { workspace: 'personal', project: 'prj_missing' } },
		])
			expect((await open(made, target)).error?.code).toBe('PROJECT_NOT_FOUND');
		expect(
			(
				await open(made, {
					kind: 'project',
					project: 'prj_atlas',
					scope: { ...WS, project: 'prj_beacon' },
				})
			).error?.code
		).toBe('SCOPE_MISMATCH');
	});

	it('P5-B3: refuses a URL of any scheme, and any key a link does not have', async () => {
		const made = await base();
		for (const target of [
			{ kind: 'mounted-ui', instance: 'mailfix', uri: 'https://example.com/x', scope: WS },
			{ kind: 'mounted-ui', instance: 'mailfix', uri: 'javascript:alert(1)', scope: WS },
			{ kind: 'app', instance: 'hello', url: 'https://example.com', scope: WS },
			{ kind: 'url', url: 'https://example.com', scope: WS },
		])
			expect((await open(made, target)).error?.code, JSON.stringify(target)).toBe(
				'VALIDATION_ERROR'
			);
	});

	it('P5-B3: refuses a mounted view its deployer did not opt into (D169)', async () => {
		const made = await base();
		const refused = await open(made, {
			kind: 'mounted-ui',
			instance: 'mailfix',
			uri: 'ui://mailfix/thread',
			scope: WS,
		});
		expect(refused.error?.code).toBe('MOUNT_VIEWS_DISABLED');
		expect(refused.error?.suggestion).toContain('views = true');
	});

	it('P5-B3: lets only the active app move main, and refuses a nested handler and an embed', async () => {
		const made = await base();
		const port = made.kernel.appPort('mailfixapp');
		expect(
			(await port.call('shell-open', { target: { kind: 'section', section: 'inbox', scope: WS } }))
				.error?.code
		).toBe('SHELL_OPEN_NOT_ACTIVE');
		await made.kernel.call('app-open', { instance: 'mailfixapp' });
		expect(
			(await port.call('shell-open', { target: { kind: 'section', section: 'inbox', scope: WS } }))
				.success
		).toBe(true);
		await made.kernel.call('app-open', { instance: 'mailfixapp' });
		expect((await port.call('mailfixapp-client-keep', {})).success).toBe(true);
		const nested = (await KEPT.client?.call('shell-open', {
			target: { kind: 'section', section: 'inbox', scope: WS },
		})) as CommandResult;
		expect(nested.error?.code).toBe('NESTED_MUTATION_REFUSED');
		const embed = port.surface({ scope: WS, readOnly: true });
		expect(
			(await embed.call('shell-open', { target: { kind: 'section', section: 'inbox', scope: WS } }))
				.error?.code
		).toBe('EMBED_READ_ONLY');
	});

	it('P5-B3: answers an inbox row the caller may not see alike by confirmation and by inbox path', async () => {
		const made = await base();
		// The overlay's callee raises a confirmation of its own, which the person sees and an agent that did not raise it
		// does not. The shell's sources name no app, so it is named from the overlay (`p5-base.overlay.json`).
		const asked = await made.kernel.appPort(P5_CALLER.app).call(`${P5_CALLER.app}-reset`, {});
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification as string;
		expect(notification).toMatch(/^ntf_/);
		const agent = (target: unknown) => made.kernel.agent.call('shell-open', { target });
		const byConfirmation = await agent({ kind: 'confirmation', notification, scope: WS });
		const byPath = await agent({
			kind: 'section',
			section: 'inbox',
			path: notification,
			scope: WS,
		});
		const missing = await agent({
			kind: 'confirmation',
			notification: 'ntf_0000000000000000',
			scope: WS,
		});
		expect([byConfirmation.error, byPath.error]).toEqual([missing.error, missing.error]);
		expect(missing.error?.code).toBe('NOTIFICATION_NOT_FOUND');
		// The agent's own `section-open` by path, the same rule.
		expect(
			(await made.kernel.agent.call('section-open', { section: 'inbox', path: notification })).error
		).toEqual(missing.error);
		// The person sees it, and opening it acts on nothing.
		const opened = await open(made, { kind: 'confirmation', notification, scope: WS });
		expect(opened.success, JSON.stringify(opened.error)).toBe(true);
		const row = await made.store?.get<{ confirmation: { state: string } }>(
			'notification',
			notification
		);
		expect(row?.confirmation.state).toBe('pending');
	});
});

describe('P5-B3: canOpenInboxTarget, by concrete instance', () => {
	it('P5-B3: refuses an app a project row by its own levels and enablement there, though shell-open asks it no such row', async () => {
		const store = new MemoryAdapter();
		await store.create('notification', {
			id: 'ntf_own',
			workspace: 'personal',
			person: 'local',
			kind: 'notice',
			source: 'reader',
			scope: ATLAS,
		} as never);
		const held = { levels: ['workspace', 'project'], enabled: true };
		const apps = {
			owners: new Map(),
			summaries: () => [{ instance: 'reader', state: 'ready', scopeLevels: held.levels }],
			detail: () => ({ success: true, data: { grants: [] } }),
		} as unknown as AppsRuntime;
		const scope = {
			workspace: { id: 'personal' },
			allows: () => true,
			get workspaceApps() {
				return new Map(held.enabled ? [] : [['reader', { overrides: { enabled: false } }]]);
			},
			// As the runtime's: a project's listing decides, not the levels (none is listed here).
			opensIn: (_instance: string, levels: readonly string[], project?: string) =>
				project === undefined ? levels.includes('workspace') : true,
		} as unknown as ScopeRuntime;
		const deps = { store, scope, apps: () => apps };
		const ask = () =>
			canOpenInboxTarget(deps, 'ntf_own', { caller: 'reader' } as never, {
				requireConfirmation: false,
			});
		// Its own notice, in a project it opens in: allowed.
		expect(await ask()).toBe(undefined);
		// Workspace-only, or disabled in the workspace: the same refusal as a row that is not there.
		const missing = await canOpenInboxTarget(deps, 'ntf_none', { caller: 'reader' } as never, {
			requireConfirmation: false,
		});
		held.levels = ['workspace'];
		expect((await ask())?.error).toEqual(missing?.error);
		held.levels = ['workspace', 'project'];
		held.enabled = false;
		expect((await ask())?.error).toEqual(missing?.error);
	});

	it('P5-B3: lets an app open a confirmation for its granted mount, never for a sibling mount of that plugin', async () => {
		const store = new MemoryAdapter();
		const row = (id: string, command: string) => ({
			id,
			workspace: 'personal',
			person: 'local',
			kind: 'confirmation',
			scope: WS,
			cbucket: 'person',
			confirmation: { command },
		});
		await store.create('notification', row('ntf_mail', 'mail-draft-send') as never);
		await store.create('notification', row('ntf_work', 'mailwork-draft-send') as never);
		const apps = {
			owners: new Map([
				['mail-draft-send', { app: 'mail', instance: 'mail', apps: true }],
				['mailwork-draft-send', { app: 'mail', instance: 'mailwork', apps: true }],
			]),
			detail: () => ({ success: true, data: { grants: [{ name: 'calls', served: true }] } }),
			port: () => ({ manifest: { calls: [{ app: 'mail', commands: ['mail-draft-send'] }] } }),
		} as unknown as AppsRuntime;
		const scope = { workspace: { id: 'personal' }, allows: () => true } as unknown as ScopeRuntime;
		const context = { caller: 'reader' } as never;
		const deps = { store, scope, apps: () => apps };
		expect(await canOpenInboxTarget(deps, 'ntf_mail', context, { requireConfirmation: true })).toBe(
			undefined
		);
		expect(
			(await canOpenInboxTarget(deps, 'ntf_work', context, { requireConfirmation: true }))?.error
				?.code
		).toBe('NOTIFICATION_NOT_FOUND');
	});
});

describe('P5-B3: shell-open under autonomy and taint (enforce.ts)', () => {
	it('P5-B3: acts by default, and asks under taint only for a view outside the sources or a route into an http app', async () => {
		const store = new MemoryAdapter();
		await store.create('copilot-session', {
			id: 'cps_0000000000000003',
			person: 'local',
			taint: [{ source: 'mail', at: 1 }],
		} as never);
		const parts = createCopilotParts({
			store,
			workspace: 'personal',
			kit: (await import('./command-kit.js')).DOCUMENT_KIT,
			isMutation: (name) => name === 'shell-open',
			isMounted: () => false,
			instanceOf: () => undefined,
			holdsHttp: () => false,
			instanceHoldsHttp: (instance) => instance === 'web',
			agentCommands: () => [],
			callAsCopilot: async () => ({ success: true }),
			runBoot: async () => ({ success: true }),
			humanOnly: () => false,
			internal: () => false,
			digest: async () => 'sha256:0',
			now: () => 0,
			person: () => 'local',
		});
		const next = async () => ({ success: true }) as CommandResult;
		const asks = async (target: unknown, session = 'cps_0000000000000003') => {
			const call: Record<string | symbol, unknown> = {
				interface: 'agent',
				trace: { session, turn: 1, call: 'cpc_0001' },
			};
			await parts.gate('shell-open', { target }, call as never, next);
			return (call[Symbol.for('dev.loam/enforced')] as { ask?: boolean } | undefined)?.ask === true;
		};
		expect(
			await asks({ kind: 'mounted-ui', instance: 'other', uri: 'ui://other/x', scope: WS })
		).toBe(true);
		expect(
			await asks({ kind: 'mounted-ui', instance: 'mail', uri: 'ui://mail/x', scope: WS })
		).toBe(false);
		expect(await asks({ kind: 'app', instance: 'web', route: 'q/secret', scope: WS })).toBe(true);
		expect(await asks({ kind: 'app', instance: 'web', scope: WS })).toBe(false);
		expect(await asks({ kind: 'app', instance: 'plain', route: 'x', scope: WS })).toBe(false);
		// Untainted, a mutation's default would ask; `shell-open`'s is `act`.
		expect(
			await asks(
				{ kind: 'mounted-ui', instance: 'other', uri: 'ui://other/x', scope: WS },
				'cps_0000000000000009'
			)
		).toBe(false);
	});
});

describe('P5-B3: shell-open’s callers, inbox rows and settings targets', () => {
	it('P5-B3: refuses a workspace-only app’s project target SCOPE_NOT_GRANTED, before access is asked', async () => {
		const made = await base();
		// The overlay's callee is a workspace-only native app; active, it may move main.
		await made.kernel.call('app-open', { instance: P5_CALLER.app });
		const port = made.kernel.appPort(P5_CALLER.app);
		for (const target of [
			{ kind: 'project', project: 'prj_atlas', scope: WS },
			{ kind: 'project', project: 'prj_missing', scope: WS },
			{ kind: 'section', section: 'inbox', scope: ATLAS },
		])
			expect((await port.call('shell-open', { target })).error?.code, JSON.stringify(target)).toBe(
				'SCOPE_NOT_GRANTED'
			);
		expect(
			(await port.call('shell-open', { target: { kind: 'section', section: 'inbox', scope: WS } }))
				.success
		).toBe(true);
	});

	it('P5-B3: lets the active document’s editor move main, though its app is not the active one', async () => {
		const made = await base();
		const [document] = P4_SEED.documents;
		await made.kernel.call('scope-set', { project: 'prj_atlas' });
		const opened = await made.kernel.call('document-open', { document: document?.id });
		expect(opened.success, JSON.stringify(opened.error)).toBe(true);
		const editor = made.kernel.appPort(P5_CALLER.instance).surface({ scope: ATLAS });
		const moved = await editor.call('shell-open', {
			target: { kind: 'section', section: 'inbox', scope: ATLAS },
		});
		expect(moved.success, JSON.stringify(moved.error)).toBe(true);
		// Another app, neither active nor the editor's: refused.
		const other = await made.kernel
			.appPort('hello')
			.call('shell-open', { target: { kind: 'section', section: 'inbox', scope: ATLAS } });
		expect(other.error?.code).toBe('SHELL_OPEN_NOT_ACTIVE');
	});

	it('P5-B3: answers an inbox row named in another scope than its own as a missing one', async () => {
		const made = await base();
		const asked = await made.kernel.appPort(P5_CALLER.app).call(`${P5_CALLER.app}-reset`, {});
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification as string;
		const missing = await open(made, {
			kind: 'confirmation',
			notification: 'ntf_0000000000000000',
			scope: WS,
		});
		for (const target of [
			{ kind: 'confirmation', notification, scope: ATLAS },
			{ kind: 'section', section: 'inbox', path: notification, scope: ATLAS },
		])
			expect((await open(made, target)).error, JSON.stringify(target)).toEqual(missing.error);
		expect((await open(made, { kind: 'confirmation', notification, scope: WS })).success).toBe(
			true
		);
	});

	it('P5-B3: lets an app open only its own settings and the shell’s, every other target refused as an unknown one', async () => {
		const made = await base();
		// Opening a section closes the active app, so the caller is made active again before each.
		const target = async (instance: string, key: string) => {
			await made.kernel.call('app-open', { instance });
			return made.kernel.appPort(instance).call('shell-open', {
				target: { kind: 'section', section: 'settings', target: key, scope: WS },
			});
		};
		expect((await target('hello', 'loam.appearance')).success).toBe(true);
		expect((await target('hello', 'hello.general')).success).toBe(true);
		const unknown = await target('hello', 'nowhere.at-all');
		expect(unknown.error?.code).toBe('SETTING_NOT_FOUND');
		// A key of its own that does not exist: the same bytes.
		expect((await target('hello', 'hello.no-such')).error).toEqual(unknown.error);
		// Another app's section, which exists, and a key of it: the same bytes as one that does not, from that app.
		const other = P5_CALLER.app;
		expect((await target(other, 'loam.appearance')).success).toBe(true);
		for (const key of ['hello.general', 'hello.general.greeting'])
			expect((await target(other, key)).error, key).toEqual(unknown.error);
	});
});

describe('P5-B3: shell-open’s mounted views, after the deployer’s opt-in', () => {
	const PAGE = '<!doctype html><p>A thread</p>';
	const lane = () => {
		let reading: { abort: (reason: unknown) => void } | undefined;
		return {
			list: [
				{ uri: 'ui://mailfix/thread', mimeType: 'text/html' },
				{ uri: 'ui://mailfix/plain', mimeType: 'text/plain' },
				{ uri: 'ui://mailfix/large', mimeType: 'text/html;profile=mcp-app' },
				{ uri: 'ui://mailfix/slow', mimeType: 'text/html' },
			],
			async read(uri: string, signal?: AbortSignal) {
				if (uri === 'ui://mailfix/slow')
					return new Promise<never>((_resolve, reject) => {
						reading = { abort: reject };
						signal?.addEventListener('abort', () => reject(signal.reason));
					});
				const mimeType = uri.endsWith('plain') ? 'text/plain' : 'text/html';
				const text = uri.endsWith('large') ? 'x'.repeat(2 * 1024 * 1024 + 1) : PAGE;
				return { contents: [{ uri, mimeType, text }] };
			},
			get reading() {
				return reading;
			},
		};
	};
	const viewOf = (
		uri: string,
		scope: object = { workspace: 'personal', project: 'prj_beacon' }
	) => ({
		kind: 'mounted-ui',
		instance: 'mailfix',
		uri,
		scope,
	});

	it('P5-B3: opens a listed HTML view within its bounds, once, and every other failure alike', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			// The deployer's opt-in, and the instance serves Beacon alone.
			mailfixEntry: { views: true, projects: ['beacon'] },
		});
		const made = seeded;
		await made.kernel.call('scope-set', { project: null });
		const first = await open(made, viewOf('ui://mailfix/thread'));
		expect(first.success, JSON.stringify(first.error)).toBe(true);
		expect(first.data?.changed).toBe(true);
		// Main moved into the target's scope, as for every other kind.
		expect(
			(await made.kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
		).toBe('prj_beacon');
		// Already open there: nothing changed.
		expect((await open(made, viewOf('ui://mailfix/thread'))).data?.changed).toBe(false);
		// Main moved by another call, even back to where it was: the view was replaced, so opening it again changes main.
		await made.kernel.call('section-open', { section: 'inbox' });
		expect((await open(made, viewOf('ui://mailfix/thread'))).data?.changed).toBe(true);
		await made.kernel.call('scope-set', { project: null });
		await made.kernel.call('scope-set', { project: 'beacon' });
		expect((await open(made, viewOf('ui://mailfix/thread'))).data?.changed).toBe(true);
		expect((await open(made, viewOf('ui://mailfix/thread'))).data?.changed).toBe(false);
		// From the workspace, no refused open moves main, whichever project it names.
		await made.kernel.call('scope-set', { project: null });
		const stays = async () =>
			expect(
				(await made.kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
			).toBeUndefined();
		// Not enabled where the target is: Atlas is not one of its projects.
		const elsewhere = await open(made, viewOf('ui://mailfix/thread', ATLAS));
		expect(elsewhere.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		await stays();
		// Unlisted, not HTML, over 2 MiB, and not read within 10 s: one refusal, so none tells a server's resources apart.
		const unlisted = await open(made, viewOf('ui://mailfix/none'));
		expect(unlisted.error?.code).toBe('VIEW_RESOURCE_UNAVAILABLE');
		await stays();
		expect((await open(made, viewOf('ui://mailfix/plain'))).error).toEqual(unlisted.error);
		await stays();
		expect((await open(made, viewOf('ui://mailfix/large'))).error).toEqual(unlisted.error);
		await stays();
		const clock = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clock.signal);
		try {
			const slow = open(made, viewOf('ui://mailfix/slow'));
			await vi.waitFor(() => expect(timeout).toHaveBeenCalledWith(10_000));
			clock.abort(new DOMException('timed out', 'TimeoutError'));
			expect((await slow).error).toEqual(unlisted.error);
		} finally {
			timeout.mockRestore();
		}
		await stays();
	});

	it('P5-B3: opens the same view in another project as another open', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		expect((await open(seeded, viewOf('ui://mailfix/thread'))).data?.changed).toBe(true);
		expect((await open(seeded, viewOf('ui://mailfix/thread', ATLAS))).data?.changed).toBe(true);
		expect((await open(seeded, viewOf('ui://mailfix/thread', ATLAS))).data?.changed).toBe(false);
	});

	it('P5-B3: replays an open into its scope, the view answered from its record', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		await seeded.kernel.call('scope-set', { project: null });
		expect((await open(seeded, viewOf('ui://mailfix/thread'))).success).toBe(true);
		const scopeOf = async (kernel: SeededKernel['kernel']) =>
			(await kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project;
		expect(await scopeOf(seeded.kernel)).toBe('prj_beacon');
		// The replay's store holds the seed's projects, which its journal does not create.
		const store = new MemoryAdapter();
		await store.batch(
			P4_PROJECTS.map((record) => ({
				method: 'PUT' as const,
				path: `/project/${record.id}`,
				body: record,
			}))
		);
		const replayed = await replayKernel(await seeded.journal.read(), {
			...(seeded.deployment ? { deployment: seeded.deployment } : {}),
			...(seeded.ports ? { ports: seeded.ports } : {}),
			store,
			keep: true,
		});
		try {
			// The guard: the replay's open answered as the live one did, its view from the record (a replay kernel never
			// connects a mounted instance, so it could not fetch one), and main where the live open left it.
			expect(replayed.report.diverged).toBe(false);
			expect(await scopeOf(replayed.kernel as SeededKernel['kernel'])).toBe('prj_beacon');
			// A live open of the same view in the kept kernel is no "same view": the replay made no slot, so this one does.
			const kept = replayed.kernel as SeededKernel['kernel'];
			await kept.startInstances();
			const events: KernelEvent[] = [];
			kept.subscribe((event) => events.push(event));
			const live = await kept.call<{ changed: boolean }>('shell-open', {
				target: viewOf('ui://mailfix/thread'),
			});
			expect(live.success, JSON.stringify(live.error)).toBe(true);
			expect(live.data?.changed).toBe(true);
			expect(events.findLast((event) => event.command === 'shell-open')?.mountedUi).toMatchObject({
				uri: 'ui://mailfix/thread',
			});
		} finally {
			await replayed.kernel?.dispose();
		}
	});

	it('P5-B3: hands the opened view to the page alone, transiently, with a broker that calls no tool (T32)', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		const resources = lane();
		const read = vi.spyOn(resources, 'read');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources }),
			mailfixEntry: { views: true },
		});
		const events: KernelEvent[] = [];
		seeded.kernel.subscribe((event) => events.push(event));
		const opened = await open(seeded, viewOf('ui://mailfix/thread'));
		expect(opened.success, JSON.stringify(opened.error)).toBe(true);
		// The HTML reaches the slot alone: never the answer, nor the journal.
		expect(JSON.stringify(opened)).not.toContain('A thread');
		expect(JSON.stringify(await seeded.journal.read())).not.toContain('A thread');
		const slot = events.findLast((event) => event.command === 'shell-open')?.mountedUi;
		if (!slot) throw new Error('The open named no slot');
		expect(slot).toMatchObject({ instance: 'mailfix', uri: 'ui://mailfix/thread' });
		expect(await slot.source.read(slot.uri)).toEqual({ html: PAGE });
		expect(slot.view.sandboxOrigin).toBe(seeded.deployment?.sandbox_origin);
		// Zero tools: none of its own instance, none of another, and no bound command.
		for (const name of ['mailfix-thread-list', 'mailfix-draft-send', 'app-list', 'shell-open']) {
			await expect(slot.view.toolsCall({ name, arguments: {} })).rejects.toMatchObject({
				code: 'VIEW_CALL_REFUSED',
			});
		}
		await expect(
			slot.view.runBound('mailfix-thread-list', new AbortController().signal)
		).rejects.toMatchObject({ code: 'VIEW_CALL_REFUSED' });
		expect(slot.view.overlayResult).toBeUndefined();
		// Reads: a listed ui:// HTML view alone, through the open's own checks and bounds.
		expect(await slot.view.resourcesRead({ uri: 'ui://mailfix/thread' })).toEqual({
			contents: [{ uri: 'ui://mailfix/thread', mimeType: 'text/html;profile=mcp-app', text: PAGE }],
		});
		for (const uri of [
			'ui://mailfix/none',
			'ui://mailfix/plain',
			'ui://mailfix/large',
			'https://example.com/x',
			'file:///etc/passwd',
			undefined,
		]) {
			await expect(slot.view.resourcesRead({ uri })).rejects.toMatchObject({
				code: 'VIEW_CALL_REFUSED',
			});
		}
		// At most four reads in flight: a fifth is refused at once, and a slot is free again once they end.
		const clock = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clock.signal);
		try {
			const slow = Array.from({ length: 4 }, () =>
				slot.view.resourcesRead({ uri: 'ui://mailfix/slow' }).catch((cause) => cause)
			);
			await expect(slot.view.resourcesRead({ uri: 'ui://mailfix/thread' })).rejects.toMatchObject({
				code: 'VIEW_CALL_REFUSED',
			});
			clock.abort(new DOMException('timed out', 'TimeoutError'));
			for (const ended of await Promise.all(slow))
				expect(ended).toMatchObject({ code: 'VIEW_CALL_REFUSED' });
		} finally {
			timeout.mockRestore();
		}
		expect((await slot.view.resourcesRead({ uri: 'ui://mailfix/thread' })).contents).toHaveLength(
			1
		);
		const reads = read.mock.calls.length;
		// The same view again changes nothing, and names no new slot.
		events.length = 0;
		await open(seeded, viewOf('ui://mailfix/thread'));
		expect(events.find((event) => event.command === 'shell-open')?.mountedUi).toBeUndefined();
		// Another call that moves main replaces it: the page is told to drop it, once.
		events.length = 0;
		await seeded.kernel.call('section-open', { section: 'inbox' });
		expect(events.findLast((event) => event.command === 'section-open')?.mountedUi).toBeNull();
		events.length = 0;
		await seeded.kernel.call('section-open', { section: 'projects' });
		expect(events.some((event) => 'mountedUi' in event)).toBe(false);
		// Another kind's open replaces it too.
		await open(seeded, viewOf('ui://mailfix/thread'));
		events.length = 0;
		await open(seeded, { kind: 'section', section: 'inbox', scope: WS });
		expect(events.findLast((event) => event.command === 'shell-open')?.mountedUi).toBeNull();
		// Each fetch was a command's: the two opens since, and nothing else.
		expect(read.mock.calls.length).toBe(reads + 2);
	});

	it('P5-B3: drops the slot at a change of person, with no app open, both ways (T32)', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		const made = seeded;
		await made.kernel.call('app-close');
		const events: KernelEvent[] = [];
		made.kernel.subscribe((event) => events.push(event));
		const slotOf = async (call: () => Promise<unknown>, command: string) => {
			events.length = 0;
			await call();
			return events.filter((event) => event.command === command && 'mountedUi' in event);
		};
		for (const [command, input] of [
			['auth-sign-in', { method: 'credentials', email: 'person@example.com', password: 'x' }],
			['auth-sign-out', {}],
		] as const) {
			const opened = await slotOf(
				() => open(made, viewOf('ui://mailfix/thread', WS)),
				'shell-open'
			);
			expect(opened[0]?.mountedUi, command).toMatchObject({ uri: 'ui://mailfix/thread' });
			expect(
				(await made.kernel.call<{ active: string | null }>('app-list')).data?.active
			).toBeNull();
			const changed = await slotOf(() => made.kernel.call(command, input), command);
			expect(
				changed.map((event) => event.mountedUi),
				command
			).toEqual([null]);
			// The next open of it is a new one, with a new slot.
			expect((await open(made, viewOf('ui://mailfix/thread', WS))).data?.changed, command).toBe(
				true
			);
			await made.kernel.call('section-open', { section: 'projects' });
		}
	});

	it('P5-B3: drops the slot at a change of person no command makes, in provider mode (T32)', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		const OLU = 'mock-user-olu@example.com';
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
			identity: {
				identity: {
					mode: 'provider',
					organization: 'acme',
					path: 'api/auth',
					methods: ['passkey', 'password'],
				} as IdentityV1,
				membership: {
					mode: 'provider',
					members: new Map([
						[P4_PERSON, 'owner'],
						[OLU, 'owner'],
					]),
					digest: 'd1',
				} as MembershipV1,
			},
		});
		const made = seeded;
		await made.kernel.call('app-close');
		expect((await made.kernel.call<{ active: string | null }>('app-list')).data?.active).toBeNull();
		const events: KernelEvent[] = [];
		made.kernel.subscribe((event) => events.push(event));
		await open(made, viewOf('ui://mailfix/thread', WS));
		expect(events.findLast((event) => event.command === 'shell-open')?.mountedUi).toMatchObject({
			uri: 'ui://mailfix/thread',
		});
		events.length = 0;
		// Another tab signs Olu in: `session-settle` notes `actorChanged`, and no `auth-*` call runs here.
		made.auth?._setUser({ id: OLU, email: 'olu@example.com', name: 'olu' });
		await vi.waitFor(() =>
			expect(events.find((event) => event.command === 'session-settle')).toBeDefined()
		);
		const settled = events.find((event) => event.command === 'session-settle');
		expect(settled).toMatchObject({ actorChanged: true });
		expect(settled?.mainChanged).toBeUndefined();
		expect(settled?.scopeChanged).toBeUndefined();
		expect(settled?.mountedUi).toBeNull();
		expect(events.some((event) => event.command.startsWith('auth-'))).toBe(false);
	});

	it('P5-B3: drops the slot when an open moves the scope and then fails', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		const made = seeded;
		await made.kernel.call('scope-set', { project: null });
		await made.kernel.call('workspace-app-set', { instance: 'hello', enabled: false });
		expect((await open(made, viewOf('ui://mailfix/thread', WS))).success).toBe(true);
		const events: KernelEvent[] = [];
		made.kernel.subscribe((event) => events.push(event));
		const failed = await open(made, { kind: 'app', instance: 'hello', scope: ATLAS });
		expect(failed.success).toBe(false);
		expect(
			(await made.kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
		).toBe('prj_atlas');
		expect(events.find((event) => event.command === 'shell-open')?.mountedUi).toBeNull();
	});

	it('P5-B3: the slot reads no URI its instance does not list, gates each message and bounds its reads', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		const events: KernelEvent[] = [];
		seeded.kernel.subscribe((event) => events.push(event));
		await open(seeded, viewOf('ui://mailfix/thread'));
		const slot = events.findLast((event) => event.command === 'shell-open')?.mountedUi;
		if (!slot) throw new Error('The open named no slot');
		// Variants of a listed URI, and another instance's, are not it.
		for (const uri of [
			'UI://mailfix/thread',
			'ui://mailfix/thread?x',
			'ui://mailfix/thread#frag',
			'ui://mailfix/./thread',
			'ui://mailfix/thread/',
			'ui://other/thread',
			' ui://mailfix/thread',
		]) {
			await expect(slot.view.resourcesRead({ uri }), uri).rejects.toMatchObject({
				code: 'VIEW_CALL_REFUSED',
			});
		}
		// Every message the frame sends is gated by size first.
		expect(slot.view.admit?.({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBeUndefined();
		expect(
			slot.view.admit?.({ jsonrpc: '2.0', id: 1, method: 'ping', params: 'x'.repeat(1_048_577) })
		).toMatchObject({ code: 'INPUT_TOO_LARGE', rpcCode: -32602 });
		// Ten reads in ten seconds, then none until the window passes.
		// A fresh window, past the one the reads above opened.
		const start = Date.now() + 60_000;
		const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
		try {
			const { SLOT_READS } = await import('./shell-open.js');
			for (let index = 0; index < SLOT_READS; index++)
				await slot.view.resourcesRead({ uri: 'ui://mailfix/thread' });
			await expect(slot.view.resourcesRead({ uri: 'ui://mailfix/thread' })).rejects.toMatchObject({
				code: 'RATE_LIMITED',
				details: { limit: SLOT_READS },
			});
			clock.mockReturnValue(start + 10_000);
			expect((await slot.view.resourcesRead({ uri: 'ui://mailfix/thread' })).contents).toHaveLength(
				1
			);
		} finally {
			clock.mockRestore();
		}
	});

	it('P5-B3: refuses a view with no sandbox origin to render it in', async () => {
		const { mountedMailfix } = await import('../../scenarios/mailfix-mount.js');
		seeded = await p5Base({
			provider: false,
			sandbox: false,
			mailfix: mountedMailfix({ resources: lane() }),
			mailfixEntry: { views: true },
		});
		const refused = await open(seeded, viewOf('ui://mailfix/thread', WS));
		expect(refused.error?.code).toBe('VIEW_SANDBOX_ORIGIN_INVALID');
	});
});
