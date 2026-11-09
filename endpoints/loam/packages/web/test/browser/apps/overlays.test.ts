/**
 * E6 (phase 1 specification, section 14): a toast and a modal in hello leave nothing on screen after a
 * switch, and returning restores what the catalog parks.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
beforeAll(async () => {
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally'))
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

const modalOpen = (page: Page) =>
	page.evaluate(() => {
		const walk = (root: ParentNode): boolean => {
			for (const element of root.querySelectorAll('*')) {
				if (element instanceof HTMLDialogElement && element.open) return true;
				if (element.shadowRoot && walk(element.shadowRoot)) return true;
			}
			return false;
		};
		return walk(document);
	});

describe('P2-E13: E6: overlays and a switch', () => {
	it('leaves nothing of hello on screen, and restores what it parked', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1280, height: 420 },
		});
		const { page } = opened;
		await openApp(page, 'hello');
		for (const name of ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit']) {
			await agentCall(page, 'hello-greet', { name });
		}
		await surfacesIdle(page);
		await expect.poll(() => page.locator('loam-list violet-option').count()).toBe(11);

		// The list scrolls; remember where, and the element itself.
		const scrolled = await page.locator('loam-list').evaluate((list) => {
			const scrollers: Element[] = [];
			const walk = (root: Element | ShadowRoot) => {
				for (const element of root.children) {
					if (element.scrollHeight > element.clientHeight + 1) scrollers.push(element);
					walk(element);
					if (element.shadowRoot) walk(element.shadowRoot);
				}
			};
			walk(list.shadowRoot as ShadowRoot);
			const part = (list.getRootNode() as ShadowRoot).querySelector('loam-sidebar');
			const body = part?.shadowRoot?.querySelector('.body') as Element;
			const scroller = scrollers[0] ?? body;
			scroller.scrollTop = 40;
			(window as unknown as { listBefore: Element }).listBefore = list;
			return { top: scroller.scrollTop, inList: scrollers.length > 0 };
		});
		expect(scrolled.top).toBeGreaterThan(0);

		await page.locator('hello-main violet-button.toast').click();
		await page.locator('loam-toast').waitFor();
		// Opened through the port, as `overlays.modal` does, to hold what `waitOverlay` answers.
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				shadowRoot: ShadowRoot;
				kernel: {
					appPort(instance: string): {
						call(name: string, input: unknown): Promise<{ data: { overlayId: string } }>;
						waitOverlay(id: string): Promise<unknown>;
					};
				};
			};
			const held = window as unknown as { modalAnswer: Promise<unknown>; mountBefore: unknown };
			const port = shell.kernel.appPort('hello');
			const { data } = await port.call('modal-open', { title: 'Say hello?', body: 'Or not.' });
			held.modalAnswer = port.waitOverlay(data.overlayId);
			held.mountBefore = shell.shadowRoot.querySelector('loam-main loam-mount');
		});
		await page.locator('loam-modal dialog[open]').waitFor();
		expect(await page.locator('loam-modal h2').textContent()).toBe('Say hello?');
		const statusBefore = await page.locator('[data-status-item="count"]').count();
		expect(statusBefore).toBe(1);
		const refused = (await kernelCall(page, 'modal-open', {
			title: 'Second',
			body: 'A second modal',
		})) as { error: { code: string } };
		expect(refused.error.code).toBe('OVERLAY_MODAL_BUSY');

		const greetsBefore = (await journal(page)).filter(
			({ command }) => command === 'hello-greet'
		).length;
		await agentCall(page, 'app-open', { instance: 'tally' });
		await surfacesIdle(page);
		await page.locator('tally-main').waitFor();

		const list = (await agentCall(page, 'overlay-list')) as { data: { overlays: unknown[] } };
		expect(list.data.overlays).toEqual([]);
		await expect.poll(() => page.locator('loam-toast').count()).toBe(0);
		await expect.poll(() => modalOpen(page)).toBe(false);
		expect(
			await page.evaluate(
				() => (window as unknown as { modalAnswer: Promise<unknown> }).modalAnswer
			)
		).toMatchObject({ result: 'cancel', reason: 'app-switch' });
		// What held focus has gone, and focus does not fall to the page.
		expect((await focused(page)).part).toBe('main');
		expect(await page.locator('hello-main').count()).toBe(0);
		expect(await page.locator('hello-inspector').count()).toBe(0);
		expect(await page.locator('loam-list').count()).toBe(0);
		expect(await page.locator('[data-status-item="count"]').count()).toBe(0);

		// Hello's chord is gone with it.
		await page.keyboard.press('ControlOrMeta+Shift+H');
		await surfacesIdle(page);
		expect((await journal(page)).filter(({ command }) => command === 'hello-greet').length).toBe(
			greetsBefore
		);

		await openApp(page, 'hello');
		const restored = await page.evaluate(() => {
			const part = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-sidebar');
			const list = part?.querySelector('loam-list') as Element;
			let top = part?.shadowRoot?.querySelector('.body')?.scrollTop ?? 0;
			const walk = (root: Element | ShadowRoot) => {
				for (const element of root.children) {
					top = Math.max(top, element.scrollTop);
					walk(element);
					if (element.shadowRoot) walk(element.shadowRoot);
				}
			};
			walk(list.shadowRoot as ShadowRoot);
			return {
				same: list === (window as unknown as { listBefore: Element }).listBefore,
				top,
				// Main is re-created, where the sidebar is the same element.
				mainIsNew:
					(window as unknown as { mountBefore: unknown }).mountBefore !==
					document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main loam-mount'),
			};
		});
		expect(restored.same).toBe(true);
		expect(restored.top).toBe(scrolled.top);
		expect(restored.mainIsNew).toBe(true);
		expect(await page.locator('loam-main hello-main').count()).toBe(1);
		expect(await page.locator('[data-status-item="count"]').textContent()).toBe('11');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('resolves a modal for its app, refuses one from an inactive app, and journals both', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		await page.locator('hello-main violet-button.modal').click();
		await page.locator('loam-modal dialog[open]').waitFor();
		await agentCall(page, 'app-open', { instance: 'tally' });
		await surfacesIdle(page);

		// Keep hello's context, as a surface that outlives a switch does: its modal is now refused.
		const refused = await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): {
						call(name: string, input: unknown): Promise<{ error?: { code: string } }>;
					};
				};
			};
			const answer = await shell.kernel
				.appPort('hello')
				.call('modal-open', { title: 'Late', body: 'From an inactive app' });
			return answer.error?.code;
		});
		expect(refused).toBe('OVERLAY_OWNER_INACTIVE');
		await surfacesIdle(page);
		const failures = (await journal(page)).filter(
			({ command, success }) => command === 'modal-open' && !success
		);
		expect(failures.length).toBeGreaterThan(0);

		await openApp(page, 'hello');
		await page.locator('hello-main violet-button.modal').click();
		await page.locator('loam-modal dialog[open]').waitFor();
		await page.locator('loam-modal button.confirm').click();
		await expect
			.poll(() => page.locator('hello-main .answer').textContent())
			.toBe('The modal closed with confirm');
		await opened.context.close();
	});

	it('traps Tab, cancels on Escape, keeps the palette shut and returns focus', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		const button = page.locator('hello-main violet-button.modal');
		await button.focus();
		await page.keyboard.press('Enter');
		await page.locator('loam-modal dialog[open]').waitFor();
		await expect.poll(async () => (await focused(page)).label).toBe('Say hello');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		expect((await focused(page)).hosts).toContain('loam-modal');
		await page.keyboard.press('Shift+Tab');
		expect((await focused(page)).hosts).toContain('loam-modal');

		// Mod+K and F6 do nothing while a modal is open.
		const before = (await journal(page)).length;
		await page.keyboard.press('ControlOrMeta+K');
		await page.keyboard.press('F6');
		await surfacesIdle(page);
		expect((await journal(page)).slice(before).map(({ command }) => command)).not.toContain(
			'palette-open'
		);
		expect((await focused(page)).hosts).toContain('loam-modal');

		await page.keyboard.press('Escape');
		await expect
			.poll(() => page.locator('hello-main .answer').textContent())
			.toBe('The modal closed with cancel');
		await expect.poll(() => modalOpen(page)).toBe(false);
		// Focus is back on the very button that opened it.
		expect(
			await page.evaluate(() => {
				let element: Element | null = document.activeElement;
				while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
				const host = (element?.getRootNode() as ShadowRoot | null)?.host;
				return host?.classList.contains('modal') ?? false;
			})
		).toBe(true);
		await opened.context.close();
	});

	it('focuses cancel first on a danger modal, and closes the palette and a drawer first', async () => {
		const opened = await openShell(browser, site.origin, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await kernelCall(page, 'layout-set', { compact: { drawer: 'sidebar' } });
		await page.locator('loam-sidebar dialog[open]').waitFor();
		await kernelCall(page, 'modal-open', {
			title: 'Delete?',
			body: 'It is gone for good.',
			danger: true,
		});
		await page.locator('loam-modal dialog[open]').waitFor();
		await expect.poll(() => page.locator('loam-sidebar dialog[open]').count()).toBe(0);
		expect((await focused(page)).label).toBe('Cancel');
		await page.keyboard.press('Escape');
		await expect.poll(() => modalOpen(page)).toBe(false);

		await page.setViewportSize({ width: 1280, height: 800 });
		await page.keyboard.press('ControlOrMeta+K');
		await page.waitForFunction(() => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette');
			return (palette as unknown as { isOpen?: boolean } | null)?.isOpen === true;
		});
		await kernelCall(page, 'modal-open', { title: 'Sure?', body: 'Are you?' });
		await page.locator('loam-modal dialog[open]').waitFor();
		const paletteOpen = await page.evaluate(() => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette');
			return (palette as unknown as { isOpen?: boolean } | null)?.isOpen;
		});
		expect(paletteOpen).toBe(false);
		await opened.context.close();
	});

	it('holds a toast that arrives during a modal, since it could not be heard or dismissed', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await kernelCall(page, 'toast-show', { message: 'Before', durationMs: 1000 });
		await page.locator('loam-toast').waitFor();
		await kernelCall(page, 'modal-open', { title: 'Sure?', body: 'Are you?' });
		await page.locator('loam-modal dialog[open]').waitFor();
		await kernelCall(page, 'toast-show', { message: 'During', durationMs: 1000 });
		await surfacesIdle(page);
		expect(await page.locator('loam-toast').count()).toBe(1);
		// A shown toast's timer stops too.
		await page.waitForTimeout(1300);
		expect(await page.locator('loam-toast').count()).toBe(1);
		await page.locator('loam-modal button.cancel').click();
		await expect
			.poll(() =>
				page.locator('loam-toast').evaluateAll((all) => all.map((t) => t.getAttribute('message')))
			)
			.toEqual(['Before', 'During']);
		await expect.poll(() => page.locator('loam-toast').count(), { timeout: 4000 }).toBe(0);
		await opened.context.close();
	});

	it('dismisses a toast by its timer, on a press and at the cap, and holds it while hovered', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await kernelCall(page, 'toast-show', { message: 'Quick', durationMs: 1000 });
		await page.locator('loam-toast').waitFor();
		expect(await page.locator('loam-toast-region').getAttribute('role')).toBe('status');
		await expect.poll(() => page.locator('loam-toast').count(), { timeout: 4000 }).toBe(0);
		const dismissals = (await journal(page)).filter(({ command }) => command === 'overlay-dismiss');
		expect(dismissals.at(-1)?.input).toMatchObject({ reason: 'timeout' });

		await kernelCall(page, 'toast-show', { message: 'Held', durationMs: 1000 });
		const held = page.locator('loam-toast');
		await held.hover();
		await page.waitForTimeout(1300);
		expect(await held.count()).toBe(1);
		await held.locator('button.dismiss').click();
		await expect.poll(() => held.count()).toBe(0);

		for (let index = 0; index < 6; index++) {
			await kernelCall(page, 'toast-show', { message: `Toast ${index}`, durationMs: 30000 });
		}
		await surfacesIdle(page);
		await expect.poll(() => held.count()).toBe(5);
		expect(await held.first().getAttribute('message')).toBe('Toast 1');

		await kernelCall(page, 'toast-show', {
			message: 'It failed',
			tone: 'danger',
			durationMs: 30000,
		});
		await surfacesIdle(page);
		expect(await page.locator('loam-toast[tone="danger"]').getAttribute('role')).toBe('alert');
		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});
