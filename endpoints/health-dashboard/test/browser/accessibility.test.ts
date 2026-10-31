import { pathToFileURL } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { axe, DIST, fixturePath, loadFiles, open } from './harness';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
});

async function fresh(colorScheme: 'light' | 'dark' = 'light') {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
	return { context, ...(await open(context, pathToFileURL(DIST).href)) };
}

/** Describes the deepest focused element, through shadow roots. */
const focused = (page: Page) =>
	page.evaluate(() => {
		let element: Element | null = document.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		const root = element?.getRootNode();
		const host = root instanceof ShadowRoot ? root.host : null;
		const style = element ? getComputedStyle(element) : null;
		return {
			tag: element?.tagName.toLowerCase() ?? '',
			host: host?.tagName.toLowerCase() ?? '',
			hostClass: host?.className ?? '',
			className: typeof element?.className === 'string' ? element.className : '',
			indicator: style
				? (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
					style.boxShadow !== 'none'
				: false,
		};
	});

/** Open a focused violet-select with Enter, wait for its list to take focus, then press keys. */
async function choose(page: Page, selectClass: string, keys: string[]) {
	await page.keyboard.press('Enter');
	await page.waitForFunction(
		(name) =>
			document
				.querySelector(`violet-select.${name}`)
				?.shadowRoot?.activeElement?.getAttribute('role') === 'listbox',
		selectClass
	);
	for (const key of keys) await page.keyboard.press(key);
}

async function tabTo(page: Page, match: (f: Awaited<ReturnType<typeof focused>>) => boolean) {
	for (let step = 0; step < 40; step++) {
		await page.keyboard.press('Tab');
		const current = await focused(page);
		if (match(current)) return current;
	}
	throw new Error('Focus never reached the expected control');
}

describe('accessibility (axe-core, WCAG 2.2 AA)', () => {
	it.each(['light', 'dark'] as const)('has no violations when empty (%s)', async (scheme) => {
		const { context, page } = await fresh(scheme);
		expect(await axe(page)).toEqual([]);
		await context.close();
	});

	it.each(['light', 'dark'] as const)(
		'has no violations with every status, a failure list and a no-match filter (%s)',
		async (scheme) => {
			const { context, page } = await fresh(scheme);
			await loadFiles(page, [
				fixturePath('reports/mixed-status.report.json'),
				fixturePath('reports/empty-plan.report.json'),
				fixturePath('invalid/schema-violation.json'),
			]);
			expect(await axe(page)).toEqual([]);
			await page.evaluate(() => {
				const view = (
					document.querySelector('health-dashboard') as unknown as {
						reports: { setStatus(v: string): void; setTarget(v: string): void }[];
					}
				).reports[0];
				view?.setStatus('error');
				view?.setTarget('web-app');
			});
			await page.waitForSelector('.no-match');
			expect(await axe(page)).toEqual([]);
			await context.close();
		}
	);

	it('uses landmarks, headings and semantic tables', async () => {
		const { context, page } = await fresh();
		await loadFiles(page, [fixturePath('reports/mixed-status.report.json')]);
		const structure = await page.evaluate(() => ({
			banner: document.querySelectorAll('header.banner').length,
			main: document.querySelectorAll('main').length,
			contentinfo: document.querySelectorAll('footer').length,
			h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()),
			columnHeaders: [...document.querySelectorAll('table.checks thead th[scope="col"]')].map(
				(th) => th.textContent?.trim()
			),
			rowHeaders: document.querySelectorAll('table.checks tbody th[scope="row"]').length,
		}));
		expect(structure).toEqual({
			banner: 1,
			main: 1,
			contentinfo: 1,
			h1: ['Health reports'],
			columnHeaders: [
				'Status',
				'Check',
				'Target',
				'Severity',
				'Message',
				'Evidence',
				'Remediation',
			],
			rowHeaders: 21,
		});
		await context.close();
	});
});

describe('keyboard', () => {
	it('opens the file picker from the keyboard with visible focus', async () => {
		const { context, page } = await fresh();
		const browse = await tabTo(
			page,
			(f) => f.host === 'violet-button' || f.tag === 'violet-button'
		);
		expect(browse.indicator).toBe(true);
		const chooser = page.waitForEvent('filechooser');
		await page.keyboard.press('Enter');
		const picker = await chooser;
		expect(picker.isMultiple()).toBe(true);
		await picker.setFiles(fixturePath('reports/mixed-status.report.json'));
		await page.waitForSelector('section.report');
		await context.close();
	});

	it('filters and sorts the checks table, then reaches the table, by keyboard only', async () => {
		const { context, page } = await fresh();
		await loadFiles(page, [fixturePath('reports/mixed-status.report.json')]);
		const status = await tabTo(
			page,
			(f) => f.host === 'violet-select' && f.hostClass.includes('filter-status')
		);
		expect(status.indicator).toBe(true);
		// Open the list, move from "All statuses" past "Passed" to "Failed", choose it.
		await choose(page, 'filter-status', ['Home', 'ArrowDown', 'ArrowDown', 'Enter']);
		await page.waitForFunction(() =>
			[...document.querySelectorAll('table.checks tbody tr')].every(
				(row) => row.getAttribute('data-status') === 'failed'
			)
		);
		await expect(page.locator('table.checks tbody tr').count()).resolves.toBe(8);
		await expect(page.locator('.row-count').innerText()).resolves.toBe(
			'Showing 8 of 21 check results'
		);

		await tabTo(page, (f) => f.host === 'violet-select' && f.hostClass.includes('sort'));
		await choose(page, 'sort', ['End', 'Enter']);
		await page.waitForFunction(
			() => document.querySelector('table.checks th[aria-sort]')?.textContent?.trim() === 'Target'
		);
		const targets = await page
			.locator('table.checks tbody tr')
			.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-target')));
		expect(targets).toEqual([...(targets as string[])].sort());

		const region = await tabTo(
			page,
			(f) => f.className.includes('table-scroll') && f.tag === 'div'
		);
		expect(region.indicator).toBe(true);
		await context.close();
	});
});

describe('content security policy', () => {
	it('blocks injected inline code, so the policy is live', async () => {
		const { context, page, cspViolations } = await fresh();
		await page.evaluate(() => {
			const style = document.createElement('style');
			style.textContent = 'body { color: red; }';
			document.head.append(style);
		});
		await page.waitForFunction(() => true);
		await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
		expect(cspViolations[0]).toContain('style-src');
		await context.close();
	});
});
