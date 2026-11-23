import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../fixtures/serve-static.js';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { climbObservation } from './climb.js';
import { parsePointer } from './pointer.js';

const TOOLBAR_MODULE = `
if (!customElements.get('violet-icon')) {
	class VioletIcon extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<svg width="16" height="16" viewBox="0 0 16 16" style="display:block"><path d="M2 2h12v12H2z" fill="currentColor"></path></svg>';
		}
	}
	customElements.define('violet-icon', VioletIcon);
}

if (!customElements.get('example-button')) {
	class ExampleButton extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' });
		}
		connectedCallback() {
			const label = this.getAttribute('label') || '';
			this.shadowRoot.innerHTML =
				'<button type="button" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px">' +
				'<violet-icon aria-hidden="true"></violet-icon>' +
				'<span>' + label + '</span>' +
				'</button>';
			const button = this.shadowRoot.querySelector('button');
			button.addEventListener('click', () => {
				this.dataset.clicks = String(Number(this.dataset.clicks || '0') + 1);
			});
		}
	}
	customElements.define('example-button', ExampleButton);
}

if (!customElements.get('example-toolbar')) {
	class ExampleToolbar extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<div role="toolbar" aria-label="Actions" style="display:flex;gap:12px;padding:12px">' +
				'<input type="search" aria-label="Search" placeholder="Search" />' +
				'<example-button label="Share"></example-button>' +
				'<example-button label="Export"></example-button>' +
				'</div>';
		}
	}
	customElements.define('example-toolbar', ExampleToolbar);
}

export const Toolbar = {
	render() {
		return document.createElement('example-toolbar');
	},
	targets: {
		share: { role: 'button', name: 'Share' },
	},
	scenario: [{ action: { click: 'share' } }],
};

if (!customElements.get('x-split')) {
	class XSplit extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<button type="button" style="padding:8px 12px"><slot name="primary"></slot></button>' +
				'<button type="button" style="padding:8px 12px">Secondary</button>';
		}
	}
	customElements.define('x-split', XSplit);
}

if (!customElements.get('x-panel')) {
	class XPanel extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<p>Description</p><button type="button" style="padding:8px 12px">Save</button>';
		}
	}
	customElements.define('x-panel', XPanel);
}

if (!customElements.get('x-hidden-sib')) {
	class XHiddenSib extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<button type="button" hidden>Hidden</button>' +
				'<button type="button" style="padding:8px 12px">Visible</button>';
		}
	}
	customElements.define('x-hidden-sib', XHiddenSib);
}

if (!customElements.get('x-labelled')) {
	class XLabelled extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<span id="lbl" aria-hidden="true">Hidden label</span>' +
				'<button type="button" aria-labelledby="lbl" style="padding:8px 12px"></button>';
		}
	}
	customElements.define('x-labelled', XLabelled);
}

export const EdgeCases = {
	render() {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'display:grid;gap:12px;padding:12px';

		const split = document.createElement('x-split');
		const slotted = document.createElement('span');
		slotted.slot = 'primary';
		slotted.textContent = 'Primary';
		split.append(slotted);

		const disabled = document.createElement('button');
		disabled.type = 'button';
		disabled.disabled = true;
		disabled.style.cssText = 'padding:12px 24px';
		disabled.textContent = 'Locked';

		wrap.append(
			split,
			document.createElement('x-panel'),
			document.createElement('x-hidden-sib'),
			document.createElement('x-labelled'),
			disabled
		);
		return wrap;
	},
};
`;

async function settledFrame(page: Page): Promise<Frame> {
	const handle = await page.waitForSelector('iframe');
	const frame = await handle.contentFrame();
	if (!frame) throw new Error('No preview frame');
	await frame.waitForSelector('html[data-specimen-preview], #specimen-page-error', {
		state: 'attached',
	});
	return frame;
}

describe('review page Pick mode and shared climb agreement', () => {
	let root: string;
	let outDir: string;
	let bench: SpecimenBench;
	let server: Awaited<ReturnType<typeof serveStatic>>;
	let browser: Browser;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-pick-')));
		outDir = join(root, 'dist-static');
		await writeFile(join(root, 'toolbar.js'), TOOLBAR_MODULE);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{
						id: 'example-toolbar',
						title: 'Components / Toolbar',
						module: './toolbar.js',
						exportName: 'Toolbar',
						component: 'example-toolbar',
					},
					{
						id: 'pick-edge-cases',
						title: 'Components / Edge cases',
						module: './toolbar.js',
						exportName: 'EdgeCases',
					},
				],
			})
		);
		bench = await createSpecimenBench({ root });
		await bench.build(outDir);
		server = await serveStatic(outDir);
		browser = await chromium.launch({ headless: true });
	}, 120_000);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
		await bench?.close();
		if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
	});

	it('covers first click, click inside, click outside, modifier-click, Escape, Copy pointer and writes nothing', async () => {
		const context = await browser.newContext({
			permissions: ['clipboard-read', 'clipboard-write'],
		});
		const page = await context.newPage();
		const writes: string[] = [];
		page.on('request', (request) => {
			if (request.method() !== 'GET' && request.method() !== 'HEAD') {
				writes.push(`${request.method()} ${request.url()}`);
			}
		});

		await page.goto(`${server.url}/specimen.html?id=example-toolbar&theme=dark&viewport=800x400`);
		const frame = await settledFrame(page);

		const pickToggle = page.getByRole('button', { name: 'Pick' });
		const panel = page.locator('#specimen-pick-panel');
		const pointerEl = page.locator('#specimen-pick-pointer');
		const outlineEl = page.locator('#specimen-pick-outline');
		const copyButton = page.getByRole('button', { name: 'Copy pointer' });

		expect(await pickToggle.getAttribute('aria-pressed')).toBe('false');
		expect(await panel.isVisible()).toBe(false);

		// Enable Pick mode.
		await pickToggle.click();
		expect(await pickToggle.getAttribute('aria-pressed')).toBe('true');
		expect(await panel.isVisible()).toBe(true);
		expect(await copyButton.isDisabled()).toBe(true);

		// 1. First click on the decorative <svg> inside <violet-icon> inside Share's <button>.
		const shareSvg = frame.locator('example-button[label="Share"] svg');
		await shareSvg.click();

		// Must not trigger the specimen button's click handler while picking.
		const shareClicks = await frame
			.locator('example-button[label="Share"]')
			.evaluate((el) => (el as HTMLElement).dataset.clicks ?? '0');
		expect(shareClicks).toBe('0');

		// Two-step climb selects example-button:1, outlines it, shows breadcrumb and pointer.
		const firstRaw = (await pointerEl.textContent()) ?? '';
		const firstParsed = parsePointer(firstRaw);
		expect(firstParsed.specimen).toBe('example-toolbar');
		expect(firstParsed.context).toEqual({ theme: 'dark', viewport: '800x400' });
		expect(firstParsed.ref).toBe('root/example-toolbar:1/shadow/div:1/example-button:1');
		expect(firstParsed.text).toBe('Share');
		expect(firstParsed.depth).toBeUndefined();
		expect(firstParsed.pin.x).toBeGreaterThanOrEqual(0);
		expect(firstParsed.pin.x).toBeLessThanOrEqual(1);
		expect(firstParsed.pin.y).toBeGreaterThanOrEqual(0);
		expect(firstParsed.pin.y).toBeLessThanOrEqual(1);

		expect(await outlineEl.isVisible()).toBe(true);
		const crumbsText = await page.locator('.specimen-pick-path').textContent();
		expect(crumbsText).toContain('Actions');
		expect(crumbsText).toContain('Share');

		// 2. Click inside the current selection steps one level deeper: example-button:1 -> button:1.
		await shareSvg.click();
		const deeper1 = parsePointer((await pointerEl.textContent()) ?? '');
		expect(deeper1.ref).toBe(
			'root/example-toolbar:1/shadow/div:1/example-button:1/shadow/button:1'
		);
		expect(deeper1.depth).toBe('deepest');

		// Click inside again steps deeper: button:1 -> violet-icon:1.
		await shareSvg.click();
		const deeper2 = parsePointer((await pointerEl.textContent()) ?? '');
		expect(deeper2.ref).toBe(
			'root/example-toolbar:1/shadow/div:1/example-button:1/shadow/button:1/violet-icon:1'
		);
		expect(deeper2.depth).toBe('deepest');

		// 3. Escape selects the parent step-by-step back up to the specimen root.
		await page.keyboard.press('Escape');
		expect(parsePointer((await pointerEl.textContent()) ?? '').ref).toBe(
			'root/example-toolbar:1/shadow/div:1/example-button:1/shadow/button:1'
		);

		await page.keyboard.press('Escape');
		const backToButton = parsePointer((await pointerEl.textContent()) ?? '');
		expect(backToButton.ref).toBe('root/example-toolbar:1/shadow/div:1/example-button:1');
		expect(backToButton.depth).toBeUndefined();

		// 4. Click outside the current selection (Export button, sibling of Share) starts fresh.
		const exportButton = frame.locator('example-button[label="Export"] button');
		await exportButton.click();
		const exportParsed = parsePointer((await pointerEl.textContent()) ?? '');
		expect(exportParsed.ref).toBe('root/example-toolbar:1/shadow/div:1/example-button:2');
		expect(exportParsed.text).toBe('Export');
		expect(exportParsed.depth).toBeUndefined();

		// Escape all the way up to the specimen root, and confirm another Escape stays at the root.
		await page.keyboard.press('Escape');
		expect(parsePointer((await pointerEl.textContent()) ?? '').ref).toBe(
			'root/example-toolbar:1/shadow/div:1'
		);

		await page.keyboard.press('Escape');
		expect(parsePointer((await pointerEl.textContent()) ?? '').ref).toBe('root/example-toolbar:1');

		await page.keyboard.press('Escape');
		expect(parsePointer((await pointerEl.textContent()) ?? '').ref).toBe('root/example-toolbar:1');

		// 5. Modifier click (Alt-click) skips climb and picks the deepest hit directly.
		const sharePath = frame.locator('example-button[label="Share"] path');
		await sharePath.click({ modifiers: ['Alt'] });
		const modifierParsed = parsePointer((await pointerEl.textContent()) ?? '');
		expect(modifierParsed.ref).toBe(
			'root/example-toolbar:1/shadow/div:1/example-button:1/shadow/button:1/violet-icon:1/shadow/svg:1/path:1'
		);
		expect(modifierParsed.depth).toBe('deepest');

		// 6. Breadcrumb button jumps selection directly to an ancestor and restores keyboard focus.
		const actionsCrumb = page
			.locator('.specimen-pick-path')
			.getByRole('button', { name: 'Actions' })
			.nth(1);
		await actionsCrumb.click();
		expect(parsePointer((await pointerEl.textContent()) ?? '').ref).toBe(
			'root/example-toolbar:1/shadow/div:1'
		);
		const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
		expect(focusedText).toBe('Actions');

		// 7. Re-select deepest path and test Copy pointer; page writes nothing to the server.
		await sharePath.click({ modifiers: ['Alt'] });
		await copyButton.click();
		await expect
			.poll(() => page.locator('.specimen-pick-status').textContent())
			.toBe('Pointer copied');
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toBe(await pointerEl.textContent());
		expect(parsePointer(copied)).toEqual(modifierParsed);
		expect(writes).toEqual([]);

		// 8. Turning Pick mode off restores normal clicks inside the specimen.
		await pickToggle.click();
		expect(await pickToggle.getAttribute('aria-pressed')).toBe('false');
		expect(await outlineEl.isVisible()).toBe(false);
		await frame.locator('example-button[label="Share"] button').click();
		const afterToggleClicks = await frame
			.locator('example-button[label="Share"]')
			.evaluate((el) => (el as HTMLElement).dataset.clicks ?? '0');
		expect(afterToggleClicks).toBe('1');

		await context.close();
	});

	it('agrees between clicking the decorative icon or inner button and resolving { role, name } on the native host', async () => {
		// Render with the native host to get real Chromium CDP accessibility roles/names AND verify
		// `{ role: 'button', name: 'Share' }` resolves to the inner <button>.
		const observation = await bench.render({
			id: 'example-toolbar',
			checkpoint: 'after-run',
			context: { theme: 'dark', viewport: { width: 800, height: 400 } },
		});
		const innerShareButton = observation.channels.elements.find(
			(el) => el.accessibility?.role === 'button' && el.accessibility?.name === 'Share'
		);
		if (!innerShareButton) throw new Error('Expected inner Share button in observation');
		expect(innerShareButton.tag).toBe('button');

		const fromNamedTarget = climbObservation(observation.channels.elements, innerShareButton.ref);
		expect(fromNamedTarget).not.toBeNull();
		expect(fromNamedTarget?.element.tag).toBe('example-button');
		expect(fromNamedTarget?.accessible?.role).toBe('button');
		expect(fromNamedTarget?.accessible?.name).toBe('Share');

		// Now click both the decorative icon and the inner <button> in the static review page.
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(`${server.url}/specimen.html?id=example-toolbar&theme=dark&viewport=800x400`);
		const frame = await settledFrame(page);
		await page.getByRole('button', { name: 'Pick' }).click();

		// Click decorative SVG icon inside Share button.
		await frame.locator('example-button[label="Share"] svg').click();
		const iconClick = parsePointer(
			(await page.locator('#specimen-pick-pointer').textContent()) ?? ''
		);
		expect(iconClick.ref).toBe(fromNamedTarget?.element.ref);

		// Reset selection by clicking outside, then click the inner <button> label text directly.
		await frame.locator('example-button[label="Export"] button').click();
		await frame.locator('example-button[label="Share"] span').click();
		const buttonClick = parsePointer(
			(await page.locator('#specimen-pick-pointer').textContent()) ?? ''
		);
		expect(buttonClick.ref).toBe(fromNamedTarget?.element.ref);

		await context.close();
	});

	it('agrees with native host on slotted content, sibling paragraphs, hidden siblings, aria-labelledby on aria-hidden, disabled controls, and unrendered checkpoints', async () => {
		const observation = await bench.render({
			id: 'pick-edge-cases',
			context: { theme: 'light', viewport: { width: 800, height: 600 } },
		});
		const findAccessible = (role: string, name: string) => {
			const hit = observation.channels.elements.find(
				(el) => el.accessibility?.role === role && el.accessibility?.name === name
			);
			if (!hit) throw new Error(`Missing { role: ${role}, name: ${name} } in native observation`);
			const climbed = climbObservation(observation.channels.elements, hit.ref);
			if (!climbed) throw new Error(`climbObservation failed for ${hit.ref}`);
			return climbed;
		};

		const nativePrimary = findAccessible('button', 'Primary');
		const nativeSave = findAccessible('button', 'Save');
		const nativeVisible = findAccessible('button', 'Visible');
		const nativeLabelled = findAccessible('button', 'Hidden label');

		expect(nativePrimary.element.tag).toBe('button');
		expect(nativeSave.element.tag).toBe('button');
		expect(nativeVisible.element.tag).toBe('x-hidden-sib');
		expect(nativeLabelled.element.tag).toBe('x-labelled');
		expect(nativeLabelled.accessible?.name).toBe('Hidden label');

		const context = await browser.newContext();
		const page = await context.newPage();
		// Request an unsupported checkpoint on a native specimen: preview renders mount and shows notice.
		await page.goto(
			`${server.url}/specimen.html?id=pick-edge-cases&theme=light&viewport=800x600&checkpoint=after-run`
		);
		const frame = await settledFrame(page);
		expect(await page.locator('#specimen-page-checkpoint-notice').isVisible()).toBe(true);
		await page.getByRole('button', { name: 'Pick' }).click();
		const pointerEl = page.locator('#specimen-pick-pointer');

		// 1. Slotted light-DOM span inside two-button x-split selects the shadow button (not x-split)
		// and omits unrendered checkpoint=after-run.
		await frame.locator('x-split span[slot="primary"]').click();
		const primaryPick = parsePointer((await pointerEl.textContent()) ?? '');
		expect(primaryPick.ref).toBe(nativePrimary.element.ref);
		expect(primaryPick.checkpoint).toBeUndefined();

		// 2. Shadow sibling <p> keeps Save button from climbing to x-panel.
		await frame.locator('x-panel button').click();
		const savePick = parsePointer((await pointerEl.textContent()) ?? '');
		expect(savePick.ref).toBe(nativeSave.element.ref);

		// 3. Hidden sibling <button hidden> does not block Visible button from climbing to x-hidden-sib.
		await frame.locator('x-hidden-sib button:not([hidden])').click();
		const visiblePick = parsePointer((await pointerEl.textContent()) ?? '');
		expect(visiblePick.ref).toBe(nativeVisible.element.ref);

		// 4. aria-labelledby referencing aria-hidden="true" label retains its accessible name.
		await frame.locator('x-labelled button').click();
		const labelledPick = parsePointer((await pointerEl.textContent()) ?? '');
		expect(labelledPick.ref).toBe(nativeLabelled.element.ref);
		expect(labelledPick.text).toBe('Hidden label');

		// 5. Disabled native button can still be picked by clicking its padding/box.
		const disabledBox = await frame.locator('button[disabled]').boundingBox();
		if (!disabledBox) throw new Error('Missing disabled button box');
		await page.mouse.click(disabledBox.x + 6, disabledBox.y + 6);
		const disabledPick = parsePointer((await pointerEl.textContent()) ?? '');
		expect(disabledPick.ref).toBe('root/div:1/button:1');
		expect(disabledPick.text).toBe('Locked');

		await context.close();
	});

	it('passes axe-core in Pick mode across light and dark themes', async () => {
		const axe = await readFile(
			createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
			'utf8'
		);
		for (const theme of ['light', 'dark']) {
			const context = await browser.newContext();
			const page = await context.newPage();
			await page.goto(`${server.url}/specimen.html?id=example-toolbar&theme=${theme}`);
			const frame = await settledFrame(page);
			await page.getByRole('button', { name: 'Pick' }).click();
			await frame.locator('example-button[label="Share"] svg').click();
			await page.addScriptTag({ content: axe });
			const violations = await page.evaluate(async () => {
				const run = await (
					window as unknown as {
						axe: {
							run(context: unknown): Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
						};
					}
				).axe.run({ exclude: [['iframe']] });
				return run.violations.map((v) => `${v.id} (${v.nodes.length})`);
			});
			expect(violations, theme).toEqual([]);
			await context.close();
		}
	});
});
