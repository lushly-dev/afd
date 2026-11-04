/**
 * The Chromium parts of E4, E7 and E10 (phase 2 specification, 15; step 7), now that the rail and the
 * projects section are there: the scripted session replayed with zero differences, a sign-out inside a
 * restricted project leaving nothing of it on the page, a cross-project mutation refused after the access
 * decision through both interfaces, a view's store bound to its scope, and the store's rows as IndexedDB
 * holds them, each record's scope among them.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	createFixedEnvironment,
	createFixturePorts,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APPS,
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
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
});
afterAll(async () => {
	await site?.close();
	await viewSite?.close();
	await browser?.close();
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
		// A task in Beacon, t-1; two in Vault, t-1 and t-2; one in Atlas, t-1.
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
		// Only in a project the actor may not enter: it reaches the handler as a missing key, naming nothing.
		const hidden = await agentCall(page, 'tasks-complete', { task: 't-2' });
		expect(hidden).toMatchObject({ success: false, error: { code: 'TASK_NOT_FOUND' } });
		expect(JSON.stringify(hidden)).not.toMatch(/vault/i);
		expect(
			(await journal(page)).findLast(({ command }) => command === 'tasks-complete')?.error?.code
		).toBe('TASK_NOT_FOUND');
		// A scope naming the restricted project: the same bytes as one that does not exist.
		const vaultId = (
			(await entriesOf(page)).find(
				(entry) =>
					entry.command === 'project-create' && (entry.input as { name: string }).name === 'Vault'
			)?.result.data as { id: string } | undefined
		)?.id;
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
		expect(opened.errors).toEqual([]);
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
		// A key that would name another scope's record is refused by the frame's store.
		const named = await kernelCall(page, 'hello-greet', { name: 'p~prj_beacon~x' });
		expect(named).toMatchObject({ success: false });
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
