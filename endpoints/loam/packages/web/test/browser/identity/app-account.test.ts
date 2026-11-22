/**
 * P3-E14 in Chromium (phase 3 specification, 5.5 and 18): hello's `ui.account` section renders in the account section
 * at workspace level with a project active, through a surface port fixed to the workspace that refuses any other
 * scope, as a native app and as a view. A `local` deployment, since the section shows in both modes (5.1). Its units are
 * `profile-cases.json`'s `ui-account-*` cases (each schema branch and refusal) and the chrome's
 * `identity/account-surface.test.ts`.
 */

import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
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

let browser: Browser;
let native: DeploymentSite;
let view: DeploymentSite;
beforeAll(async () => {
	browser = await chromium.launch();
	native = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello'))),
	});
	view = await serveDeployment({
		config: deploymentFile(deploymentEntry('hello', await packApp('hello', 'view'))),
		sandbox: true,
	});
});
afterAll(async () => {
	await browser?.close();
	await native?.close();
	await view?.close();
});

const section = (page: Page) => page.locator('loam-main loam-account-section');

/** A shell with Atlas made and active, its workspace and Atlas's id. */
async function inAtlas(
	site: DeploymentSite
): Promise<{ page: Page; workspace: string; atlas: string }> {
	const { page } = await openShell(browser, site.origin);
	const made = (await kernelCall(page, 'project-create', { name: 'Atlas', slug: 'atlas' })) as {
		data: { id: string };
	};
	await kernelCall(page, 'scope-set', { project: made.data.id });
	await settle(page);
	const scope = (await kernelCall(page, 'scope-get')) as {
		data: { workspace: { id: string }; project: { id: string } | null };
	};
	expect(scope.data.project?.id).toBe(made.data.id);
	return { page, workspace: scope.data.workspace.id, atlas: made.data.id };
}

/** Open hello's section from the account section's tab, as a person does. */
async function openHelloTab(page: Page): Promise<void> {
	await kernelCall(page, 'section-open', { section: 'account' });
	await expect.poll(() => section(page).locator('[role="tab"]').count()).toBeGreaterThan(1);
	await section(page).getByRole('tab', { name: TAB }).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/~\/account\/hello\/greetings$/);
	await surfacesIdle(page);
}

/** The tab names its app, so it never passes for one of the shell's own (5.5). */
const TAB = 'Greetings (Hello)';

/** The account section's own `hello-main`, marked so a test can tell it from one made after it. */
const markMain = (page: Page) =>
	page.evaluate(() => {
		const account = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main')
			?.querySelector('loam-account-section');
		const mount = account?.shadowRoot?.querySelector('loam-mount') as unknown as {
			surface: { dataset: DOMStringMap } | null;
		};
		if (mount?.surface) mount.surface.dataset.marked = 'yes';
		return mount?.surface !== null;
	});

describe("P3-E14: an app's account section", () => {
	it('renders hello at workspace level with a project active, its port refusing any other scope (native)', async () => {
		const { page, workspace, atlas } = await inAtlas(native);
		await openHelloTab(page);
		const tab = section(page).getByRole('tab', { name: TAB });
		expect(await tab.getAttribute('aria-selected')).toBe('true');
		const panel = section(page).locator('[role="tabpanel"]');
		await expect
			.poll(() => panel.locator('.app-section .note').textContent())
			.toBe('From Hello, an app, for this workspace.');
		const mount = panel.locator('loam-mount[aria-label="Greetings, from Hello"]');
		await expect.poll(() => mount.locator('hello-main h1').textContent()).toBe('Hello');

		// The surface's own client: the port fixed to the workspace, whatever project is active.
		const calls = await page.evaluate(
			async ({ workspace, atlas }) => {
				const shell = document.querySelector('loam-shell') as HTMLElement;
				const account = shell.shadowRoot
					?.querySelector('loam-main')
					?.querySelector('loam-account-section') as HTMLElement;
				const mount = account.shadowRoot?.querySelector('loam-mount') as unknown as {
					surface: {
						context: {
							client: {
								call(name: string, input?: unknown, options?: unknown): Promise<unknown>;
							};
						};
					};
				};
				const { client } = mount.surface.context;
				return {
					here: await client.call('scope-get'),
					other: await client.call('hello-list', {}, { scope: { workspace, project: atlas } }),
					level: await client.call('hello-list', {}, { level: 'project' }),
					own: await client.call('hello-greet', { name: 'Ada' }),
				};
			},
			{ workspace, atlas }
		);
		// An app's `scope-get` is its own view of the scope: the workspace, and no project at all.
		expect((calls.here as { data: unknown }).data).toEqual({ scope: { workspace } });
		for (const refused of [calls.other, calls.level] as Array<{
			success: boolean;
			error: { code: string; suggestion: string };
		}>) {
			expect(refused.success).toBe(false);
			expect(refused.error.code).toBe('SCOPE_NOT_GRANTED');
			expect(refused.error.suggestion).toMatch(/\S/);
		}
		expect((calls.own as { success: boolean }).success).toBe(true);
		await settle(page);
		// The greeting ran as the app, at the workspace: the journal's entry names no project.
		const greeted = (await journal(page)).findLast(({ command }) => command === 'hello-greet');
		expect(greeted?.context?.caller).toBe('hello');
		expect(greeted?.context?.scope).toEqual({ workspace });

		// Hello's own setting, changed for the workspace, reaches the section's surface in place (phase 4's 3.8).
		await kernelCall(page, 'setting-set', {
			section: 'hello.general',
			key: 'greeting',
			value: 'Hey',
			level: 'workspace',
			expected: 'Hello',
		});
		await expect
			.poll(() => mount.locator('hello-main .greets').textContent())
			.toBe('Greets with Hey');
		// Its modal is refused outside the active app, and says so rather than failing unheard.
		await mount.locator('hello-main violet-button.modal').click();
		await expect.poll(() => mount.locator('hello-main .answer').textContent()).toMatch(/\S/);

		// The account section shows nothing of the project: its address is the workspace's.
		expect(new URL(page.url()).pathname).not.toContain('/p/atlas');
		expect(await axe(page)).toEqual([]);

		// Another tab drops the surface; the app's tab brings it back.
		await section(page).getByRole('tab', { name: 'Profile' }).click();
		await expect.poll(() => panel.locator('loam-mount').count()).toBe(0);
		await section(page).getByRole('tab', { name: TAB }).click();
		await expect.poll(() => panel.locator('hello-main').count()).toBe(1);

		// A reload straight into the tab waits for the app surfaces, and shows hello rather than "unavailable".
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await expect.poll(() => panel.locator('hello-main h1').textContent()).toBe('Hello');
		expect(await panel.getByText('is unavailable').count()).toBe(0);
		await page.context().close();
	});

	it("drops the surface made for one person when another signs in, and every app's tab when main's gate closes", async () => {
		const { page } = await inAtlas(native);
		await openHelloTab(page);
		const panel = section(page).locator('[role="tabpanel"]');
		await expect.poll(() => panel.locator('hello-main').count()).toBe(1);
		expect(await markMain(page)).toBe(true);
		const signedIn = (await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		})) as { success: boolean };
		expect(signedIn.success).toBe(true);
		await settle(page);
		// A new surface for the person now signed in: the one marked before is gone.
		await expect.poll(() => panel.locator('hello-main[data-marked]').count()).toBe(0);
		await expect.poll(() => panel.locator('hello-main').count()).toBe(1);
		// Main's gate closing (as for a person who is no member, which a `local` deployment never has, so it is set here
		// as the shell sets it): no app's tab or surface stays.
		await page.evaluate(() => {
			(document.querySelector('loam-shell') as unknown as { gate: string }).gate = 'not-member';
		});
		await expect.poll(() => section(page).getByRole('tab', { name: TAB }).count()).toBe(0);
		await expect.poll(() => panel.locator('hello-main').count()).toBe(0);
		await page.context().close();
	});

	it('renders hello as a view, its broker fixed to the workspace', async () => {
		const { page, workspace, atlas } = await inAtlas(view);
		await openHelloTab(page);
		const frame = await viewFrame(page);
		await expect.poll(() => frame.locator('#greets').textContent()).toBe('Greets with Hello');
		const here = (await viewCall(frame, { name: 'scope-get', arguments: {} })) as {
			result?: { structuredContent?: { data?: unknown } };
		};
		expect(here.result?.structuredContent?.data).toEqual({ scope: { workspace } });
		// A scope the view names is not the one it runs in: the broker keeps the workspace's.
		const greet = (await viewCall(frame, {
			name: 'hello-greet',
			arguments: { name: 'Bea' },
			_meta: { 'dev.loam/scope': { workspace, project: atlas } },
		})) as { result?: { isError?: boolean; structuredContent?: { data?: unknown } } };
		expect(greet.result?.isError).not.toBe(true);
		expect(greet.result?.structuredContent?.data).toMatchObject({ greeting: 'Hello, Bea!' });
		await settle(page);
		const greeted = (await journal(page)).findLast(({ command }) => command === 'hello-greet');
		expect(greeted?.success).toBe(true);
		expect(greeted?.context?.scope).toEqual({ workspace });
		// A level the view asks for other than the workspace's is refused, as a native surface's is.
		const deeper = (await viewCall(frame, {
			name: 'hello-list',
			arguments: {},
			_meta: { 'dev.loam/level': 'project' },
		})) as { result?: { isError?: boolean; structuredContent?: { error?: { code?: string } } } };
		expect(deeper.result?.isError).toBe(true);
		expect(deeper.result?.structuredContent?.error?.code).toBe('SCOPE_NOT_GRANTED');

		// Another tab: the view is hidden and told first, then goes (phase 1's 6.2).
		const element = page.locator('loam-account-section loam-view-frame');
		await section(page).getByRole('tab', { name: 'Profile' }).click();
		await expect.poll(() => element.count()).toBe(0);

		// Leaving the section while the view shows: the section is hidden at once, then goes once the view has answered.
		await section(page).getByRole('tab', { name: TAB }).click();
		await viewFrame(page);
		// Read the moment it is marked leaving, before the view can answer, so the check fails if it stays shown.
		const leaving = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown): Promise<unknown> };
				shadowRoot: ShadowRoot;
			};
			const main = shell.shadowRoot.querySelector('loam-main') as HTMLElement;
			const seen = new Promise<string>((resolve) => {
				const observer = new MutationObserver(() => {
					const held = main.querySelector<HTMLElement>('loam-account-section[data-leaving]');
					if (!held) return;
					observer.disconnect();
					resolve(getComputedStyle(held).display);
				});
				observer.observe(main, {
					attributes: true,
					subtree: true,
					attributeFilter: ['data-leaving'],
				});
			});
			await shell.kernel.call('section-open', { section: 'projects' });
			return seen;
		});
		expect(leaving).toBe('none');
		await expect.poll(() => page.locator('loam-account-section').count()).toBe(0);
		await page.context().close();
	});
});

/** The view's own frame, inside the proxy's. */
async function viewFrame(page: Page): Promise<Frame> {
	const element = await page.locator('loam-account-section loam-view-frame iframe').elementHandle();
	const outer = await element?.contentFrame();
	if (!outer) throw new Error('No outer frame');
	await expect.poll(() => outer.childFrames().length).toBe(1);
	return outer.childFrames()[0] as Frame;
}

/** A `tools/call` as code in the view sends it. */
function viewCall(frame: Frame, params: unknown) {
	return frame.evaluate(
		(params) =>
			new Promise<unknown>((resolve) => {
				const id = `e14-${Math.random()}`;
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
