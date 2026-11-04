/**
 * The projects section and `project-summary` (phase 2 specification, 7.7 and 7.8; step 7): E9, which
 * closes here, E8's projects-section shape, E3's clauses that land in the section, and E12's captures of
 * the list and the home under axe. Tasks summarizes a project; three fixture apps answer late, throw, and
 * return what is over its bounds with markup in its text, each its own row while the rest stand.
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
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	focused,
	journal,
	kernelCall,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';

const HOSTILE_TITLE = '<img src=x onerror="document.title=1">';
const HOSTILE_LABEL = '<script>alert(1)</script>';

/** A packed native app with one summary command, whose handler's body is `body`. */
async function summaryApp(directory: string, id: string, order: number, body: string) {
	const manifest = {
		manifest_version: 2,
		protocol: 1,
		afd_contract: '1.0',
		plugin: {
			id,
			title: id[0]?.toUpperCase() + id.slice(1),
			version: '0.1.0',
			description: `A ${id} fixture for the project summary.`,
			kind: 'native',
			domains: [id],
			license: 'MIT',
		},
		native: { entry: 'native.js' },
		app: { scope_levels: ['project'] },
		commands: [
			{
				name: `${id}-summary`,
				title: 'Summarize',
				description: 'Summarize the project.',
				effects: ['inspect'],
				input_schema: { type: 'object', properties: {}, additionalProperties: false },
			},
		],
		ui: {
			project_summary: { command: `${id}-summary` },
			surfaces: {
				rail: { label: id[0]?.toUpperCase() + id.slice(1), icon: 'system/document', order },
			},
		},
	};
	const at = join(directory, id);
	await mkdir(at, { recursive: true });
	await writeFile(join(at, 'app-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	await writeFile(
		join(at, 'native.js'),
		`export default { sdk: 1, handlers: { '${id}-summary': async (input, context) => { ${body} } } };\n`
	);
	return at;
}

let browser: Browser;
let site: DeploymentSite;
let fixtures: string;

beforeAll(async () => {
	browser = await chromium.launch();
	fixtures = await mkdtemp(join(tmpdir(), 'loam-summaries-'));
	const slow = await summaryApp(fixtures, 'slow', 40, 'return new Promise(() => {});');
	const boom = await summaryApp(fixtures, 'boom', 50, "throw new Error('boom');");
	const wide = await summaryApp(
		fixtures,
		'wide',
		60,
		`return { success: true, data: {
			counts: [{ label: ${JSON.stringify(HOSTILE_LABEL)}, value: 1 }, ...Array.from({ length: 11 }, (_, i) => ({ label: 'C' + i, value: i }))],
			recent: [{ title: ${JSON.stringify(HOSTILE_TITLE)} }, { title: 'x'.repeat(121) }, { title: 'Far', updatedAt: 1e300 }],
			links: [{ label: 'Open tasks', link: { kind: 'app', instance: 'tasks', scope: context.scope } }],
		} };`
	);
	site = await serveDeployment({
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally')),
			deploymentEntry('tasks', await packApp('tasks')),
			deploymentEntry('slow', slow),
			deploymentEntry('boom', boom),
			deploymentEntry('wide', wide)
		),
	});
});
afterAll(async () => {
	await site?.close();
	await browser?.close();
	await rm(fixtures, { recursive: true, force: true });
});

/** The page's errors but the throwing fixture's own, which the kernel reports as an app's error. */
const appErrors = (opened: ShellPage) => opened.errors.filter((error) => error !== 'boom');

const section = (page: Page) => page.locator('loam-main loam-projects-section');
const heading = (page: Page) => section(page).locator('h1');

/** What `scope-get` and `section-get` say, unjournaled. */
const stateOf = (page: Page) =>
	page.evaluate(() =>
		(
			document.querySelector('loam-shell') as unknown as {
				readState(): Promise<{
					scope: { project?: string };
					project: { slug: string; name: string; status: string } | null;
					section: string | null;
					active: string | null;
				}>;
			}
		).readState()
	);

async function openProjects(): Promise<ShellPage> {
	const opened = await openShell(browser, site.root);
	await opened.page.locator('loam-rail loam-section-entry[section="projects"] button').click();
	await heading(opened.page).waitFor();
	await settle(opened.page);
	return opened;
}

/** Fill a field of the section's form: its native input, inside the field's shadow root. */
const fill = (page: Page, label: string, value: string) =>
	section(page)
		.locator('violet-text-field')
		.filter({ has: page.locator(`label:text-is("${label}")`) })
		.locator('input')
		.fill(value);

/** The focused element's tag, and its visible name: a kit control's is its host's text. */
const focusedName = (page: Page) =>
	page.evaluate(() => {
		let element: Element | null = document.activeElement;
		while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
		const root = element?.getRootNode();
		const host = root instanceof ShadowRoot ? root.host : null;
		const named = host?.localName.startsWith('violet-') ? host : element;
		return { tag: element?.localName ?? '', text: named?.textContent?.trim() ?? '' };
	});

async function create(page: Page, name: string, slug = ''): Promise<void> {
	// New project is a toggle, and an empty list opens the form itself (7.7).
	if ((await section(page).locator('form#create').count()) === 0) {
		await section(page).locator('violet-button', { hasText: 'New project' }).click();
	}
	await fill(page, 'Name', name);
	if (slug) await fill(page, 'Slug', slug);
	await section(page).locator('violet-button', { hasText: 'Create' }).click();
	await settle(page);
}

describe('P2-E9: the projects section', () => {
	it('P2-E9: creates from the form, shows a refused slug beside its field, renames keeping the URL, archives, refuses a change in it and restores', async () => {
		const opened = await openProjects();
		const { page } = opened;
		expect(new URL(page.url()).pathname).toBe('/personal/~/projects');
		expect(await page.title()).toBe('Projects · Personal');
		// Empty: "No projects yet", and main holds the section's one h1.
		expect(await section(page).locator('p.empty').textContent()).toBe('No projects yet');
		// With the form open (7.7), and focus left on the rail's Projects, which the person pressed (A3).
		expect(await section(page).locator('form#create').count()).toBe(1);
		expect((await focused(page)).hosts).toContain('loam-section-entry');
		// The landing's is hidden while the section shows.
		expect(await page.locator('loam-main h1:visible').count()).toBe(1);
		// The section declares main alone: every other part closed, its toggles disabled.
		const toggle = page.locator('loam-titlebar [data-toggle="sidebar"]');
		expect(await toggle.getAttribute('aria-disabled')).toBe('true');
		expect(await page.locator('loam-sidebar').isHidden()).toBe(true);

		await create(page, 'Atlas');
		// Its row takes focus once the list has it.
		await expect.poll(async () => (await focused(page)).label).toBe('Atlas');
		expect(await section(page).locator('tbody tr').count()).toBe(1);
		// A taken slug, beside its field, which takes focus; nothing created.
		await create(page, 'Another', 'atlas');
		const slug = section(page).locator('violet-text-field[invalid]');
		await expect.poll(() => slug.count()).toBe(1);
		expect(await slug.locator('[part="supporting-text"]').textContent()).toContain(
			"Error: A project already has the slug 'atlas'"
		);
		expect(await slug.locator('[part="label"]').textContent()).toBe('Slug');
		expect((await focused(page)).tag).toBe('input');
		const refused = (await journal(page)).at(-1);
		expect(refused).toMatchObject({ command: 'project-create', success: false });
		expect(refused?.error?.code).toBe('PROJECT_SLUG_TAKEN');
		await section(page).locator('violet-button', { hasText: 'Cancel' }).click();
		await expect.poll(async () => (await focusedName(page)).text).toBe('New project');

		// Each row links to the project's home, by the URL scheme.
		await section(page).locator('a', { hasText: 'Atlas' }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/p/atlas');
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await expect.poll(() => page.title()).toBe('Projects · Atlas · Personal');
		expect(await section(page).locator('.facts').textContent()).toContain(
			'Everyone in the workspace'
		);

		// Rename: the URL stays, as a slug is fixed; focus returns to Rename.
		await section(page).locator('violet-button', { hasText: 'Rename' }).click();
		await fill(page, 'Name', 'Atlas North');
		await page.keyboard.press('Enter');
		await expect.poll(() => heading(page).textContent()).toBe('Atlas North');
		expect(new URL(page.url()).pathname).toBe('/personal/p/atlas');
		await expect.poll(async () => (await focusedName(page)).text).toBe('Rename');

		// Archive: the active project, so the scope moves to the workspace and the list shows (4.3); its
		// heading takes focus. A change in it is refused.
		await section(page).locator('violet-button', { hasText: 'Archive' }).click();
		await expect.poll(async () => (await stateOf(page)).scope.project).toBeUndefined();
		await expect.poll(() => heading(page).textContent()).toBe('Projects');
		await expect.poll(async () => (await focused(page)).tag).toBe('h1');
		expect(await section(page).locator('tbody tr').count()).toBe(0);
		// Asked in the archived project, by an explicit scope: refused before the handler (3.4, line 6).
		const archived = (await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(n: string, i: unknown, o?: unknown): Promise<unknown> };
			};
			const atlas = (await shell.kernel.call('project-get', { project: 'atlas' })) as {
				data: { id: string };
			};
			return shell.kernel.call(
				'tasks-add',
				{ title: 'Late' },
				{ scope: { workspace: 'personal', project: atlas.data.id } }
			);
		})) as { error?: { code: string } };
		expect(archived.error?.code).toBe('PROJECT_ARCHIVED');

		// Restore, from its home: `Show archived` finds it.
		await section(page).locator('label.check input').check();
		await section(page).locator('a', { hasText: 'Atlas North' }).click();
		await expect.poll(() => heading(page).textContent()).toBe('Atlas North');
		expect(await section(page).locator('.facts').textContent()).toContain('Archived');
		await section(page).locator('violet-button', { hasText: 'Restore' }).click();
		await expect.poll(async () => (await stateOf(page)).project?.status).toBe('active');
		await expect.poll(async () => (await focusedName(page)).text).toBe('Archive');
		await expect
			.poll(() => section(page).locator('.said').textContent())
			.toBe('Atlas North restored');
		expect(appErrors(opened)).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it("P2-E9: the home shows tasks' counts and links that navigate; a summary that hangs, throws or is over its bounds is its own row, as text", async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'tasks-add', { title: 'Plan' });
		await kernelCall(page, 'tasks-add', { title: 'Review' });
		await kernelCall(page, 'tasks-complete', { task: 't-1' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		const cards = section(page).locator('.card');
		// In the rail's order; the slow one's deadline is two seconds.
		await expect
			.poll(() => cards.locator('h2').allTextContents(), { timeout: 10_000 })
			.toEqual(['Tasks', 'Slow', 'Boom', 'Wide'].map((title) => expect.stringContaining(title)));
		await expect
			.poll(() => section(page).locator('.cards').getAttribute('aria-busy'))
			.toBe('false');
		const card = (title: string) => cards.filter({ has: page.locator('h2', { hasText: title }) });
		const tasks = card('Tasks');
		// The home may have read before the last task: it reads again when main is asked for it.
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect
			.poll(() => tasks.locator('.counts').textContent(), { timeout: 10_000 })
			.toMatch(/Open\s*1\s*Done\s*1/);
		expect(await tasks.locator('.recent li').allTextContents()).toEqual([
			expect.stringContaining('Review'),
			expect.stringContaining('Plan'),
		]);
		expect(await card('Slow').locator('.failure').textContent()).toContain(
			'did not answer within 2 seconds'
		);
		expect(await card('Boom').locator('.failure').textContent()).toContain('Error:');
		const wide = card('Wide');
		// Over its bounds: eight counts kept, the long title dropped, and the row says so.
		expect(await wide.locator('.counts > div').count()).toBe(8);
		// A time no date holds is dropped by the kernel's reader, and the row still shows (T1).
		expect(await wide.locator('.recent li').count()).toBe(2);
		expect(await wide.locator('.recent li').nth(1).textContent()).toBe('Far');
		expect(await wide.locator('p.muted').textContent()).toMatch(
			/^\d+ entries of this summary could not be shown\.$/
		);
		// Markup an app returned is text: no element of it, and the title unchanged.
		expect(await wide.locator('.counts dt').first().textContent()).toBe(HOSTILE_LABEL);
		expect(await wide.locator('.recent li').first().textContent()).toContain(HOSTILE_TITLE);
		expect(await section(page).locator('img, script').count()).toBe(0);
		expect(await page.title()).not.toBe('1');

		// An app's link is navigation, never execution: it opens tasks in this project.
		await wide.locator('a', { hasText: 'Open tasks' }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe('/personal/p/atlas/tasks');
		await expect.poll(async () => (await stateOf(page)).active).toBe('tasks');
		await surfacesIdle(page);
		// Back to the home, and the card's own heading, the shell's link, opens tasks too.
		await page.goBack();
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await tasks.locator('h2 a').click();
		await expect.poll(async () => (await stateOf(page)).active).toBe('tasks');
		// The fixture that throws is reported as an app's error; nothing else is.
		expect(appErrors(opened)).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	}, 30_000);

	it('P2-E9: the summary replays from its record with every app handler stopped, whatever the deadline did', async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(() => section(page).locator('.card').count(), { timeout: 10_000 }).toBe(4);
		await settle(page);
		const entries = (await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return shell.journal.read();
		})) as JournalEntry[];
		await opened.context.close();
		const summaries = entries.filter((entry) => entry.command === 'project-summary-get');
		expect(summaries.length).toBeGreaterThan(0);
		// Every handler throws: a replay that ran one would diverge.
		const stopped = {
			sdk: 1,
			handlers: new Proxy({}, { get: () => () => Promise.reject(new Error('stopped')) }),
		};
		const manifestOf = async (directory: string) =>
			JSON.parse(await readFile(join(directory, 'app-manifest.json'), 'utf8')) as unknown;
		const packages = Object.fromEntries(
			await Promise.all(
				site.projection.apps.map(async (app) => {
					const directory =
						app.instance === 'hello' || app.instance === 'tally' || app.instance === 'tasks'
							? await packApp(app.instance)
							: join(fixtures, app.instance);
					return [app.package, { manifest: await manifestOf(directory), definition: stopped }];
				})
			)
		);
		const { report } = await replayKernel(entries, {
			environment: createFixedEnvironment(),
			deployment: site.projection,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		for (const entry of summaries) expect(report.recorded).toContain(entry.seq);
	}, 60_000);
});

describe('P2-E9: the reviews of step 7 (T1)', () => {
	it('T1: a row the shell cannot show is that row alone, and a read that throws says so rather than loading forever', async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await expect.poll(() => section(page).locator('.card').count(), { timeout: 10_000 }).toBe(4);
		// Answers the kernel would never give, past its reader: a time no `Date` holds, and a throw.
		const answer = (mode: 'time' | 'throw') =>
			page.evaluate(async (mode) => {
				const element = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main loam-projects-section') as unknown as {
					kernel: { call(name: string, input?: unknown): Promise<unknown> };
					read(): Promise<void>;
				};
				const real = element.kernel;
				element.kernel = {
					...real,
					call: async (name: string, input?: unknown) => {
						if (mode === 'throw' && name === 'project-list') throw new Error('broken');
						const result = (await real.call(name, input)) as {
							data?: { summaries?: Array<Record<string, unknown>> };
						};
						if (name === 'project-summary-get' && result.data?.summaries) {
							result.data.summaries = [
								{
									instance: 'tasks',
									title: 'Tasks',
									icon: 'system/checkmark',
									summary: { recent: [{ title: 'Far', updatedAt: 1e300 }] },
								},
								{
									instance: 'boom',
									title: 'Boom',
									icon: 'system/document',
									summary: { counts: [{ label: 'One', value: 1 }] },
								},
							];
						}
						return result;
					},
				};
				await element.read();
				element.kernel = real;
			}, mode);
		await answer('time');
		await expect.poll(() => section(page).locator('.card').count()).toBe(2);
		expect(await section(page).locator('.card .counts').textContent()).toContain('One');
		expect(await section(page).locator('.cards').getAttribute('aria-busy')).toBe('false');
		await answer('throw');
		await expect
			.poll(() => section(page).locator('p.failure[role="alert"]:visible').textContent())
			.toBe('The projects could not be read: broken');
		expect(await section(page).locator('.cards').getAttribute('aria-busy')).toBe('false');
		expect(await section(page).locator('p.muted', { hasText: 'Loading' }).count()).toBe(0);
		await opened.context.close();
	}, 30_000);
});

describe("P2-E8: the projects section's shape, under `/` and `/loam/`", () => {
	for (const basePath of ['/', '/loam/']) {
		it(`P2-E8: a deep link to the list and to a project's home shows each (${basePath})`, async () => {
			const served =
				basePath === '/'
					? site
					: await serveDeployment({
							config: deploymentFile(deploymentEntry('tasks', await packApp('tasks'))),
							basePath,
						});
			try {
				const opened = await openShell(browser, `${served.root}personal/~/projects`);
				const { page } = opened;
				await heading(page).waitFor();
				expect(await heading(page).textContent()).toBe('Projects');
				await kernelCall(page, 'project-create', { name: 'Beacon' });
				await settle(page);
				await expect.poll(() => section(page).locator('tbody tr').count()).toBe(1);
				expect(await section(page).locator('a', { hasText: 'Beacon' }).getAttribute('href')).toBe(
					`${served.root}personal/p/beacon`
				);
				// The same page: a second tab of this profile gets Loam's one-tab notice.
				await page.goto(`${served.root}personal/p/beacon`);
				await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
				await expect.poll(() => heading(page).textContent(), { timeout: 10_000 }).toBe('Beacon');
				expect(new URL(page.url()).pathname).toBe(`${basePath}personal/p/beacon`);
				expect(await page.locator('loam-main').getAttribute('route')).toBe('home');
				expect(opened.violations).toEqual([]);
				await opened.context.close();
			} finally {
				if (served !== site) await served.close();
			}
		});
	}
});

describe('P2-E12: the projects section under axe, in every theme and density, and under forced colors', () => {
	const THEMES = ['light', 'dark', 'high-contrast'] as const;
	const DENSITIES = ['comfortable', 'compact'] as const;

	it('P2-E12: the list with its form and a refusal, and a home with its cards, have no violation', async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await create(page, 'Again', 'atlas');
		await expect.poll(() => section(page).locator('violet-text-field[invalid]').count()).toBe(1);
		const check = async (where: string) => {
			for (const theme of THEMES) {
				for (const density of DENSITIES) {
					await kernelCall(page, 'appearance-set', { theme, density });
					await settle(page);
					expect(await axe(page), `${where} ${theme} ${density}`).toEqual([]);
				}
			}
		};
		await check('list');
		await page.emulateMedia({ forcedColors: 'active' });
		await settle(page);
		expect(await axe(page), 'list, forced colors').toEqual([]);
		await page.emulateMedia({ forcedColors: 'none' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(() => section(page).locator('.card').count(), { timeout: 10_000 }).toBe(4);
		await check('home');
		await page.emulateMedia({ forcedColors: 'active' });
		await settle(page);
		expect(await axe(page), 'home, forced colors').toEqual([]);
		await opened.context.close();
	}, 60_000);

	it('P2-E12: in the compact class, the home and the list have no violation', async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 390, height: 844 } });
		const { page } = opened;
		await kernelCall(page, 'section-open', { section: 'projects' });
		await heading(page).waitFor();
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await settle(page);
		expect(await axe(page), 'compact list').toEqual([]);
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await expect.poll(() => section(page).locator('.card').count(), { timeout: 10_000 }).toBe(4);
		expect(await axe(page), 'compact home').toEqual([]);
		await opened.context.close();
	}, 30_000);

	it('A2, A10: at 320 CSS px, text at its bounds, an empty summary and right-to-left text wrap in their cards, with no violation', async () => {
		const opened = await openShell(browser, site.root, { viewport: { width: 320, height: 800 } });
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await kernelCall(page, 'section-open', { section: 'projects' });
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await page.evaluate(async () => {
			const element = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main loam-projects-section') as unknown as {
				kernel: { call(name: string, input?: unknown): Promise<unknown> };
				read(): Promise<void>;
			};
			const real = element.kernel;
			element.kernel = {
				...real,
				call: async (name: string, input?: unknown) => {
					const result = (await real.call(name, input)) as {
						data?: { summaries?: unknown[]; project?: { id: string } };
					};
					if (name === 'project-summary-get' && result.data) {
						const scope = { workspace: 'personal', project: result.data.project?.id };
						result.data.summaries = [
							{
								instance: 'tasks',
								title: 'Tasks',
								icon: 'system/checkmark',
								summary: {
									counts: [{ label: 'L'.repeat(40), value: 1234567 }],
									recent: [{ title: 'T'.repeat(120), updatedAt: 1793700000000 }],
									links: [
										{ label: 'K'.repeat(40), link: { kind: 'app', instance: 'tasks', scope } },
									],
								},
							},
							{ instance: 'boom', title: 'Boom', icon: 'system/document', summary: {} },
							{
								instance: 'wide',
								title: 'دفتر',
								icon: 'system/document',
								summary: {
									counts: [{ label: 'مفتوح', value: 3 }],
									recent: [{ title: 'مراجعة الخطة' }],
								},
							},
						];
					}
					return result;
				},
			};
			await element.read();
		});
		await expect.poll(() => section(page).locator('.card').count()).toBe(3);
		const overflowing = await section(page)
			.locator('.card')
			.evaluateAll((cards) =>
				cards.flatMap((card) =>
					[card, ...card.querySelectorAll('*')]
						.filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
						.map((node) => `${node.localName}: ${node.scrollWidth} > ${node.clientWidth}`)
				)
			);
		expect(overflowing).toEqual([]);
		expect(await axe(page), '320 px home').toEqual([]);
		await opened.context.close();
	}, 30_000);
});

describe('the accessibility review of step 7 (A3 to A11)', () => {
	it('A4, A7, A8: create clears a filter that hides the row, a filter says its result, and an empty filter says why nothing shows', async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await section(page)
			.locator('violet-text-field', { hasText: '' })
			.filter({ has: page.locator('label:text-is("Filter")') })
			.locator('input')
			.fill('zzz');
		await expect
			.poll(() => section(page).locator('.said').textContent(), { timeout: 3_000 })
			.toBe('No project matches');
		await section(page)
			.locator('violet-text-field')
			.filter({ has: page.locator('label:text-is("Filter")') })
			.locator('input')
			.fill('atl');
		await expect
			.poll(() => section(page).locator('.said').textContent(), { timeout: 3_000 })
			.toBe('1 of 1 projects');
		await section(page)
			.locator('violet-text-field')
			.filter({ has: page.locator('label:text-is("Filter")') })
			.locator('input')
			.fill('zzz');
		// A new project the filter would hide: the filter clears, and its row takes focus.
		await create(page, 'Beacon');
		await expect.poll(async () => (await focused(page)).label).toBe('Beacon');
		expect(await section(page).locator('tbody tr').count()).toBe(2);
		// Every project archived, with no filter: the list says why it shows none.
		for (const slug of ['atlas', 'beacon'])
			await kernelCall(page, 'project-archive', { project: slug });
		await expect
			.poll(() => section(page).locator('p.empty').textContent())
			.toBe('No active projects. Show archived to see 2.');
		await opened.context.close();
	}, 30_000);

	it('A5, Escape and the toggle: a refused archive says why beside the actions, and Escape or a second press closes a form', async () => {
		const opened = await openProjects();
		const { page } = opened;
		await create(page, 'Atlas');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		await expect.poll(() => heading(page).textContent()).toBe('Atlas');
		await section(page).locator('violet-button', { hasText: 'Rename' }).click();
		await expect.poll(() => section(page).locator('form#rename').count()).toBe(1);
		await page.keyboard.press('Escape');
		await expect.poll(() => section(page).locator('form#rename').count()).toBe(0);
		await expect.poll(async () => (await focusedName(page)).text).toBe('Rename');
		await section(page).locator('violet-button', { hasText: 'Rename' }).click();
		await section(page).locator('violet-button', { hasText: 'Rename' }).click();
		await expect.poll(() => section(page).locator('form#rename').count()).toBe(0);
		// A refusal the kernel would give, answered here, as no person can provoke one for their own project.
		await page.evaluate(() => {
			const element = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main loam-projects-section') as unknown as {
				kernel: { call(name: string, input?: unknown): Promise<unknown> };
			};
			const real = element.kernel;
			element.kernel = {
				...real,
				call: async (name: string, input?: unknown) =>
					name === 'project-archive'
						? {
								success: false,
								error: {
									code: 'OVERLAY_MODAL_BUSY',
									message: 'A dialog is open',
									suggestion: 'Close it first',
								},
							}
						: real.call(name, input),
			};
		});
		await section(page).locator('violet-button', { hasText: 'Archive' }).click();
		const alert = section(page).locator('.action-error');
		await expect.poll(() => alert.textContent()).toBe('Error: A dialog is open. Close it first.');
		expect(await alert.getAttribute('role')).toBe('alert');
		expect(await alert.isVisible()).toBe(true);
		await opened.context.close();
	}, 30_000);

	it('A11: a sections chunk that fails to load says so in main, not "Choose an app"', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await page.route(/\/assets\/sections-[^/]+\.js$/, (route) => route.abort());
		await page.locator('loam-rail loam-section-entry[section="projects"] button').click();
		await expect
			.poll(() => page.locator('loam-main h1:visible').textContent())
			.toBe('Could not load. Reload to try again.');
		await opened.context.close();
	}, 30_000);
});
