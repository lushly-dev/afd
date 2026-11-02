/**
 * E10 (phase 1 specification, section 14): the console is every new app's first UI. `loam app new`,
 * `loam app pack`, Vite's API and a deployment, in a temporary directory, with a real CSP. Results are
 * untrusted, so a hostile one in every field the adapter reads must render as text.
 */
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScaffold } from '../bundle';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	journal,
	loam,
	openApp,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';

const XSS = `<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>`;

/** With no break opportunity, as a snake_case tool name or a pattern is. */
const LONG = 'Averylongunbrokenname'.repeat(3);

/** Commands the scaffold does not have, added the way an author would: to its manifest and its module. */
const PROBE_COMMANDS = `
[[commands]]
name = "probe-form"
title = "Fill the form"
description = "Echoes its input. ${XSS.replaceAll('"', "'")}"
category = "probe"
effects = ["inspect"]
input_schema = "schemas/probe-form.input.json"

[[commands]]
name = "probe-change"
title = "Change something"
description = "Reports that it changes data."
category = "probe"
effects = ["plugin-state"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-destroy"
title = "Destroy something"
description = "Reports that it destroys data."
category = "probe"
effects = ["plugin-state"]
destructive = true
input_schema = { type = "object", properties = { reason = { type = "string" } }, additionalProperties = false }

[[commands]]
name = "probe-fail"
title = "Fail"
description = "Fails with a code and a suggestion."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-hostile"
title = "Hostile"
description = "Answers with markup in every field the adapter reads."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-hostile-failure"
title = "Hostile failure"
description = "Fails with markup in every field of its error."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-unreadable"
title = "Unreadable"
description = "Answers with warnings the adapter cannot read."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-labeled"
title = "Labeled"
description = "Answers as a mounted server's result does."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "probe-long"
title = "${LONG}"
description = "${LONG}"
category = "probe"
effects = ["inspect"]
input_schema = "schemas/probe-long.input.json"

[[commands]]
name = "probe-slow"
title = "Slow"
description = "Answers after a moment."
category = "probe"
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
`;

const PROBE_FORM_SCHEMA = {
	type: 'object',
	properties: {
		name: { type: 'string', title: 'Name', description: 'Who to greet', minLength: 2 },
		note: { type: 'string', maxLength: 500 },
		tone: { type: 'string', enum: ['warm', 'cold'] },
		loud: { type: 'boolean', description: 'In capitals' },
		count: { type: 'integer', minimum: 1 },
		offset: { type: 'number' },
		tags: { type: 'array', items: { type: 'string' } },
		extra: { type: 'object' },
	},
	required: ['name'],
	additionalProperties: false,
};

const PROBE_SOURCE = `import { defineApp, failure, success } from '@lushly-dev/loam-sdk';

const XSS = ${JSON.stringify(XSS)};

export default defineApp({
	sdk: 1,
	handlers: {
		'probe-ping': async () => success({ pong: true }),
		'probe-form': async (input) => success(input),
		'probe-change': async () => success({ changed: true }),
		'probe-destroy': async () => success({ destroyed: true }),
		'probe-fail': async () =>
			failure({ code: 'PROBE_REFUSED', message: 'It refused', suggestion: 'Ask it again nicely' }),
		'probe-hostile': async () => ({
			success: true,
			data: { [XSS]: XSS, packages: [{ name: XSS, passed: false, stdout: XSS, stderr: XSS }], total: XSS, passed: XSS, failed: XSS },
			confidence: 0.5,
			reasoning: XSS,
			warnings: [{ code: XSS, message: XSS }],
			metadata: { 'dev.loam/trust': 'untrusted', 'dev.loam/instance': XSS, 'dev.umbel/trust': XSS },
		}),
		'probe-hostile-failure': async () =>
			failure({ code: XSS, message: XSS, suggestion: XSS, details: { [XSS]: XSS } }),
		'probe-unreadable': async () => ({ success: true, data: 1, warnings: [null] }),
		'probe-labeled': async () => ({
			success: true,
			data: { answer: 42 },
			metadata: {
				'dev.loam/trust': 'untrusted',
				'dev.loam/instance': 'work',
				'dev.loam/replay': 'recorded',
				'dev.umbel/trust': 'content',
			},
		}),
		'probe-long': async () => failure({ code: 'PROBE_LONG', message: '${LONG}' }),
		'probe-slow': async () => {
			await new Promise((done) => setTimeout(done, 400));
			return success({ slow: true });
		},
	},
});
`;

let browser: Browser;
let site: DeploymentSite;
let root: string;

/** `loam app new`, then Vite's API, then `loam app pack`, in a temporary directory. */
async function scaffolded(id: string, edit?: (directory: string) => Promise<void>) {
	const directory = join(root, id);
	const created = await loam(['app', 'new', id, '--kind', 'native', '--dir', directory], root);
	expect(created.ok, JSON.stringify(created.output)).toBe(true);
	await edit?.(directory);
	await buildScaffold(directory);
	const packed = await loam(['app', 'pack', directory, '--out', join(directory, 'package')], root);
	expect(packed.ok, JSON.stringify(packed.output)).toBe(true);
	return join(directory, 'package');
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'loam-console-'));
	const demo = await scaffolded('demo');
	const probe = await scaffolded('probe', async (directory) => {
		await appendFile(join(directory, 'loam-app.toml'), PROBE_COMMANDS);
		await writeFile(
			join(directory, 'schemas/probe-form.input.json'),
			JSON.stringify(PROBE_FORM_SCHEMA)
		);
		await writeFile(
			join(directory, 'schemas/probe-long.input.json'),
			JSON.stringify({
				type: 'object',
				properties: { value: { type: 'string', title: LONG, description: LONG, pattern: LONG } },
			})
		);
		await writeFile(join(directory, 'src/app.ts'), PROBE_SOURCE);
	});
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('demo', demo),
			deploymentEntry('probe', probe),
			deploymentEntry('hello', await packApp('hello'))
		),
	});
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await site?.close();
	if (root) await rm(root, { recursive: true, force: true });
});

/** Section 14: every scenario fails on a CSP violation, and on an error nothing provoked. */
async function closeClean(opened: ShellPage) {
	expect(opened.violations).toEqual([]);
	expect(opened.errors).toEqual([]);
	await opened.context.close();
}

const journalCount = async (page: Page, command: string) =>
	(await journal(page)).filter((entry) => entry.command === command).length;

const row = (page: Page, name: string) =>
	page.locator(`loam-console violet-option[value="${name}"]`);

async function choose(page: Page, name: string) {
	await row(page, name).click();
	await page.locator(`loam-console violet-option[value="${name}"][selected]`).waitFor();
	await settle(page);
}

const run = (page: Page) => page.locator('loam-console violet-button.run').click();

const resultStatus = (page: Page) => page.locator('loam-console .result-status');

const output = (page: Page) => page.locator('loam-console .output');

/** What injected markup would leave behind, inside the console's shadow root and on the page. */
const injection = (page: Page) =>
	page.evaluate(() => {
		const root = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main')
			?.querySelector('loam-mount')
			?.shadowRoot?.querySelector('loam-console')?.shadowRoot as ShadowRoot;
		const tags = new Set(
			[...(root.querySelector('.output')?.querySelectorAll('*') ?? [])].map(
				(node) => node.localName
			)
		);
		return {
			pwned: (window as unknown as { pwned?: unknown }).pwned,
			images: root.querySelectorAll('img').length,
			scripts: root.querySelectorAll('script').length,
			styled: root.querySelectorAll('[style]').length,
			tags: [...tags].sort(),
		};
	});

describe('E10: the console is every new app first UI', () => {
	it('shows a new app with its command, and the form runs it', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'demo');
		await page.locator('loam-console').waitFor();
		expect(await page.locator('loam-console h1').textContent()).toBe('Demo');
		expect(await page.locator('loam-console .stack > .group p').first().textContent()).toContain(
			'Trusted, not sandboxed'
		);
		expect(await row(page, 'demo-ping').textContent()).toContain('Ping Demo');
		expect(await page.locator('loam-console .no-input').isVisible()).toBe(true);
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toBe('demo-ping succeeded');
		expect(await output(page).textContent()).toContain('"pong": true');
		await settle(page);
		const entry = (await journal(page)).findLast(({ command }) => command === 'demo-ping');
		expect(entry?.input).toEqual({});
		expect(entry?.success).toBe(true);
		expect(entry?.interface).toBe('palette');
		await closeClean(opened);
	});

	it("runs a form's input through every control, leaving out what is empty and optional", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-form');
		const form = page.locator('loam-console form');
		expect(await page.locator('loam-console .no-input').isVisible()).toBe(false);
		// A schema's text is text.
		expect(await page.locator('loam-console .command-description').textContent()).toContain('<img');
		expect((await injection(page)).images).toBe(0);
		await form.locator('input').first().fill('Ada');
		await form.locator('violet-text-area').nth(0).locator('textarea').fill('A note');
		await form.locator('violet-select button').click();
		await form.locator('violet-select violet-option', { hasText: 'cold' }).click();
		await form.locator('violet-checkbox').click();
		await form.locator('violet-text-field').nth(1).locator('input').fill('3');
		await form.locator('violet-text-area').nth(1).locator('textarea').fill('a\n\nb');
		await form.locator('violet-text-area').nth(2).locator('textarea').fill('{"nested":[1]}');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-form succeeded');
		await settle(page);
		const entry = (await journal(page)).findLast(({ command }) => command === 'probe-form');
		expect(entry?.input).toEqual({
			name: 'Ada',
			note: 'A note',
			tone: 'cold',
			loud: true,
			count: 3,
			tags: ['a', 'b'],
			extra: { nested: [1] },
		});

		// An optional select goes back to None, and what is empty and optional stays out of the input.
		await form.locator('violet-select button').click();
		await form.locator('violet-select violet-option', { hasText: 'None' }).click();
		await expect.poll(() => form.locator('violet-select button').textContent()).toContain('None');
		await form.locator('violet-text-area').nth(0).locator('textarea').fill('');
		await form.locator('violet-text-field').nth(1).locator('input').fill('');
		await form.locator('violet-text-area').nth(1).locator('textarea').fill('');
		await form.locator('violet-text-area').nth(2).locator('textarea').fill('');
		await run(page);
		await expect.poll(() => journalCount(page, 'probe-form')).toBe(2);
		await settle(page);
		expect(
			(await journal(page)).findLast(({ command }) => command === 'probe-form')?.input
		).toEqual({
			name: 'Ada',
			loud: true,
		});
		await closeClean(opened);
	});

	it('refuses inline, before the call, and takes focus to the first field to fix', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-form');
		const before = (await journal(page)).filter(({ command }) => command === 'probe-form').length;
		await run(page);
		await expect
			.poll(() => resultStatus(page).textContent())
			.toBe('probe-form did not run: 1 field needs attention.');
		const name = page.locator('loam-console form violet-text-field').first();
		expect(await name.locator('input').getAttribute('aria-invalid')).toBe('true');
		expect(await name.locator('.supporting').textContent()).toBe(
			'Error: This field is required. Who to greet At least 2 characters.'
		);
		expect((await focused(page)).tag).toBe('input');

		// The JSON row refuses invalid JSON inline, and an integer a fraction.
		await name.locator('input').fill('Ada');
		const count = page.locator('loam-console form violet-text-field').nth(1);
		await count.locator('input').fill('1.5');
		await page
			.locator('loam-console form violet-text-area')
			.nth(2)
			.locator('textarea')
			.fill('{nope');
		await run(page);
		await expect
			.poll(() => resultStatus(page).textContent())
			.toBe('probe-form did not run: 2 fields need attention.');
		expect(
			await page
				.locator('loam-console form violet-text-field')
				.nth(1)
				.locator('.supporting')
				.textContent()
		).toBe('Error: Enter a whole number. A whole number. 1 or more.');
		expect(
			await page
				.locator('loam-console form violet-text-area')
				.nth(2)
				.locator('.supporting')
				.textContent()
		).toBe('Error: Enter valid JSON.');
		// The first error went with the edit, and each of these goes with its own.
		await expect.poll(() => name.locator('input').getAttribute('aria-invalid')).toBe('false');
		await count.locator('input').fill('2');
		await expect
			.poll(() =>
				page
					.locator('loam-console form violet-text-field')
					.nth(1)
					.locator('input')
					.getAttribute('aria-invalid')
			)
			.toBe('false');
		await page.locator('loam-console form violet-text-area').nth(2).locator('textarea').fill('');
		await expect.poll(() => resultStatus(page).textContent()).toBe('');

		// What a number field cannot read is refused, and typing keeps what was typed: type="number" would not.
		await count.locator('input').fill('');
		await count.locator('input').pressSequentially('1e');
		expect(await count.locator('input').inputValue()).toBe('1e');
		await run(page);
		await expect
			.poll(() => count.locator('.supporting').textContent())
			.toBe('Error: Enter a number. A whole number. 1 or more.');
		await count.locator('input').fill('');
		await settle(page);
		expect((await journal(page)).filter(({ command }) => command === 'probe-form').length).toBe(
			before
		);
		await closeClean(opened);
	});

	it('sends a typed negative number and an exponent as they read', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-form');
		const form = page.locator('loam-console form');
		await form.locator('input').first().fill('Ada');
		const offset = form.locator('violet-text-field').nth(2).locator('input');
		await offset.pressSequentially('-2');
		await run(page);
		await expect.poll(() => journalCount(page, 'probe-form')).toBe(1);
		await offset.fill('');
		await offset.pressSequentially('1e3');
		await run(page);
		await expect.poll(() => journalCount(page, 'probe-form')).toBe(2);
		const entries = (await journal(page)).filter(({ command }) => command === 'probe-form');
		expect(entries.map(({ input }) => (input as { offset: number }).offset)).toEqual([-2, 1000]);
		await closeClean(opened);
	});

	it('shows a failing command with its code and suggestion, in tokens, with no style attribute', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-fail');
		await run(page);
		await expect
			.poll(() => resultStatus(page).textContent())
			.toBe('probe-fail failed: PROBE_REFUSED. It refused. Ask it again nicely');
		const text = await output(page).textContent();
		expect(text).toContain('[PROBE_REFUSED] It refused');
		expect(text).toContain('Suggestion: Ask it again nicely');
		const seen = await page
			.locator('loam-console .output span')
			.first()
			.evaluate((span) => {
				const style = getComputedStyle(span);
				// The tokens as this page resolves them, through CSSOM, which style-src does not refuse.
				const probe = document.createElement('i');
				probe.style.setProperty('color', 'var(--color-state-danger-text)');
				probe.style.setProperty('font-weight', 'var(--weight-semibold)');
				document.body.append(probe);
				const token = getComputedStyle(probe);
				const expected = { color: token.color, weight: token.fontWeight };
				probe.remove();
				return {
					className: span.className,
					weight: style.fontWeight,
					color: style.color,
					expected,
					style: span.getAttribute('style'),
				};
			});
		expect(seen.className).toBe('afd-status-failure afd-bold');
		// Step 0b's gap: the bold span keeps its weight, from a token.
		expect(seen.weight).toBe(seen.expected.weight);
		expect(Number(seen.weight)).toBeGreaterThanOrEqual(600);
		expect(seen.color).toBe(seen.expected.color);
		expect(seen.style).toBeNull();
		expect((await injection(page)).styled).toBe(0);
		await closeClean(opened);
	});

	it('labels a result as untrusted and recorded, beside its journal entry', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-labeled');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-labeled succeeded');
		const labels = await page.locator('loam-console .labels li').allTextContents();
		expect(labels.slice(0, 2)).toEqual(['Untrusted: from work', 'Recorded, not replayable']);
		expect(labels[2]).toMatch(/^Journal entry \d+$/);
		expect(labels[3]).toBe('dev.umbel/trust: content');
		await closeClean(opened);
	});
});

describe('E10: results are untrusted', () => {
	for (const command of ['probe-hostile', 'probe-hostile-failure'])
		it(`renders ${command} as text, with no markup, script or style from it`, async () => {
			const opened = await openShell(browser, site.origin);
			const { page } = opened;
			await openApp(page, 'probe');
			await choose(page, command);
			await run(page);
			await expect.poll(() => resultStatus(page).textContent()).toContain(command);
			await settle(page);
			expect(await output(page).textContent()).toContain('<img src=x');
			const seen = await injection(page);
			expect(seen.pwned).toBeUndefined();
			expect(seen.images).toBe(0);
			expect(seen.scripts).toBe(0);
			expect(seen.styled).toBe(0);
			for (const tag of seen.tags) expect(['br', 'pre', 'span']).toContain(tag);
			// Nothing was even requested: an image that parsed would have asked for `x`.
			expect(site.log.filter(({ path }) => path.endsWith('/x'))).toEqual([]);
			await closeClean(opened);
		});

	it('says so, and the shell goes on, when a result is a shape the adapter cannot read', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-unreadable');
		await run(page);
		await expect
			.poll(() => output(page).textContent())
			.toBe('This result is not a CommandResult, so it cannot be shown.');
		await choose(page, 'probe-labeled');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-labeled succeeded');
		expect(opened.errors).toEqual([]);
		await closeClean(opened);
	});
});

describe('E10: the CSP', () => {
	it("has teeth: a style attribute is refused on this page, and the adapter's classes are not", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-fail');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toContain('probe-fail failed');
		await settle(page);
		expect(opened.violations).toEqual([]);
		await page.evaluate(() => {
			const span = document.createElement('div');
			span.innerHTML = '<span style="color: red">refused</span>';
			document.body.append(span);
			span.remove();
		});
		await expect.poll(() => opened.violations.length).toBeGreaterThan(0);
		expect(opened.violations.join()).toContain('style-src');
		await opened.context.close();
	});
});

describe('E10: its chunk', () => {
	it('loads nothing until a console renders', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const consoleRequests = () => site.log.filter(({ path }) => /\/console-/.test(path));
		const before = consoleRequests().length;
		await openApp(page, 'hello');
		await page.locator('hello-main').waitFor();
		await surfacesIdle(page);
		expect(consoleRequests().length).toBe(before);
		await openApp(page, 'demo');
		await page.locator('loam-console').waitFor();
		expect(consoleRequests().length).toBeGreaterThan(before);
		await closeClean(opened);
	});

	it('explains itself, and the shell goes on, when the chunk cannot load', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await page.route(/\/assets\/console-/, (route) => route.abort());
		await openApp(page, 'demo');
		const notice = page.locator('loam-main loam-notice');
		await notice.waitFor();
		expect(await notice.textContent()).not.toBeNull();
		expect(await notice.locator('p').first().textContent()).toContain('The console could not load');
		await openApp(page, 'hello');
		await page.locator('hello-main').waitFor();
		// The blocked chunk is an error it provokes on purpose; the CSP is not.
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});

describe('E11: the console by keyboard', () => {
	it('goes filter, list, form, Run, and Enter in a single-line field runs', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		const filter = page.locator('loam-console violet-text-field.filter input');
		await filter.focus();
		await page.keyboard.type('form');
		await expect.poll(() => page.locator('loam-console violet-option').count()).toBe(1);
		expect(await page.locator('loam-console .filter-status').textContent()).toBe(
			'1 of 11 commands'
		);
		await page.keyboard.press('Tab');
		expect((await focused(page)).role).toBe('listbox');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.locator('loam-console #console-command').textContent())
			.toBe('Fill the form');
		await page.keyboard.press('Tab');
		expect((await focused(page)).label).toContain('Name (required)');
		await page.keyboard.type('Ada');
		await page.keyboard.press('Enter');
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-form succeeded');
		// Focus stays where Enter was pressed.
		expect((await focused(page)).label).toContain('Name (required)');
		// On through every field, to Run, by Tab alone. The select takes one stop.
		for (let field = 0; field < 8; field++) await page.keyboard.press('Tab');
		expect((await focused(page)).hosts).toContain('violet-button');
		await page.keyboard.press('Enter');
		await expect.poll(() => journalCount(page, 'probe-form')).toBe(2);
		await closeClean(opened);
	});

	it('disables Run and shows the spinner while it runs, and gives focus back after', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-slow');
		const button = page.locator('loam-console violet-button.run button');
		await button.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => button.isDisabled()).toBe(true);
		expect(await page.locator('loam-console form violet-spinner').isVisible()).toBe(true);
		expect(await resultStatus(page).textContent()).toBe('Running probe-slow…');
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-slow succeeded');
		expect(await button.isDisabled()).toBe(false);
		expect(await page.locator('loam-console form violet-spinner').isVisible()).toBe(false);
		await expect.poll(async () => (await focused(page)).hosts).toContain('violet-button');

		// Taken back only if it went nowhere: a person who moved on is not pulled back.
		await page.keyboard.press('Enter');
		await expect.poll(() => button.isDisabled()).toBe(true);
		const filter = page.locator('loam-console violet-text-field.filter input');
		await filter.focus();
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-slow succeeded');
		await page.waitForTimeout(50);
		expect((await focused(page)).hosts).toContain('violet-text-field');
		await closeClean(opened);
	});

	it('clears a result when the command changes, and says how a call that was left ended', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-fail');
		await run(page);
		await expect.poll(() => output(page).textContent()).toContain('PROBE_REFUSED');
		await choose(page, 'probe-labeled');
		expect(await output(page).textContent()).toBe('');
		expect(await resultStatus(page).textContent()).toBe('');
		expect(await page.locator('loam-console .labels li').count()).toBe(0);
		await choose(page, 'probe-slow');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toBe('Running probe-slow…');
		await choose(page, 'probe-labeled');
		await expect.poll(() => resultStatus(page).textContent()).toBe('probe-slow succeeded');
		expect(await output(page).textContent()).toBe('');
		await closeClean(opened);
	});

	it('keeps the selection right through a filter of the same length, and Enter still works', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-fail');
		const filter = page.locator('loam-console violet-text-field.filter input');
		await filter.fill('probe-fail');
		await expect.poll(() => page.locator('loam-console violet-option').count()).toBe(1);
		// One row replaced by another, so nothing about the count changes.
		await filter.fill('probe-slow');
		await expect.poll(() => row(page, 'probe-slow').count()).toBe(1);
		await settle(page);
		expect(await row(page, 'probe-slow').getAttribute('selected')).toBeNull();
		await page.locator('loam-console violet-listbox [role="listbox"]').focus();
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.locator('loam-console #console-command').textContent())
			.toBe('Slow');
		await closeClean(opened);
	});

	it('runs a destructive command only from Run, flags it beside Run, and never on a held key', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-destroy');
		expect(await page.locator('loam-console .command-flag').textContent()).toContain('Destructive');
		expect(await page.locator('loam-console violet-button.run').getAttribute('appearance')).toBe(
			'danger'
		);
		const reason = page.locator('loam-console form input');
		await reason.fill('Tidying');
		await reason.press('Enter');
		await expect
			.poll(() => resultStatus(page).textContent())
			.toBe('This command is destructive: press Run to run it.');
		await settle(page);
		expect(await journalCount(page, 'probe-destroy')).toBe(0);
		await run(page);
		await expect.poll(() => journalCount(page, 'probe-destroy')).toBe(1);

		// A held Enter runs once.
		await choose(page, 'probe-form');
		await page.locator('loam-console form input').first().fill('Ada');
		await page.keyboard.down('Enter');
		await expect.poll(() => journalCount(page, 'probe-form')).toBe(1);
		await page.keyboard.down('Enter');
		await page.keyboard.down('Enter');
		await page.keyboard.up('Enter');
		await settle(page);
		expect(await journalCount(page, 'probe-form')).toBe(1);
		await closeClean(opened);
	});

	it('ties help to a checkbox, and marks the active row of an open select', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-form');
		const described = await page
			.locator('loam-console form violet-checkbox input')
			.evaluate((input) =>
				(input as HTMLInputElement).ariaDescribedByElements?.map((node) => node.textContent)
			);
		expect(described).toEqual(['In capitals']);
		const select = page.locator('loam-console form violet-select');
		await select.locator('button').click();
		await select.locator('.panel').waitFor();
		await page.keyboard.press('ArrowDown');
		await expect
			.poll(() => select.locator('violet-option[data-active]').textContent())
			.toBe('warm');
		await page.keyboard.press('Escape');
		await closeClean(opened);
	});

	it('reflows at 320 CSS pixels, with text that has no break in it', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 320, height: 800 },
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await page.locator('loam-tabbar loam-app-entry[instance="probe"] button').click();
		await page.locator('loam-console').waitFor();
		await surfacesIdle(page);
		await choose(page, 'probe-long');
		await page.locator('loam-console form input').fill('x');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toContain('did not run');
		await page.locator('loam-console form input').fill('');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toContain('PROBE_LONG');
		await settle(page);
		const overflow = await page.locator('loam-mount').evaluate((mount) => ({
			scroll: mount.scrollWidth,
			client: mount.clientWidth,
		}));
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
		await closeClean(opened);
	});

	it('flags what changes data and what destroys it, and says when nothing matches', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		// A row past the list's fold takes one press, even with the active row scrolled away.
		await page.locator('loam-console violet-listbox').evaluate((listbox) => {
			(listbox as HTMLElement).style.setProperty('--violet-listbox-max-block-size', '6rem');
		});
		await choose(page, 'probe-slow');
		await row(page, 'probe-ping').scrollIntoViewIfNeeded();
		await choose(page, 'probe-ping');
		expect(await row(page, 'probe-change').textContent()).toContain('Changes data');
		expect(await row(page, 'probe-destroy').textContent()).toContain('Destructive');
		expect(await row(page, 'probe-fail').textContent()).not.toContain('Changes data');
		await page.locator('loam-console violet-text-field.filter input').fill('nothing like this');
		await expect
			.poll(() => page.locator('loam-console .filter-status').textContent())
			.toBe('No command matches "nothing like this".');
		await closeClean(opened);
	});

	it("opens the select's list where the select is, inside the mount", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'probe');
		await choose(page, 'probe-form');
		const select = page.locator('loam-console form violet-select');
		await select.locator('button').click();
		const panel = select.locator('.panel');
		await panel.waitFor();
		const trigger = await select.locator('button').boundingBox();
		const box = await panel.boundingBox();
		expect(Math.abs((box?.x ?? 0) - (trigger?.x ?? 0))).toBeLessThan(8);
		expect(Math.abs((box?.y ?? 0) - ((trigger?.y ?? 0) + (trigger?.height ?? 0)))).toBeLessThan(8);
		await closeClean(opened);
	});
});

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

/** Every state the console's axe runs hold: a form with an error, flags in the list, a failure, a success. */
async function consoleWithEverything(page: Page) {
	await openApp(page, 'probe');
	await choose(page, 'probe-form');
	await run(page);
	await expect.poll(() => resultStatus(page).textContent()).toContain('did not run');
	await surfacesIdle(page);
}

describe('E11: axe with the console', () => {
	for (const theme of THEMES)
		for (const density of DENSITIES)
			it(`has no violations in ${theme}, ${density}`, async () => {
				const opened = await openShell(browser, site.origin, {
					viewport: { width: 1600, height: 900 },
					reducedMotion: 'reduce',
				});
				const { page } = opened;
				await agentCall(page, 'appearance-set', { theme, density });
				await consoleWithEverything(page);
				expect(await axe(page)).toEqual([]);
				await choose(page, 'probe-fail');
				await run(page);
				await expect.poll(() => resultStatus(page).textContent()).toContain('failed');
				await surfacesIdle(page);
				expect(await axe(page)).toEqual([]);
				await choose(page, 'probe-hostile');
				await run(page);
				await expect.poll(() => resultStatus(page).textContent()).toContain('succeeded');
				await surfacesIdle(page);
				expect(await axe(page)).toEqual([]);
				await closeClean(opened);
			});

	it('has no violations under forced colors', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1600, height: 900 },
			forcedColors: 'active',
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await consoleWithEverything(page);
		expect(await axe(page)).toEqual([]);
		await choose(page, 'probe-fail');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toContain('failed');
		await surfacesIdle(page);
		expect(await axe(page)).toEqual([]);
		await closeClean(opened);
	});

	it('has no violations in the compact class', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 390, height: 844 },
			reducedMotion: 'reduce',
		});
		const { page } = opened;
		await page.locator('loam-tabbar loam-app-entry[instance="probe"] button').click();
		await page.locator('loam-console').waitFor();
		await surfacesIdle(page);
		await page.waitForFunction(() => {
			const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
			return !main?.hasAttribute('aria-busy');
		});
		await choose(page, 'probe-form');
		await run(page);
		await expect.poll(() => resultStatus(page).textContent()).toContain('did not run');
		await surfacesIdle(page);
		expect(await axe(page)).toEqual([]);
		await closeClean(opened);
	});
});

describe('E11: the console for a mounted instance', () => {
	let mounted: DeploymentSite;
	beforeAll(async () => {
		const directory = join(root, 'ops');
		const created = await loam(
			['app', 'new', 'ops', '--kind', 'mounted', '--dir', directory],
			root
		);
		expect(created.ok, JSON.stringify(created.output)).toBe(true);
		const packed = await loam(
			['app', 'pack', directory, '--out', join(directory, 'package')],
			root
		);
		expect(packed.ok, JSON.stringify(packed.output)).toBe(true);
		mounted = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('ops', join(directory, 'package'), {
					audience: 'team',
					transport: 'http',
					url: 'http://127.0.0.1:1/mcp',
				})
			),
		});
	}, 60_000);
	afterAll(async () => {
		await mounted?.close();
	});

	it("shows a failed instance's error, D55's notice, its state, and a Refresh button", async () => {
		const opened = await openShell(browser, mounted.origin, { reducedMotion: 'reduce' });
		const { page } = opened;
		await openApp(page, 'ops');
		await page.locator('loam-console').waitFor();
		await page.locator('loam-console .instance').waitFor();
		await page.locator('loam-console [role="alert"]').waitFor();
		const text = await page.locator('loam-console .stack').textContent();
		expect(text).toContain('External: its results are labeled untrusted');
		expect(text).toContain("Umbel sees one principal for every member of this instance's projects");
		const alert = page.locator('loam-console [role="alert"]');
		expect(await alert.textContent()).toContain('MOUNT_UNREACHABLE');
		expect(text).toContain('http');
		expect(text).toContain('failed');
		await page.locator('loam-console violet-button.refresh').click();
		// Seen and heard, though a failed instance has no command and so no result section.
		const refreshStatus = page.locator('loam-console .refresh-status');
		await expect.poll(() => refreshStatus.textContent()).toBe('Refresh failed: MOUNT_UNREACHABLE');
		expect(await refreshStatus.isVisible()).toBe(true);
		expect((await journal(page)).some(({ command }) => command === 'app-instance-refresh')).toBe(
			true
		);
		await surfacesIdle(page);
		expect(await axe(page)).toEqual([]);
		// This deployment has no relay, so discovery's requests are the browser's own 404s to report.
		opened.errors = opened.errors.filter((error) => !error.startsWith('Failed to load resource'));
		await closeClean(opened);
	});
});

describe('E10: a view app with no main surface', () => {
	it("shows the console too, and a person's call reaches the handler frame", async () => {
		const directory = join(root, 'plain');
		const created = await loam(['app', 'new', 'plain', '--kind', 'view', '--dir', directory], root);
		expect(created.ok, JSON.stringify(created.output)).toBe(true);
		await buildScaffold(directory, 'view');
		const packed = await loam(
			['app', 'pack', directory, '--out', join(directory, 'package')],
			root
		);
		expect(packed.ok, JSON.stringify(packed.output)).toBe(true);
		const viewSite = await serveDeployment({
			config: deploymentFile(deploymentEntry('plain', join(directory, 'package'))),
			sandbox: true,
		});
		try {
			const opened = await openShell(browser, viewSite.origin);
			const { page } = opened;
			await openApp(page, 'plain');
			await page.locator('loam-console').waitFor();
			expect(await page.locator('loam-console .stack > .group p').first().textContent()).toContain(
				'Sandboxed'
			);
			expect(await row(page, 'plain-ping').textContent()).toContain('Ping Plain');
			await run(page);
			await expect.poll(() => resultStatus(page).textContent()).toBe('plain-ping succeeded');
			expect(await output(page).textContent()).toContain('"pong": true');
			await settle(page);
			const entry = (await journal(page)).findLast(({ command }) => command === 'plain-ping');
			expect(entry?.success).toBe(true);
			await closeClean(opened);
		} finally {
			await viewSite.close();
		}
	}, 60_000);
});
