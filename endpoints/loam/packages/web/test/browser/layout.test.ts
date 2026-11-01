/**
 * E1 and E5 (phase 0 specification, section 11): every layout change is one journaled command,
 * and the DOM's parts match `layout-get`; the layout classes at 390, 800, 1024 and 1280 wide.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type EntrySummary,
	focused,
	journal,
	type Layout,
	layoutOf,
	openShell,
	type PartBox,
	parts,
	type ShellPage,
	serveDist,
	settle,
} from './harness';

let browser: Browser;
let site: Awaited<ReturnType<typeof serveDist>>;
beforeAll(async () => {
	site = await serveDist();
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

/** Reads the chrome makes after a change; they are queries and change nothing. */
const READS = new Set(['layout-get', 'appearance-get', 'auth-session-get']);

/** Run `action`, then return the entries it added: exactly one for `command`, the rest reads. */
async function change(
	page: Page,
	command: string,
	action: () => Promise<unknown>
): Promise<EntrySummary> {
	const before = (await journal(page)).length;
	await action();
	await settle(page);
	const added = (await journal(page)).slice(before);
	const matching = added.filter((entry) => entry.command === command);
	expect(matching, JSON.stringify(added)).toHaveLength(1);
	expect(added.filter((entry) => entry.command !== command && !READS.has(entry.command))).toEqual(
		[]
	);
	return matching[0] as EntrySummary;
}

/** The DOM's parts against `layout-get` in the expanded or medium class. */
async function expectDomMatches(page: Page): Promise<Layout> {
	const layout = await layoutOf(page);
	const dom = await parts(page);
	const side = (box: PartBox, state: { open: boolean; width: number }) => {
		expect(box.present).toBe(state.open);
		if (box.mode === 'inline') expect(box.width).toBe(state.width);
	};
	if (dom.layoutClass === 'compact') {
		expect(dom.sidebar.present).toBe(layout.compact.drawer === 'sidebar');
		expect(dom.inspector.present).toBe(layout.compact.drawer === 'inspector');
		expect(dom.panel.present).toBe(layout.compact.sheet);
		return layout;
	}
	side(dom.sidebar, layout.sidebar);
	side(dom.inspector, layout.inspector);
	expect(dom.panel.present).toBe(layout.panel.open);
	if (dom.panel.mode === 'inline') expect(dom.panel.height).toBe(layout.panel.height);
	if (dom.panel.mode === 'maximized') {
		expect(dom.main.height).toBe(0);
		expect(dom.panel.height).toBeGreaterThan(layout.panel.height);
	}
	return layout;
}

async function shellAt(width: number, height = 900): Promise<ShellPage> {
	return openShell(browser, site.origin, { viewport: { width, height } });
}

function noViolations(opened: ShellPage) {
	expect(opened.violations).toEqual([]);
	expect(opened.errors).toEqual([]);
}

describe('E1: every layout change is a journaled command', () => {
	it('records chords, title-bar toggles and part buttons, and the DOM follows', async () => {
		const opened = await shellAt(1600);
		const { page } = opened;
		await expectDomMatches(page);

		const closeSidebar = await change(page, 'layout-set', () =>
			page.keyboard.press('ControlOrMeta+B')
		);
		expect(closeSidebar.input).toEqual({ sidebar: { open: false } });
		expect((await expectDomMatches(page)).sidebar.open).toBe(false);

		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+B'));
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+Alt+B'));
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));
		const layout = await expectDomMatches(page);
		expect([layout.sidebar.open, layout.inspector.open, layout.panel.open]).toEqual([
			true,
			true,
			true,
		]);

		await change(page, 'layout-set', () => page.locator('loam-panel button.maximize').click());
		expect((await expectDomMatches(page)).panel.maximized).toBe(true);
		await change(page, 'layout-set', () => page.locator('loam-panel button.maximize').click());
		await change(page, 'layout-set', () =>
			page.locator('loam-titlebar button[data-toggle="panel"]').click()
		);
		expect((await expectDomMatches(page)).panel.open).toBe(false);
		await change(page, 'layout-set', () => page.locator('loam-inspector button.close').click());
		expect((await expectDomMatches(page)).inspector.open).toBe(false);
		noViolations(opened);
		await opened.context.close();
	});

	it('records every handle: arrow steps, Home and End, a drag and a click', async () => {
		const opened = await shellAt(1600);
		const { page } = opened;
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+Alt+B'));
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));

		const sidebarHandle = page.locator('loam-resize-handle[data-resizes="sidebar"]');
		await sidebarHandle.focus();
		const step = await change(page, 'layout-set', () => page.keyboard.press('ArrowRight'));
		expect(step.input).toEqual({ sidebar: { width: 276 } });
		await change(page, 'layout-set', () => page.keyboard.press('End'));
		expect((await expectDomMatches(page)).sidebar.width).toBe(480);
		await change(page, 'layout-set', () => page.keyboard.press('Home'));
		expect((await expectDomMatches(page)).sidebar.width).toBe(200);
		expect(await sidebarHandle.getAttribute('aria-valuenow')).toBe('200');

		const inspectorHandle = page.locator('loam-resize-handle[data-resizes="inspector"]');
		const box = await inspectorHandle.boundingBox();
		if (!box) throw new Error('No inspector handle');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const drag = await change(page, 'layout-set', async () => {
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x - 20, y, { steps: 4 });
			await page.mouse.move(x - 60, y, { steps: 4 });
			await page.mouse.up();
		});
		expect(drag.input).toEqual({ inspector: { width: 360 } });
		expect((await expectDomMatches(page)).inspector.width).toBe(360);

		// A click without dragging steps to the next preset size (WCAG 2.5.7's alternative).
		const click = await change(page, 'layout-set', () => inspectorHandle.click());
		expect(click.input).toEqual({ inspector: { width: 520 } });

		const panelHandle = page.locator('loam-resize-handle[data-resizes="panel"]');
		await panelHandle.focus();
		const up = await change(page, 'layout-set', () => page.keyboard.press('ArrowUp'));
		expect(up.input).toEqual({ panel: { height: 256 } });
		expect((await expectDomMatches(page)).panel.height).toBe(256);
		expect(await panelHandle.getAttribute('aria-orientation')).toBe('horizontal');
		noViolations(opened);
		await opened.context.close();
	});

	it('records a palette action and the palette opening and closing', async () => {
		const opened = await shellAt(1280);
		const { page } = opened;
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));
		await change(page, 'palette-open', () => page.keyboard.press('ControlOrMeta+K'));
		await page.waitForFunction(
			() =>
				(
					document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelector('loam-palette') as unknown as {
						isOpen: boolean;
					}
				)?.isOpen === true
		);
		await page.keyboard.type('reset layout');
		await page.waitForFunction(() => {
			const palette = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-palette');
			return (
				palette?.shadowRoot?.querySelector('violet-option')?.getAttribute('value') ===
				'layout-reset'
			);
		});
		const before = (await journal(page)).length;
		await page.keyboard.press('Enter');
		await settle(page);
		const added = (await journal(page)).slice(before).map((entry) => entry.command);
		expect(added.filter((command) => !READS.has(command))).toEqual([
			'layout-reset',
			'palette-close',
		]);
		const layout = await expectDomMatches(page);
		expect(layout.panel.open).toBe(false);
		noViolations(opened);
		await opened.context.close();
	});

	it("records view-state-set on loam.layout through kernel.agent, and refuses what's out of range", async () => {
		const opened = await shellAt(1280);
		const { page } = opened;
		const set = await change(page, 'view-state-set', () =>
			agentCall(page, 'view-state-set', { id: 'loam.layout', state: { sidebar: { width: 300 } } })
		);
		expect(set).toMatchObject({ success: true, interface: 'agent' });
		expect((await expectDomMatches(page)).sidebar.width).toBe(300);

		const refused = await change(page, 'view-state-set', () =>
			agentCall(page, 'view-state-set', { id: 'loam.layout', state: { sidebar: { width: 1000 } } })
		);
		expect(refused.success).toBe(false);
		expect((await expectDomMatches(page)).sidebar.width).toBe(300);
		noViolations(opened);
		await opened.context.close();
	});

	it('moves focus between the present parts with F6 and Shift+F6, with no command', async () => {
		const opened = await shellAt(1280);
		const { page } = opened;
		const before = (await journal(page)).length;
		const order: (string | null)[] = [];
		for (let step = 0; step < 5; step++) {
			await page.keyboard.press('F6');
			order.push((await focused(page)).part);
		}
		expect(order).toEqual(['titlebar', 'rail', 'sidebar', 'main', 'statusbar']);
		await page.keyboard.press('Shift+F6');
		expect((await focused(page)).part).toBe('main');
		expect((await journal(page)).length).toBe(before);
		await opened.context.close();
	});

	it('routes another path to "Nothing here" and its link home, through the Navigation API', async () => {
		const opened = await shellAt(1280);
		const { page } = opened;
		await page.evaluate(() =>
			(window as unknown as { navigation: { navigate(url: string): unknown } }).navigation.navigate(
				'/elsewhere'
			)
		);
		await expect.poll(() => page.locator('loam-main h1').textContent()).toBe('Nothing here');
		await page.locator('loam-main a').click();
		await expect.poll(() => page.locator('loam-main h1').textContent()).toBe('No apps yet');
		expect(new URL(page.url()).pathname).toBe('/');
		noViolations(opened);
		await opened.context.close();
	});
});

describe('E5: the layout classes', () => {
	it('shows the tab bar and a modal drawer at 390 × 844, trapping and returning focus', async () => {
		const opened = await openShell(browser, site.origin, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		let dom = await parts(page);
		expect(dom.layoutClass).toBe('compact');
		expect([dom.rail.present, dom.statusbar.present, dom.tabbar.present]).toEqual([
			false,
			false,
			true,
		]);
		expect(dom.sidebar.present).toBe(false);

		const toggle = page.locator('loam-titlebar button[data-toggle="sidebar"]');
		await toggle.focus();
		const open = await change(page, 'layout-set', () => page.keyboard.press('Enter'));
		expect(open.input).toEqual({ compact: { drawer: 'sidebar' } });
		dom = await parts(page);
		expect(dom.sidebar.modal).toBe(true);
		expect(dom.sidebar.width).toBe(320);
		expect((await focused(page)).hosts).toContain('loam-sidebar');
		for (let step = 0; step < 4; step++) {
			await page.keyboard.press('Tab');
			expect((await focused(page)).hosts).toContain('loam-sidebar');
		}
		const close = await change(page, 'layout-set', () => page.keyboard.press('Escape'));
		expect(close.input).toEqual({ compact: { drawer: null } });
		expect((await parts(page)).sidebar.present).toBe(false);
		expect(await focused(page)).toMatchObject({
			tag: 'button',
			hosts: ['loam-shell', 'loam-titlebar'],
		});
		expect((await focused(page)).label).toBe('Sidebar');
		await expectDomMatches(page);

		const sheet = await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));
		expect(sheet.input).toEqual({ compact: { sheet: true } });
		dom = await parts(page);
		expect(dom.panel.mode).toBe('sheet');
		expect(dom.panel.height).toBeGreaterThanOrEqual(Math.floor(844 * 0.4));
		expect(dom.panel.height).toBeLessThanOrEqual(Math.ceil(844 * 0.8));
		await change(page, 'layout-set', () => page.keyboard.press('Escape'));
		expect((await parts(page)).panel.present).toBe(false);
		noViolations(opened);
		await opened.context.close();
	});

	it('closes a compact drawer before the palette opens: one modal at a time', async () => {
		const opened = await openShell(browser, site.origin, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+B'));
		expect((await parts(page)).sidebar.modal).toBe(true);
		const before = (await journal(page)).length;
		await page.keyboard.press('ControlOrMeta+K');
		await settle(page);
		const added = (await journal(page)).slice(before).filter((entry) => !READS.has(entry.command));
		expect(added.map((entry) => [entry.command, entry.input])).toEqual([
			['layout-set', { compact: { drawer: null } }],
			['palette-open', {}],
		]);
		expect((await parts(page)).sidebar.present).toBe(false);
		const modals = await page.evaluate(() => {
			const count = (root: Document | ShadowRoot): number =>
				[...root.querySelectorAll('*')].reduce(
					(sum, element) =>
						sum +
						(element instanceof HTMLDialogElement && element.matches(':modal') ? 1 : 0) +
						(element.shadowRoot ? count(element.shadowRoot) : 0),
					0
				);
			return count(document);
		});
		expect(modals).toBe(1);
		noViolations(opened);
		await opened.context.close();
	});

	it('closes an open drawer and sheet when leaving the compact class', async () => {
		const opened = await openShell(browser, site.origin, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));
		await change(page, 'layout-set', () => page.setViewportSize({ width: 1280, height: 844 }));
		const layout = await layoutOf(page);
		expect(layout.compact).toEqual({ drawer: null, sheet: false });
		expect((await parts(page)).layoutClass).toBe('expanded');
		await opened.context.close();
	});

	it('keeps the sidebar and panel inline at 800 and floats the inspector, closed by Escape', async () => {
		const opened = await shellAt(800);
		const { page } = opened;
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+Alt+B'));
		await change(page, 'layout-set', () => page.keyboard.press('ControlOrMeta+J'));
		const dom = await parts(page);
		expect(dom.layoutClass).toBe('medium');
		expect([dom.sidebar.mode, dom.inspector.mode, dom.panel.mode]).toEqual([
			'inline',
			'overlay',
			'inline',
		]);
		expect(dom.inspector.modal).toBe(false);
		await expectDomMatches(page);
		const closed = await change(page, 'layout-set', () => page.keyboard.press('Escape'));
		expect(closed.input).toEqual({ inspector: { open: false } });
		noViolations(opened);
		await opened.context.close();
	});

	it('floats the inspector at 1024 when both side parts are open at their maximum', async () => {
		const opened = await shellAt(1024);
		const { page } = opened;
		await agentCall(page, 'layout-set', {
			sidebar: { open: true, width: 480 },
			inspector: { open: true, width: 520 },
		});
		await settle(page);
		let dom = await parts(page);
		expect(dom.layoutClass).toBe('expanded');
		expect([dom.sidebar.mode, dom.inspector.mode]).toEqual(['inline', 'overlay']);
		expect(dom.main.width).toBeGreaterThanOrEqual(360);
		await page.setViewportSize({ width: 1600, height: 900 });
		await settle(page);
		dom = await parts(page);
		expect([dom.sidebar.mode, dom.inspector.mode]).toEqual(['inline', 'inline']);
		await expectDomMatches(page);
		await opened.context.close();
	});
});
