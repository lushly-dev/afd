/**
 * The Chromium parts of E4, E7 and E10 (phase 2 specification, 15; step 7), now that the rail and the
 * projects section are there: the scripted session replayed with zero differences, a sign-out inside a
 * restricted project leaving nothing of it on the page, a cross-project mutation refused after the access
 * decision through both interfaces, a view's store bound to its scope, and the store's rows as IndexedDB
 * holds them, each record's scope among them.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	createFixedEnvironment,
	createFixturePorts,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from '../bundle';
import {
	APPS,
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';
import { PERSON, runScopeSession, scopedCall } from './session-scope';

let browser: Browser;
let site: DeploymentSite;
let viewSite: DeploymentSite;
/** A test-only view whose handlers say what scope each call ran in, and make a nested query (E7). */
let scopedSite: DeploymentSite;
let scratch: string;

const VIEW_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Scoped</title></head>
<body><main><h1>Scoped</h1></main><script>
addEventListener('message', (event) => {
	if (event.source === parent && !event.data.method && event.data.id === 1) {
		parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
	}
});
parent.postMessage({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {
	protocolVersion: '2026-01-26', appInfo: { name: 'scoped', version: '0.1.0' }, appCapabilities: {},
} }, '*');
</script></body></html>`;

async function scopedViewPackage(): Promise<string> {
	const directory = join(scratch, 'scoped');
	await mkdir(directory, { recursive: true });
	const command = (name: string) => ({
		name,
		title: name,
		description: `The scope ${name} ran in.`,
		effects: ['inspect'],
		input_schema: { type: 'object', properties: {}, additionalProperties: false },
	});
	await writeFile(
		join(directory, 'app-manifest.json'),
		JSON.stringify({
			manifest_version: 2,
			protocol: 1,
			afd_contract: '1.0',
			plugin: {
				id: 'scoped',
				title: 'Scoped',
				version: '0.1.0',
				description: 'A view that says what scope its calls ran in.',
				kind: 'view',
				domains: ['scoped'],
				license: 'MIT',
			},
			app: { scope_levels: ['workspace', 'project'] },
			view: { handlers: 'handlers.html' },
			grants: [{ name: 'store', reason: 'Tries a key that names another scope.' }],
			commands: [
				command('scoped-where'),
				command('scoped-nested'),
				{ ...command('scoped-store'), effects: ['store-write'] },
			],
			ui: {
				resources: [{ uri: 'ui://scoped/main', path: 'main.html' }],
				surfaces: { main: { resource: 'ui://scoped/main' } },
			},
		})
	);
	const script = (await bundlePage('scope-handlers')).replaceAll('</script', '<\\/script');
	await writeFile(
		join(directory, 'handlers.html'),
		`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Handlers</title></head><body><script>${script}</script></body></html>`
	);
	await writeFile(join(directory, 'main.html'), VIEW_PAGE);
	return directory;
}

/** The view's own frame, inside the proxy's in main. */
async function viewFrame(page: Page): Promise<Frame> {
	const element = await page.locator('loam-view-frame iframe').elementHandle();
	const outer = await element?.contentFrame();
	if (!outer) throw new Error('No outer frame');
	await expect.poll(() => outer.childFrames().length).toBe(1);
	return outer.childFrames()[0] as Frame;
}

/** A `tools/call` as code in the view sends it, by hand, with whatever `_meta` it likes. */
function viewCall(frame: Frame, params: unknown) {
	return frame.evaluate(
		(params) =>
			new Promise<{ result?: { structuredContent?: { data?: unknown } } }>((resolve) => {
				const id = `e7-${Math.random()}`;
				const listen = (event: MessageEvent) => {
					if (event.data?.id !== id) return;
					removeEventListener('message', listen);
					resolve(event.data);
				};
				addEventListener('message', listen);
				parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call', params }, '*');
			}),
		params
	);
}

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally')),
			deploymentEntry('tasks', await packApp('tasks'))
		),
	});
	viewSite = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello', 'view'))),
		sandbox: true,
	});
	scratch = await mkdtemp(join(tmpdir(), 'loam-e7-'));
	scopedSite = await serveDeployment({
		config: deploymentFile(deploymentEntry('scoped', await scopedViewPackage())),
		sandbox: true,
	});
}, 120_000);
afterAll(async () => {
	await site?.close();
	await viewSite?.close();
	await scopedSite?.close();
	await browser?.close();
	if (scratch) await rm(scratch, { recursive: true, force: true });
});

const entriesOf = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<unknown[]> };
		};
		return shell.journal.read();
	}) as Promise<JournalEntry[]>;

/** Every text of the page, through every open shadow root. */
const deepText = (page: Page) =>
	page.evaluate(() => {
		const walk = (root: ParentNode): string =>
			[...root.querySelectorAll('*')]
				.map((element) => (element.shadowRoot ? walk(element.shadowRoot) : ''))
				.join(' ') +
			(root instanceof Element || root instanceof ShadowRoot ? root.textContent : '');
		return walk(document.documentElement);
	});

/** The deployment's packages in process, so a replay runs their handlers with no page. */
async function replayPorts() {
	const packages: Record<string, { manifest: unknown; definition: unknown }> = {};
	for (const app of ['hello', 'tally', 'tasks'] as const) {
		packages[`apps/${app}/`] = {
			manifest: JSON.parse(await readFile(join(await packApp(app), 'app-manifest.json'), 'utf8')),
			definition: (await import(/* @vite-ignore */ join(APPS, app, 'dist/native.js'))).default,
		};
	}
	return createFixturePorts(packages as never);
}

const signIn = (page: Page) =>
	kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});

describe('P2-E4: scope in the context, the journal and replay, in Chromium', () => {
	it('P2-E4: the scripted session, signed in, with a reload in the middle and a sign-in after it, replays with zero differences', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const { refused } = await runScopeSession(page, async () => {
			// The view-state writes are debounced, and a reload does not wait for `pagehide`'s flush: one made
			// at once would boot from the state before them, which the journal does not hold (a follow-up).
			await page.evaluate(() =>
				(
					document.querySelector('loam-shell') as unknown as { kernel: { flush(): Promise<void> } }
				).kernel.flush()
			);
			await page.reload();
			await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
			await page.evaluate(async () => {
				const shell = document.querySelector('loam-shell') as unknown as {
					ready: Promise<void>;
					kernel: { appsReady: Promise<void> };
				};
				await shell.ready;
				await shell.kernel.appsReady;
			});
			await settle(page);
		});
		expect(refused.crossProject).toMatchObject({
			success: false,
			error: { code: 'SCOPE_MISMATCH' },
		});
		expect(refused.afterReload).toMatchObject({
			success: false,
			error: { code: 'PROJECT_NOT_FOUND' },
		});
		const entries = await entriesOf(page);
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();

		// The IndexedDB journal holds each call's effective scope, by id.
		const atlas = entries.find(
			(entry) =>
				entry.command === 'project-create' && (entry.input as { name: string }).name === 'Atlas'
		);
		const atlasId = (atlas?.result.data as { id: string } | undefined)?.id;
		const added = entries.find((entry) => entry.command === 'tasks-add');
		expect(added?.context?.scope).toEqual({ workspace: 'personal', project: atlasId });
		// The workspace-only app's call, made in Atlas, journaled at the workspace.
		expect(entries.find((entry) => entry.command === 'tally-add')?.context?.scope).toEqual({
			workspace: 'personal',
		});
		// The reload left the restricted project, journaled as stage B's own scope-set.
		const reloaded = entries.findIndex(
			(entry, index) =>
				index > 0 &&
				entry.command === 'scope-set' &&
				(entry.input as { project: unknown }).project === null
		);
		expect(reloaded).toBeGreaterThan(0);
		// A project created by that person, and summaries answered from their records.
		expect(entries.filter((entry) => entry.command === 'project-create')).toHaveLength(3);
		const summaries = entries.filter((entry) => entry.command === 'project-summary-get');
		expect(summaries.length).toBeGreaterThanOrEqual(2);

		const { report } = await replayKernel(entries, {
			environment: createFixedEnvironment(),
			deployment: site.projection,
			ports: await replayPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.entries.length).toBe(entries.length);
		for (const entry of summaries) expect(report.recorded).toContain(entry.seq);
	}, 90_000);

	it('P2-E4: signing out inside a restricted project leaves nothing of it on the page, moves the URL and re-reads the rail; a later scope-set replays the same', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await signIn(page);
		await kernelCall(page, 'project-create', { name: 'Beacon' });
		await kernelCall(page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [PERSON] },
		});
		await kernelCall(page, 'scope-set', { project: 'vault' });
		await kernelCall(page, 'app-open', { instance: 'tasks' });
		await surfacesIdle(page);
		await kernelCall(page, 'tasks-add', { title: 'Secret plan' });
		await surfacesIdle(page);
		await expect.poll(() => deepText(page)).toContain('Secret plan');
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/p/vault/tasks');
		// Through the title bar, as a person signs out.
		await page
			.locator('loam-titlebar violet-button, loam-titlebar button', { hasText: 'Sign out' })
			.first()
			.click();
		await surfacesIdle(page);
		// `scope-get`, `layout-get` and `auth-sign-in` work throughout, at the workspace.
		const scope = (await kernelCall(page, 'scope-get')) as {
			data: { scope: { project?: string } };
		};
		expect(scope.data.scope.project).toBeUndefined();
		expect(((await kernelCall(page, 'layout-get')) as { success: boolean }).success).toBe(true);
		// Tasks left, for the projects section's list; the rail read again, tasks dimmed with no project.
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/~/projects');
		await expect
			.poll(() => page.locator('loam-projects-section tbody a').allTextContents())
			.toEqual(['Beacon']);
		await expect
			.poll(() =>
				page
					.locator('loam-rail loam-app-entry[instance="tasks"] button')
					.getAttribute('aria-disabled')
			)
			.toBe('true');
		const text = await deepText(page);
		expect(text).not.toContain('Secret plan');
		expect(text).not.toContain('Vault');
		expect(await page.title()).not.toContain('Vault');
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		await surfacesIdle(page);
		const entries = await entriesOf(page);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		const { report } = await replayKernel(entries, {
			environment: createFixedEnvironment(),
			deployment: site.projection,
			ports: await replayPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	}, 60_000);
});

describe('P2-E4: the reviews of step 7 (T3)', () => {
	it("T3: signing out on a restricted project's home leaves its name nowhere, the section's own status line included", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await signIn(page);
		await kernelCall(page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [PERSON] },
		});
		await kernelCall(page, 'scope-set', { project: 'vault' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		const section = page.locator('loam-main loam-projects-section');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Vault');
		// An action on its home, which the status line reports by name.
		await section.locator('violet-button', { hasText: 'Rename' }).click();
		await section
			.locator('violet-text-field')
			.filter({ has: page.locator('label:text-is("Name")') })
			.locator('input')
			.fill('Vault Keys');
		await page.keyboard.press('Enter');
		await expect.poll(() => section.locator('.said').textContent()).toBe('Renamed Vault Keys');
		await page
			.locator('loam-titlebar violet-button, loam-titlebar button', { hasText: 'Sign out' })
			.first()
			.click();
		await expect.poll(() => section.locator('h1').textContent()).toBe('Projects');
		await expect.poll(() => deepText(page)).not.toContain('Vault');
		expect(await section.locator('.said').textContent()).toBe('');
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 60_000);
});

describe('P2-E4: the trust re-check of step 7 (N3)', () => {
	it("N3: signing out on the list at workspace level, with no change of scope, leaves a restricted project's name nowhere", async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await signIn(page);
		await page.locator('loam-rail loam-section-entry[section="projects"] button').click();
		const section = page.locator('loam-main loam-projects-section');
		await expect.poll(() => section.locator('h1').textContent()).toBe('Projects');
		await expect.poll(() => section.locator('form#create').count()).toBe(1);
		await section
			.locator('violet-text-field')
			.filter({ has: page.locator('label:text-is("Name")') })
			.locator('input')
			.fill('Vault');
		// The form makes a project open to the workspace; this one is restricted to the person, as
		// `project-create` takes, so the section's own create, and its status line, name a restricted project.
		await page.evaluate((member) => {
			const element = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main loam-projects-section') as unknown as {
				kernel: { call(name: string, input?: unknown): Promise<unknown> };
			};
			const real = element.kernel;
			element.kernel = {
				...real,
				call: (name: string, input?: unknown) =>
					real.call(
						name,
						name === 'project-create'
							? { ...(input as object), access: { mode: 'restricted', members: [member] } }
							: input
					),
			};
		}, PERSON);
		await section.locator('violet-button', { hasText: 'Create' }).click();
		await expect.poll(() => section.locator('.said').textContent()).toBe('Vault created');
		const scopeOf = async () =>
			((await kernelCall(page, 'scope-get')) as { data: { scope: unknown } }).data.scope;
		const before = await scopeOf();
		await page
			.locator('loam-titlebar violet-button, loam-titlebar button', { hasText: 'Sign out' })
			.first()
			.click();
		await settle(page);
		// No change of scope, the workspace before and after: only the auth event reached the section.
		expect(await scopeOf()).toEqual(before);
		await expect.poll(() => section.locator('.said').textContent()).toBe('');
		await expect.poll(() => deepText(page)).not.toContain('Vault');
		await opened.context.close();
	}, 60_000);
});

describe('P2-E7: a cross-project mutation is refused after the access decision, in Chromium', () => {
	it('P2-E7: through the palette’s interface and kernel.agent, with the journal read after each', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await signIn(page);
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'project-create', { name: 'Beacon' });
		await kernelCall(page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [PERSON] },
		});
		// A task in Beacon, t-1; two in Vault, t-1 and t-2; none in Atlas.
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		await kernelCall(page, 'tasks-add', { title: 'In Beacon' });
		await kernelCall(page, 'scope-set', { project: 'vault' });
		await kernelCall(page, 'tasks-add', { title: 'Vault one' });
		await kernelCall(page, 'tasks-add', { title: 'Vault two' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'auth-sign-out');
		await settle(page);
		// Signed out, so Vault is no project to this actor. Atlas has no task yet.
		for (const [call, iface] of [
			[() => kernelCall(page, 'tasks-complete', { task: 't-1' }), 'palette'],
			[() => agentCall(page, 'tasks-complete', { task: 't-1' }), 'agent'],
		] as const) {
			const crossed = (await call()) as {
				error: { code: string; message: string; suggestion: string; details?: unknown };
			};
			expect(crossed.error.code).toBe('SCOPE_MISMATCH');
			expect(crossed.error.message).toContain('the project Beacon, not Atlas');
			expect(crossed.error.suggestion).toContain('scope-set { project: "beacon" }');
			const entry = (await journal(page)).findLast(({ command }) => command === 'tasks-complete');
			expect(entry).toMatchObject({ command: 'tasks-complete', success: false, interface: iface });
			expect(entry?.error?.code).toBe('SCOPE_MISMATCH');
		}
		const vaultId = (
			(await entriesOf(page)).find(
				(entry) =>
					entry.command === 'project-create' && (entry.input as { name: string }).name === 'Vault'
			)?.result.data as { id: string } | undefined
		)?.id as string;
		expect(vaultId).toMatch(/^prj_/);
		// Only in a project the actor may not enter: it reaches the handler as a missing key, naming nothing,
		// through both interfaces, the journal read after each.
		for (const [call, iface] of [
			[() => kernelCall(page, 'tasks-complete', { task: 't-2' }), 'palette'],
			[() => agentCall(page, 'tasks-complete', { task: 't-2' }), 'agent'],
		] as const) {
			const hidden = await call();
			expect(hidden).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
			expect(JSON.stringify(hidden)).not.toMatch(/vault/i);
			expect(JSON.stringify(hidden)).not.toContain(vaultId);
			const entry = (await journal(page)).findLast(({ command }) => command === 'tasks-complete');
			expect(entry).toMatchObject({
				success: false,
				interface: iface,
				error: { code: 'TASK_NOT_FOUND' },
			});
			expect(JSON.stringify(entry)).not.toContain(vaultId);
		}
		// A scope naming the restricted project: the same bytes as one that does not exist.
		const restricted = await scopedCall(
			page,
			'tasks-list',
			{},
			{ workspace: 'personal', project: vaultId }
		);
		const missing = await scopedCall(
			page,
			'tasks-list',
			{},
			{ workspace: 'personal', project: 'prj_nowhere00' }
		);
		expect(restricted).toMatchObject({ success: false, error: { code: 'PROJECT_NOT_FOUND' } });
		expect(JSON.stringify((restricted as { error: unknown }).error)).toBe(
			JSON.stringify((missing as { error: unknown }).error)
		);
		// And through kernel.agent, with the journal read after.
		const agentScoped = (scope: unknown) =>
			page.evaluate(
				({ scope }) =>
					(
						document.querySelector('loam-shell') as unknown as {
							kernel: { agent: { call(n: string, i: unknown, o: unknown): Promise<unknown> } };
						}
					).kernel.agent.call('tasks-list', {}, { scope }),
				{ scope }
			);
		const agentRestricted = await agentScoped({ workspace: 'personal', project: vaultId });
		const agentMissing = await agentScoped({ workspace: 'personal', project: 'prj_nowhere00' });
		expect(JSON.stringify((agentRestricted as { error: unknown }).error)).toBe(
			JSON.stringify((agentMissing as { error: unknown }).error)
		);
		expect((agentRestricted as { error: { code: string } }).error.code).toBe('PROJECT_NOT_FOUND');
		const refusals = (await journal(page)).filter(
			({ command, error }) => command === 'tasks-list' && error?.code === 'PROJECT_NOT_FOUND'
		);
		expect(refusals.map((entry) => entry.interface)).toEqual([
			'palette',
			'palette',
			'agent',
			'agent',
		]);
		// A native app's store refuses a key that would name another scope's record with a `TypeError`.
		const thrown = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): {
						store?: { put(key: string, value: unknown): Promise<void> };
					};
				};
			};
			try {
				await shell.kernel.appPort('hello').store?.put('p~prj_beacon~x', 'v');
				return null;
			} catch (cause) {
				return { name: (cause as Error).name, message: (cause as Error).message };
			}
		});
		expect(thrown).toEqual({
			name: 'TypeError',
			message: 'A store key is a nonempty string other than "." and "..", not starting "p~"',
		});
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 60_000);

	it("P2-E7: a view's own `_meta` scope is ignored, and a nested query keeps the outer scope, through the frame and kernel.agent", async () => {
		const opened = await openShell(browser, scopedSite.root);
		const { page } = opened;
		const atlas = (
			(await kernelCall(page, 'project-create', { name: 'Atlas' })) as { data: { id: string } }
		).data.id;
		const beacon = (
			(await kernelCall(page, 'project-create', { name: 'Beacon' })) as { data: { id: string } }
		).data.id;
		const inAtlas = { workspace: 'personal', project: atlas };
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await openApp(page, 'scoped');
		const frame = await viewFrame(page);
		// The view names Beacon in `_meta`: ignored, its surface's scope is Atlas (3.2).
		const asked = await viewCall(frame, {
			name: 'scoped-where',
			arguments: {},
			_meta: { 'dev.loam/scope': { workspace: 'personal', project: beacon } },
		});
		expect(asked.result?.structuredContent?.data).toEqual({ scope: inAtlas });
		const where = (await journal(page)).findLast(({ command }) => command === 'scoped-where');
		expect(where?.context?.scope).toEqual(inAtlas);
		// A nested query keeps the outer call's scope, which here is not the active one (Atlas): the frame
		// asks the workspace level, and an agent names Beacon. A nested call that took the active scope fails.
		const atWorkspace = { workspace: 'personal' };
		const inBeacon = { workspace: 'personal', project: beacon };
		const wide = await viewCall(frame, {
			name: 'scoped-nested',
			arguments: {},
			_meta: { 'dev.loam/level': 'workspace' },
		});
		expect(wide.result?.structuredContent?.data).toEqual({
			outer: atWorkspace,
			nested: atWorkspace,
		});
		const fromAgent = (await page.evaluate(
			({ scope }) =>
				(
					document.querySelector('loam-shell') as unknown as {
						kernel: { agent: { call(n: string, i: unknown, o: unknown): Promise<unknown> } };
					}
				).kernel.agent.call('scoped-nested', {}, { scope }),
			{ scope: inBeacon }
		)) as { data: unknown };
		expect(fromAgent.data).toEqual({ outer: inBeacon, nested: inBeacon });
		// Each nested entry is journaled with its parent's trace ID, at that parent's scope.
		const raw = await entriesOf(page);
		const parents = raw.filter((entry) => entry.command === 'scoped-nested');
		expect(parents.map((entry) => entry.context?.scope)).toEqual([atWorkspace, inBeacon]);
		for (const parent of parents) {
			const child = raw.find(
				(entry) => entry.command === 'scoped-where' && entry.context?.parent === parent.traceId
			);
			expect(child?.context?.scope, parent.traceId).toEqual(parent.context?.scope);
		}
		expect(parents.at(-1)?.contextDigest?.interface).toBe('agent');
		// A `p~` key in the frame's `dev.loam/store` is the store's own `VALIDATION_ERROR` (-32602), as step 4
		// recorded, read from the reply itself; natively it is a `TypeError` (the palette case above).
		const stored = (await kernelCall(page, 'scoped-store')) as { success: boolean; data?: unknown };
		expect(stored).toMatchObject({
			success: true,
			data: { refused: { name: 'RpcFailure', code: -32602, data: { code: 'VALIDATION_ERROR' } } },
		});
		expect(opened.violations.filter((violation) => !violation.includes('frame-ancestors'))).toEqual(
			[]
		);
		await opened.context.close();
	}, 60_000);

	it("P2-E7: a view's store under Atlas reads nothing of Beacon's, and a `p~` key is refused", async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'project-create', { name: 'Beacon' });
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		expect(await kernelCall(page, 'hello-greet', { name: 'Only Beacon' })).toMatchObject({
			success: true,
		});
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		const listed = (await kernelCall(page, 'hello-list')) as {
			data: { items: Array<{ id: string }> };
		};
		expect(listed.data.items.map((item) => item.id)).not.toContain('Only Beacon');
		// A key that would name another scope's record is refused by the frame's store, `VALIDATION_ERROR`
		// there (step 4; the scoped view's case reads that reply), which hello's command answers as a throw.
		// Nothing is stored.
		const named = await kernelCall(page, 'hello-greet', { name: 'p~prj_beacon~x' });
		expect(named).toMatchObject({ success: false, error: { code: 'HANDLER_THREW' } });
		const relisted = (await kernelCall(page, 'hello-list')) as {
			data: { items: Array<{ id: string }> };
		};
		expect(relisted.data.items).toEqual([]);
		expect(opened.violations.filter((violation) => !violation.includes('frame-ancestors'))).toEqual(
			[]
		);
		await opened.context.close();
	}, 60_000);
});

describe('P2-E10: the stores, as IndexedDB holds them', () => {
	it('P2-E10: a row of Atlas carries its scope and is invisible to Beacon and the workspace; a second boot applies nothing', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'project-create', { name: 'Beacon' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'tasks-add', { title: 'Only Atlas' });
		await kernelCall(page, 'scope-set', { project: 'beacon' });
		expect(await kernelCall(page, 'tasks-list')).toMatchObject({ data: { items: [] } });
		// Hello at the workspace sees none of Atlas's rows either.
		expect(await scopedCall(page, 'hello-list', {}, 'workspace')).toMatchObject({
			data: { items: [] },
		});
		await settle(page);
		const rows = (await page.evaluate(
			() =>
				new Promise<unknown[]>((resolve, reject) => {
					const open = indexedDB.open('loam-store');
					open.onerror = () => reject(open.error);
					open.onsuccess = () => {
						const db = open.result;
						const stores = [...db.objectStoreNames];
						const read = db.transaction(stores, 'readonly');
						const all: unknown[] = [];
						let left = stores.length;
						for (const name of stores) {
							const request = read.objectStore(name).getAll();
							request.onsuccess = () => {
								all.push(...request.result);
								if (--left === 0) resolve(all);
							};
						}
					};
				})
		)) as Array<Record<string, unknown>>;
		const atlasId = (
			(await kernelCall(page, 'project-get', { project: 'atlas' })) as { data: { id: string } }
		).data.id;
		const task = rows.find((row) => JSON.stringify(row).includes('Only Atlas'));
		expect(JSON.stringify(task)).toContain(`p~${atlasId}~t-1`);
		expect(JSON.stringify(task)).toContain(`"scopeKey":"p:${atlasId}"`);
		expect(JSON.stringify(task)).toContain('"workspace":"personal"');
		// The project rows carry their workspace, their writer and their times.
		const project = rows.find((row) => JSON.stringify(row).includes(`"slug":"atlas"`));
		expect(JSON.stringify(project)).toMatch(
			/"createdBy":"local".*"updatedBy":"local"|"updatedBy":"local".*"createdBy":"local"/
		);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				ready: Promise<void>;
				kernel: { appsReady: Promise<void> };
			};
			await shell.ready;
			await shell.kernel.appsReady;
		});
		await settle(page);
		const applied = (await journal(page)).filter(
			({ command }) => command === 'workspace-deployment-apply'
		);
		expect(applied).toHaveLength(1);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 60_000);
});
