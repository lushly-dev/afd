/**
 * References, embeds and view editors (documents specification, 5.6, 9 and 10; step 12): D1's second half,
 * two notes that link to each other and show backlinks in their inspectors, restored after a reload; D9's
 * embeds, a note in a note, re-checked at render, stopped at a depth of three and at a cycle, and read-only
 * in a real frame; and D5's view half, the `sheet` fixture's editor in a sandboxed frame.
 */

import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import { sheetPackage } from './sheet';
import { createNote, editorIdle, editorView, entriesOf, open, replayDifferences } from './support';

let browser: Browser;
/** Hello and notes, whose journal a replay runs with their real handlers. */
let site: DeploymentSite;
/** The same with the `sheet` fixture, a view, on a second origin. */
let viewSite: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	const hello = deploymentEntry('hello', await packApp('hello'));
	const notes = deploymentEntry('notes', await packApp('notes'));
	site = await serveDeployment({ config: deploymentFile(hello, notes) });
	viewSite = await serveDeployment({
		sandbox: true,
		config: deploymentFile(hello, notes, deploymentEntry('sheet', await sheetPackage())),
	});
}, 120_000);

afterAll(async () => {
	await site?.close();
	await viewSite?.close();
	await browser?.close();
});

/** What the page's kernel announces from now on, each event's command and whether it succeeded. */
async function heard(
	page: Page
): Promise<() => Promise<Array<{ command: string; success: boolean }>>> {
	await page.evaluate(() => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { subscribe(listener: (event: { command: string; success: boolean }) => void): void };
		};
		const events: Array<{ command: string; success: boolean }> = [];
		(window as unknown as { heard: typeof events }).heard = events;
		shell.kernel.subscribe(({ command, success }) => events.push({ command, success }));
	});
	return () =>
		page.evaluate(
			() => (window as unknown as { heard: Array<{ command: string; success: boolean }> }).heard
		);
}

/** The rows the active tab's inspector shows, by section. */
function inspectorRows(page: Page): Promise<{ links: string[]; backlinks: string[] } | null> {
	return page.evaluate(() => {
		const part = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-inspector');
		const inspector = part
			?.querySelector('loam-mount')
			?.shadowRoot?.querySelector('notes-inspector') as HTMLElement | null | undefined;
		if (!inspector?.shadowRoot) return null;
		const rows = (label: string) =>
			[...(inspector.shadowRoot?.querySelectorAll(`section[aria-label="${label}"] li`) ?? [])].map(
				(row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? ''
			);
		return { links: rows('Links'), backlinks: rows('Backlinks') };
	});
}

/** Insert a link to the document titled `title` in the note of `tab`, by its picker, as a person does. */
async function insertLink(page: Page, tab: string, title: string): Promise<void> {
	const frame = page.locator(`loam-editor-frame[data-tab="${tab}"]`);
	await frame.locator('textarea').click();
	await page.keyboard.press('End');
	await frame.locator('violet-button.link').click();
	await frame.locator('.filter input').fill(title);
	await frame.locator('violet-button.choice', { hasText: title }).first().click();
}

/** The out links the index holds for `document`, as the person reads them. */
const linksOf = async (page: Page, document: string) =>
	(
		(await kernelCall(page, 'document-link-list', { document })) as {
			data?: { out: Array<{ link: { to: string; kind: string } }>; in: unknown[] };
		}
	).data;

describe('P2-D1: two notes that link to each other, with backlinks, restored after a reload', () => {
	it('P2-D1: links two notes side by side, shows each in the other’s Links and Backlinks, and restores the tabs, the URL and the inspector’s rows after a reload with the editor chunk held', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		const alpha = await createNote(page, 'Alpha');
		const beta = await createNote(page, 'Beta');
		await open(page, alpha);
		await open(page, beta, { group: 'beside' });
		await kernelCall(page, 'layout-set', { inspector: { open: true } });
		let view = await editorView(page);
		expect(view?.map((group) => group.tabs.find((tab) => tab.selected)?.title)).toEqual([
			'Alpha',
			'Beta',
		]);
		const [alphaTab, betaTab] = (view ?? []).map(
			(group) => group.editors.find((each) => !each.hidden)?.tab as string
		);
		// In A, `Insert link` to B, saved; in B, a link to A.
		await page.locator('loam-editor-group').first().locator('[role="tab"]').first().click();
		await editorIdle(page);
		await insertLink(page, alphaTab as string, 'Beta');
		await page.keyboard.press('ControlOrMeta+s');
		await expect
			.poll(async () => (await linksOf(page, alpha))?.out.map((row) => row.link.to))
			.toEqual([beta]);
		await page.locator('loam-editor-group').nth(1).locator('[role="tab"]').first().click();
		await editorIdle(page);
		await insertLink(page, betaTab as string, 'Alpha');
		await page.keyboard.press('ControlOrMeta+s');
		await expect
			.poll(async () => (await linksOf(page, beta))?.out.map((row) => row.link.to))
			.toEqual([alpha]);
		// B's inspector, with B's tab active: A under both.
		await expect
			.poll(() => inspectorRows(page))
			.toEqual({ links: ['Alpha'], backlinks: ['Alpha'] });
		// A's, once its tab is active again.
		await page.locator('loam-editor-group').first().locator('[role="tab"]').first().click();
		await editorIdle(page);
		await expect.poll(() => inspectorRows(page)).toEqual({ links: ['Beta'], backlinks: ['Beta'] });
		const url = new URL(page.url()).pathname;
		expect(url).toBe(`/personal/~/documents/${alpha}`);
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		const before = (await entriesOf(page)).length;

		site.hold(/\/assets\/editor-/);
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.waitForFunction(
			() =>
				document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-main')
					?.getAttribute('aria-busy') === 'true'
		);
		site.release();
		await expect
			.poll(async () =>
				(await editorView(page))?.map((group) => group.tabs.find((tab) => tab.selected)?.title)
			)
			.toEqual(['Alpha', 'Beta']);
		await editorIdle(page);
		view = await editorView(page);
		expect(view?.map((group) => group.label)).toEqual(['Documents, group 1', 'Documents, group 2']);
		expect(new URL(page.url()).pathname).toBe(url);
		await expect.poll(() => inspectorRows(page)).toEqual({ links: ['Beta'], backlinks: ['Beta'] });
		// The restore journaled no `document-open`; every entry carries its scope; a replay differs nowhere.
		const entries = await entriesOf(page);
		expect(entries.slice(before).some((entry) => entry.command === 'document-open')).toBe(false);
		for (const entry of entries.filter((each) => each.command.startsWith('document-link-')))
			expect((entry.context as { scope?: unknown }).scope).toEqual({ workspace: 'personal' });
		expect(entries.filter((entry) => entry.command === 'document-link-add').length).toBe(2);
		expect(await replayDifferences(site, entries)).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);
});

/** The sandbox's inner frame of the view editor that shows `title`. */
async function sheetFrame(page: Page, title: string): Promise<Frame> {
	let found: Frame | undefined;
	await expect
		.poll(async () => {
			for (const frame of page.frames()) {
				const shown = await frame
					.evaluate(() => {
						const held = (
							window as unknown as { sheet?: { ready?: boolean; document?: { title?: string } } }
						).sheet;
						return held?.ready ? held.document?.title : undefined;
					})
					.catch(() => undefined);
				if (shown === title) {
					found = frame;
					return true;
				}
			}
			return false;
		})
		.toBe(true);
	return found as Frame;
}

const sheetOf = (frame: Frame) =>
	frame.evaluate(() => (window as unknown as { sheet: Record<string, unknown> }).sheet);

/** A tab's unsaved mark, as the kernel keeps it. */
const marked = async (page: Page, tab: string) =>
	(
		(await kernelCall(page, 'editor-get')) as {
			data?: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> };
		}
	).data?.groups
		.flatMap((group) => group.tabs)
		.find((each) => each.id === tab)?.dirty;

describe('P2-D5: a view’s editor', () => {
	it('P2-D5: opens a view type’s document in a real sandboxed frame, marks it unsaved on an edit, saves and tears it down when its tab hides, and rebuilds it when shown', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const events = await heard(page);
		const created = (await kernelCall(page, 'document-create', {
			type: 'sheet',
			title: 'Plan',
		})) as {
			data: { id: string };
		};
		const sheet = created.data.id;
		const note = await createNote(page, 'Note');
		await open(page, sheet);
		let frame = await sheetFrame(page, 'Plan');
		expect(await sheetOf(frame)).toMatchObject({
			role: 'editor',
			document: { id: sheet, type: 'sheet', readOnly: false, scope: { workspace: 'personal' } },
		});
		// The editor is in the deep DOM as a view frame, sandboxed on the second origin.
		const origin = await page.evaluate(() => {
			const view = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-editor-frame loam-view-frame');
			return view?.shadowRoot?.querySelector('iframe')?.src ?? null;
		});
		expect(origin).toContain(viewSite.sandbox?.origin);
		await frame.locator('#text').fill('First draft');
		await expect.poll(() => marked(page, 't1')).toBe(true);
		// Its selection, which `editor-selection-set` takes only in its binding's shape (it is not journaled).
		await frame.locator('#text').evaluate((area: HTMLTextAreaElement) => {
			area.setSelectionRange(0, 5);
			area.dispatchEvent(new Event('select'));
		});
		await expect
			.poll(async () =>
				(await events())
					.filter((event) => event.command === 'editor-selection-set')
					.map((event) => event.success)
			)
			.toContain(true);
		expect(
			(await events())
				.filter((event) => event.command === 'editor-selection-set')
				.every((event) => event.success)
		).toBe(true);
		// Another tab in the group: the view saves, then goes.
		await open(page, note, { preview: false });
		await expect
			.poll(
				async () =>
					(
						(await agentCall(page, 'sheet-read', { document: sheet })) as {
							data?: { text: string };
						}
					).data?.text
			)
			.toBe('First draft');
		await expect.poll(() => marked(page, 't1')).toBe(false);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.querySelector('loam-shell')?.shadowRoot?.querySelectorAll('loam-view-frame')
							.length
				)
			)
			.toBe(0);
		await editorIdle(page);
		// Shown again, rebuilt from what it saved.
		await page.locator('loam-editor-group [role="tab"]', { hasText: 'Plan' }).click();
		await editorIdle(page);
		frame = await sheetFrame(page, 'Plan');
		await expect.poll(() => frame.locator('#text').inputValue()).toBe('First draft');
		// An agent's write reaches it as `dev.loam/document-changed`, and a rename as its title.
		await agentCall(page, 'sheet-write', { document: sheet, text: 'From an agent' });
		await expect.poll(() => frame.locator('#text').inputValue()).toBe('From an agent');
		await agentCall(page, 'document-rename', { document: sheet, title: 'Plan B' });
		await expect.poll(async () => (await sheetOf(frame)).titles).toEqual(['Plan B']);
		await editorIdle(page);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: keeps a view editor whose save rejects, hidden with its draft and its tab unsaved, until it saves', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const created = (await kernelCall(page, 'document-create', {
			type: 'sheet',
			title: 'Kept',
		})) as {
			data: { id: string };
		};
		const sheet = created.data.id;
		const note = await createNote(page, 'Other');
		await open(page, sheet);
		const frame = await sheetFrame(page, 'Kept');
		await frame.locator('#text').fill('please reject this');
		await expect.poll(() => marked(page, 't1')).toBe(true);
		await open(page, note, { preview: false });
		// Its save rejected: a `danger` toast, the tab still unsaved, the view still on the page, hidden.
		await expect
			.poll(async () =>
				(await entriesOf(page)).some(
					(entry) =>
						entry.command === 'toast-show' &&
						String((entry.input as { message?: string }).message).startsWith('Kept was not saved')
				)
			)
			.toBe(true);
		await editorIdle(page);
		expect(await marked(page, 't1')).toBe(true);
		expect(
			(
				(await agentCall(page, 'document-trash', { document: sheet })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		expect(await frame.locator('#text').inputValue()).toBe('please reject this');
		// Shown again, the same frame, the same draft; then a draft it takes is saved as the tab hides.
		await page.locator('loam-editor-group [role="tab"]', { hasText: 'Kept' }).click();
		await editorIdle(page);
		expect(await frame.locator('#text').inputValue()).toBe('please reject this');
		await frame.locator('#text').fill('accepted now');
		await page.locator('loam-editor-group [role="tab"]', { hasText: 'Other' }).click();
		await expect
			.poll(
				async () =>
					(
						(await agentCall(page, 'sheet-read', { document: sheet })) as {
							data?: { text: string };
						}
					).data?.text
			)
			.toBe('accepted now');
		await expect.poll(() => marked(page, 't1')).toBe(false);
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);
});

/** Each embed under a note's text, nested as rendered: its state, its text, and the embeds inside it. */
interface EmbedView {
	state: string;
	heading: string;
	text: string | null;
	inner: EmbedView[];
}

/** The embeds the active tab's note renders, through every shadow root. */
function embedsOf(page: Page): Promise<EmbedView[]> {
	return page.evaluate(() => {
		type Embed = HTMLElement & { state: string; heading: string };
		const read = (embed: Embed): EmbedView => {
			const content = embed.shadowRoot
				?.querySelector('loam-mount')
				?.shadowRoot?.querySelector('notes-embed') as HTMLElement | null | undefined;
			const nested = [...(content?.shadowRoot?.querySelectorAll('loam-embed') ?? [])] as Embed[];
			return {
				state: embed.state,
				heading: embed.heading,
				text: content?.shadowRoot?.querySelector('.text')?.textContent ?? null,
				inner: nested.map(read),
			};
		};
		const frame = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-editor-frame:not([hidden])');
		const editor = frame?.querySelector('loam-mount')?.shadowRoot?.querySelector('notes-editor');
		return (
			[...(editor?.shadowRoot?.querySelectorAll('ul.embeds loam-embed') ?? [])] as Embed[]
		).map(read);
	}) as Promise<EmbedView[]>;
}

const signIn = (page: Page) =>
	kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});

describe('P2-D9: references and embed', () => {
	it('P2-D9: renders a note in a note, re-checks access so a removed member sees Not available as a missing one does, and stops at a depth of three and at a cycle', async () => {
		const opened = await openShell(browser, site.root);
		const { page } = opened;
		await signIn(page);
		await kernelCall(page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		const [a, b, c, d, e] = [
			await createNote(page, 'A'),
			await createNote(page, 'B'),
			await createNote(page, 'C'),
			await createNote(page, 'D'),
			await createNote(page, 'E'),
		];
		const vault = await createNote(page, 'Vaulted', 'vault');
		const write = (document: string, text: string, embeds: string[]) =>
			agentCall(page, 'notes-content-set', { document, text, embeds });
		await write(a, 'A text', [b, vault, 'doc_nowhere00000']);
		// B embeds C and A again, a cycle; C, D, and D, E, past three.
		await write(b, 'B text', [c, a]);
		await write(c, 'C text', [d]);
		await write(d, 'D text', [e]);
		await write(e, 'E text', []);
		const at = { workspace: 'personal', project: (await projectId(page, 'vault')) as string };
		await page.evaluate(
			async ({ document, at }) => {
				const shell = window.document.querySelector('loam-shell') as unknown as {
					kernel: {
						agent: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
					};
				};
				await shell.kernel.agent.call(
					'notes-content-set',
					{ document, text: 'Secret text' },
					{ scope: at }
				);
			},
			{ document: vault, at }
		);
		await open(page, a);
		const deep = (heading: string) => ({ state: 'deep', heading, text: null, inner: [] });
		await expect
			.poll(() => embedsOf(page))
			.toEqual([
				{
					state: 'ready',
					heading: 'B',
					text: 'B text',
					inner: [
						{
							state: 'ready',
							heading: 'C',
							text: 'C text',
							inner: [{ state: 'ready', heading: 'D', text: 'D text', inner: [deep('Document')] }],
						},
						deep('Document'),
					],
				},
				{ state: 'ready', heading: 'Vaulted', text: 'Secret text', inner: [] },
				{ state: 'unavailable', heading: 'Document', text: null, inner: [] },
			]);
		// Signed out, Vault is refused: its embed is checked again and says what a missing one says.
		await kernelCall(page, 'auth-sign-out');
		await expect
			.poll(async () =>
				(await embedsOf(page)).map((embed) => [embed.state, embed.heading, embed.text])
			)
			.toEqual([
				['ready', 'B', 'B text'],
				['unavailable', 'Document', null],
				['unavailable', 'Document', null],
			]);
		const shown = await page.evaluate(() => {
			const frame = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-editor-frame:not([hidden])');
			const editor = frame?.querySelector('loam-mount')?.shadowRoot?.querySelector('notes-editor');
			return [...(editor?.shadowRoot?.querySelectorAll('ul.embeds loam-embed') ?? [])].map(
				(embed) =>
					embed.shadowRoot?.querySelector('.embed')?.textContent?.replace(/\s+/g, ' ').trim()
			);
		});
		expect(shown[1]).toBe(shown[2]);
		expect(JSON.stringify(shown)).not.toContain('Secret');
		// Read-only: a mutation through the embedded note's own client is EMBED_READ_ONLY, journaled.
		const refused = await page.evaluate(async (document) => {
			const frame = window.document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-editor-frame:not([hidden])');
			const editor = frame?.querySelector('loam-mount')?.shadowRoot?.querySelector('notes-editor');
			const embed = editor?.shadowRoot?.querySelector('ul.embeds loam-embed');
			const content = embed?.shadowRoot
				?.querySelector('loam-mount')
				?.shadowRoot?.querySelector('notes-embed') as unknown as {
				context: {
					client: { call(name: string, input: unknown): Promise<{ error?: { code: string } }> };
				};
			};
			return (await content.context.client.call('notes-content-set', { document, text: 'x' })).error
				?.code;
		}, b);
		expect(refused).toBe('EMBED_READ_ONLY');
		expect((await entriesOf(page)).some((entry) => entry.command === 'app-embed-refuse')).toBe(
			true
		);
		expect(
			((await agentCall(page, 'notes-content-get', { document: b })) as { data?: { text: string } })
				.data?.text
		).toBe('B text');
		// Each element in its own registry: notes' are not global, the kit's embed is.
		expect(
			await page.evaluate(() => [
				customElements.get('notes-editor'),
				customElements.get('notes-embed'),
				customElements.get('notes-inspector'),
				!!customElements.get('loam-embed'),
			])
		).toEqual([undefined, undefined, undefined, true]);
		await editorIdle(page);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	}, 120_000);

	it('P2-D9: a view type’s embed, in a real frame, is read-only: its mutation is EMBED_READ_ONLY, journaled, and its query that writes is STORE_WRITE_IN_QUERY', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const sheet = (
			(await kernelCall(page, 'document-create', { type: 'sheet', title: 'Embedded sheet' })) as {
				data: { id: string };
			}
		).data.id;
		await agentCall(page, 'sheet-write', { document: sheet, text: 'Sheet text' });
		const note = await createNote(page, 'Holder');
		await agentCall(page, 'notes-content-set', { document: note, text: 'Holds', embeds: [sheet] });
		await open(page, note);
		const frame = await sheetFrame(page, 'Embedded sheet');
		const held = await sheetOf(frame);
		expect(held).toMatchObject({
			role: 'embed',
			document: { id: sheet, readOnly: true },
			write: { success: false, error: { code: 'EMBED_READ_ONLY' } },
			queryWrite: { success: false, error: { code: 'STORE_WRITE_IN_QUERY' } },
		});
		expect(await frame.locator('#text').inputValue()).toBe('Sheet text');
		expect(
			await frame.locator('#text').evaluate((area: HTMLTextAreaElement) => area.readOnly)
		).toBe(true);
		const entries = await entriesOf(page);
		expect(entries.some((entry) => entry.command === 'app-embed-refuse')).toBe(true);
		expect(
			((await agentCall(page, 'sheet-read', { document: sheet })) as { data?: { text: string } })
				.data?.text
		).toBe('Sheet text');
		await editorIdle(page);
		await opened.context.close();
	}, 120_000);
});

/** A project's id by its slug, as the person reads it. */
async function projectId(page: Page, slug: string): Promise<string | undefined> {
	return ((await kernelCall(page, 'project-get', { project: slug })) as { data?: { id: string } })
		.data?.id;
}

/** A sheet's stored text, read by an agent at the workspace, whatever scope is active. */
const storedAt = (page: Page, document: string) =>
	page.evaluate(async (document) => {
		const shell = window.document.querySelector('loam-shell') as unknown as {
			kernel: {
				agent: {
					call(
						name: string,
						input: unknown,
						options: unknown
					): Promise<{ data?: { text?: string } }>;
				};
			};
		};
		return (
			await shell.kernel.agent.call(
				'sheet-read',
				{ document },
				{ scope: { workspace: 'personal' } }
			)
		).data?.text;
	}, document);

/** A new sheet, open, with `text` typed into its view as a person types. */
async function draftSheet(
	page: Page,
	title: string,
	text: string,
	options: Record<string, unknown> = {}
) {
	const sheet = (
		(await kernelCall(page, 'document-create', { type: 'sheet', title })) as {
			data: { id: string };
		}
	).data.id;
	await open(page, sheet, options);
	const frame = await sheetFrame(page, title);
	await frame.locator('#text').fill(text);
	await expect
		.poll(async () =>
			(await editorView(page))
				?.flatMap((group) => group.tabs)
				.some((tab) => tab.name.includes('unsaved'))
		)
		.toBe(true);
	return { sheet, frame };
}

const tabsByGroup = async (page: Page) =>
	(
		(await kernelCall(page, 'editor-get')) as {
			data: { groups: Array<{ tabs: Array<{ id: string; document: string; dirty: boolean }> }> };
		}
	).data.groups.map((group) => group.tabs.map((tab) => tab.document));

describe('P2-D5: a view editor that cannot move with its draft, where the browser has no moveBefore', () => {
	it('P2-D5: saves an unsaved view editor before another’s move takes it to a new group, and its view shows what it saved', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		await page.evaluate(() => delete (Element.prototype as { moveBefore?: unknown }).moveBefore);
		const note = await createNote(page, 'Beside it');
		await open(page, note, { preview: false });
		const { sheet } = await draftSheet(page, 'Moved', 'Moved draft', { preview: false });
		await agentCall(page, 'editor-move', { tab: 't2', group: 'new' });
		await expect.poll(() => storedAt(page, sheet)).toBe('Moved draft');
		await expect.poll(() => tabsByGroup(page)).toEqual([[note], [sheet]]);
		await editorIdle(page);
		// Moved, its view reloaded, showing the text it saved first.
		const frame = await sheetFrame(page, 'Moved');
		await expect.poll(() => frame.locator('#text').inputValue()).toBe('Moved draft');
		await opened.context.close();
	}, 120_000);

	it('P2-D5: refuses the move when that save rejects: the tab comes back, its draft and its mark kept in the same view, with a danger toast', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		await page.evaluate(() => delete (Element.prototype as { moveBefore?: unknown }).moveBefore);
		const note = await createNote(page, 'Left alone');
		await open(page, note, { preview: false });
		// The sheet alone in its group, which goes with it when an agent moves it.
		const { sheet, frame } = await draftSheet(page, 'Refused', 'please reject this', {
			group: 'beside',
		});
		await agentCall(page, 'editor-move', { tab: 't2', group: 'g1' });
		await expect
			.poll(async () =>
				(await entriesOf(page)).some(
					(entry) =>
						entry.command === 'toast-show' &&
						String((entry.input as { message?: string }).message).includes('stays in its group')
				)
			)
			.toBe(true);
		await editorIdle(page);
		await expect.poll(() => tabsByGroup(page)).toEqual([[note], [sheet]]);
		// The same view, never reloaded, with the draft; the tab still unsaved, so a trash waits.
		expect(await frame.locator('#text').inputValue()).toBe('please reject this');
		expect(await marked(page, 't2')).toBe(true);
		expect(
			(
				(await agentCall(page, 'document-trash', { document: sheet })) as {
					error?: { code: string };
				}
			).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		expect(await storedAt(page, sheet)).toBe('');
		await opened.context.close();
	}, 120_000);
});

describe('P2-D5: a view editor across an app and a change of scope', () => {
	it('P2-D5: keeps a view editor and its draft while an app shows, and shows the same view on the return', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const { frame } = await draftSheet(page, 'Kept away', 'Draft kept');
		await kernelCall(page, 'app-open', { instance: 'hello' });
		await editorIdle(page);
		await kernelCall(page, 'section-open', { section: 'documents' });
		await editorIdle(page);
		// The same frame, alive, its draft and mark kept.
		expect(await frame.locator('#text').inputValue()).toBe('Draft kept');
		expect((await sheetOf(frame)).ready).toBe(true);
		expect(await marked(page, 't1')).toBe(true);
		await frame.locator('#text').fill('Draft kept, then more');
		await expect.poll(() => marked(page, 't1')).toBe(true);
		await opened.context.close();
	}, 120_000);

	it('P2-D5: saves an unsaved view editor in its own scope when the person changes scope, as its frame stays until it answers', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		await kernelCall(page, 'project-create', { name: 'Atlas' });
		const { sheet } = await draftSheet(page, 'Left behind', 'Saved on the way out');
		await kernelCall(page, 'scope-set', { project: 'atlas' });
		// Well within the 10 seconds a view has to answer: its frame was not removed before it could.
		await expect.poll(() => storedAt(page, sheet), { timeout: 5_000 }).toBe('Saved on the way out');
		await editorIdle(page);
		expect(
			(await entriesOf(page)).some(
				(entry) =>
					entry.command === 'toast-show' &&
					String((entry.input as { message?: string }).message).includes('not saved')
			)
		).toBe(false);
		// Nothing of the workspace stays on the page under Atlas once it has saved.
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.querySelector('loam-shell')?.shadowRoot?.querySelectorAll('loam-view-frame')
							.length
				)
			)
			.toBe(0);
		await opened.context.close();
	}, 120_000);
});

describe('P2-D5: a view editor when another group goes', () => {
	it('P2-D5: closing the last tab of the group before a view editor’s keeps that view’s window and its draft', async () => {
		const opened = await openShell(browser, viewSite.root);
		const { page } = opened;
		const note = await createNote(page, 'First group');
		await open(page, note, { preview: false });
		const { frame } = await draftSheet(page, 'Stays put', 'Draft in place', { group: 'beside' });
		await frame.evaluate(() => {
			(window as unknown as { marker: string }).marker = 'same window';
		});
		await kernelCall(page, 'editor-close', { tab: 't1', discard: true });
		await editorIdle(page);
		expect(await tabsByGroup(page)).toHaveLength(1);
		expect(await frame.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe(
			'same window'
		);
		expect(await frame.locator('#text').inputValue()).toBe('Draft in place');
		expect(await marked(page, 't2')).toBe(true);
		await opened.context.close();
	}, 120_000);
});
