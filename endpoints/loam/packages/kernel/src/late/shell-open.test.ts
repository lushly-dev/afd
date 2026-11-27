/**
 * P5-B3 (phase 5 specification, 9.3 and 18): `shell-open` and `canOpenInboxTarget`. It opens a document (its anchor
 * kept), an app, a project, a section and a confirmation within what the caller may enter; refuses a URL, a project the
 * caller cannot enter, a workspace-only app's project target, a background app, a nested handler and an embed; one
 * refusal for an inbox row the caller may not see, by either way in; a mounted view only by the deployer's opt-in; and
 * a tainted copilot's open of a view outside its sources, or of a route into an `http` app, asks.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT } from '../../scenarios/mailfix-mount.js';
import {
	P4_PROJECTS,
	P4_SEED,
	P5_CALLER,
	p5Base,
	type SeededKernel,
} from '../../scenarios/seeds.js';
import type { AppsRuntime } from '../apps-runtime.js';
import { createCopilotParts } from '../copilot/commands.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { replayKernel } from '../testing.js';
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
		} finally {
			await replayed.kernel?.dispose();
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
