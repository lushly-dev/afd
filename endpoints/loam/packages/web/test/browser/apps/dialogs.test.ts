/**
 * P4-E7, the parts phase 4's step 4 builds (its 6.1 to 6.7): a dialog, non-modal, with its owner line and an app's own
 * element, parked on a switch and restored; a prompt in the slot, `aria-modal`, its value checked and its refusal shown
 * in place; the agent interface opening nothing and closing nothing of the shell's; the global strip under the title
 * bar. With step 3's two deferred cases: a native editor's anchor, and a failed menu pick's toast.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNote, editorIdle, open } from '../documents/support';
import {
	agentCall,
	axe,
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
		// The checklist is a view: its editor needs the second origin.
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('tally', await packApp('tally')),
			deploymentEntry('notes', await packApp('notes')),
			deploymentEntry('checklist', await packApp('checklist'))
		),
	});
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
	await site?.close();
});

type Result = {
	success: boolean;
	data?: { overlayId: string };
	error?: { code: string; message: string };
};

/** A call through an app's own port, as its surfaces make one. */
const portCall = (page: Page, instance: string, name: string, input: unknown) =>
	page.evaluate(
		({ instance, name, input }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
				};
			};
			return shell.kernel.appPort(instance).call(name, input);
		},
		{ instance, name, input }
	) as Promise<Result>;

const overlays = async (page: Page) =>
	(
		(await kernelCall(page, 'overlay-list')) as {
			data: { overlays: Array<{ overlayId: string; kind: string; state?: string }> };
		}
	).data.overlays;

/** What each open `loam-modal` on the page shows: modal or not, its owner line, title, buttons and error. */
const questions = (page: Page) =>
	page.evaluate(() =>
		[...(document.querySelector('loam-shell')?.shadowRoot?.querySelectorAll('loam-modal') ?? [])]
			.map((host) => {
				const dialog = host.shadowRoot?.querySelector('dialog');
				return {
					open: dialog?.open === true,
					modal: dialog?.matches(':modal') === true,
					ariaModal: dialog?.getAttribute('aria-modal') ?? null,
					from: host.shadowRoot?.querySelector('.from:not([hidden])')?.textContent?.trim() ?? '',
					title: host.shadowRoot?.querySelector('h2')?.textContent?.trim() ?? '',
					buttons: [...(host.shadowRoot?.querySelectorAll('.buttons button') ?? [])].map((button) =>
						button.textContent?.trim()
					),
					error: host.shadowRoot?.querySelector('.error:not([hidden])')?.textContent?.trim() ?? '',
					element: host.shadowRoot?.querySelector('.content loam-mount') != null,
				};
			})
			.filter((each) => each.open)
	);

/** Press a question's button by its label, as a person does: a script's click() answers nothing. */
async function press(page: Page, title: string, label: string): Promise<boolean> {
	const button = page
		.locator('loam-modal')
		.filter({ has: page.locator('h2', { hasText: title }) })
		.locator('.buttons button', { hasText: label });
	if ((await button.count()) === 0) return false;
	await button.first().click();
	return true;
}

describe('P4-E7: dialogs (6.1 to 6.4)', () => {
	it("shows an app's dialog non-modal with its line and element, parks it on a switch and restores it", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const opened = await portCall(page, 'hello', 'dialog-open', {
			title: 'A card',
			body: 'From the app.',
			element: 'x-card',
			actions: [{ id: 'keep', label: 'Keep', default: true }],
		});
		expect(opened.success).toBe(true);
		await surfacesIdle(page);
		await expect
			.poll(() => questions(page))
			.toEqual([
				expect.objectContaining({
					modal: false,
					ariaModal: null,
					from: 'From Hello',
					title: 'A card',
					buttons: ['Cancel', 'Keep'],
					element: true,
				}),
			]);
		// Non-modal: the page outside stays usable, and the app's element upgraded in its own registry.
		expect(
			await page.evaluate(() => {
				const shell = document.querySelector('loam-shell');
				const card = [...(shell?.shadowRoot?.querySelectorAll('loam-modal') ?? [])]
					.map((host) => host.shadowRoot?.querySelector('.content loam-mount'))
					.find(Boolean)
					?.shadowRoot?.querySelector('x-card');
				return {
					inert: shell?.shadowRoot?.querySelector('loam-main')?.closest('[inert]') != null,
					upgraded: card != null && card.constructor !== HTMLElement,
					global: customElements.get('x-card') === undefined,
				};
			})
		).toEqual({ inert: false, upgraded: true, global: true });
		await openApp(page, 'tally');
		await expect.poll(() => questions(page)).toEqual([]);
		expect((await overlays(page)).map((each) => each.state)).toEqual(['parked']);
		await openApp(page, 'hello');
		await expect
			.poll(async () => (await questions(page)).map((each) => each.title))
			.toEqual(['A card']);
		expect(await press(page, 'A card', 'Keep')).toBe(true);
		await expect.poll(() => overlays(page)).toEqual([]);
		await expect.poll(() => questions(page)).toEqual([]);
		expect(errors).toEqual([]);
	});
});

describe('P4-E7: prompts and the slot (6.1, 6.4, 6.5, section 15)', () => {
	it('opens a prompt aria-modal, shows a refused value in place, and answers with the value', async () => {
		const { page, errors } = await openShell(browser, site.origin);
		const opened = (await kernelCall(page, 'prompt-open', {
			title: 'How many?',
			schema: { type: 'integer', title: 'Count', minimum: 1, maximum: 9 },
		})) as Result;
		expect(opened.success).toBe(true);
		await expect
			.poll(() => questions(page))
			.toEqual([
				expect.objectContaining({
					modal: true,
					ariaModal: 'true',
					from: '',
					buttons: ['Cancel', 'OK'],
				}),
			]);
		expect((await focused(page)).tag).toBe('input');
		// The palette stays shut while the slot is held.
		expect(((await kernelCall(page, 'palette-open', {})) as Result).error?.code).toBe(
			'OVERLAY_MODAL_BUSY'
		);
		await page.keyboard.type('12');
		await press(page, 'How many?', 'OK');
		await expect.poll(async () => (await questions(page))[0]?.error).toMatch(/at most 9/);
		expect(await overlays(page)).toHaveLength(1);
		await page.evaluate(() => {
			const input = [
				...(document.querySelector('loam-shell')?.shadowRoot?.querySelectorAll('loam-modal') ?? []),
			]
				.map((host) => host.shadowRoot?.querySelector('input'))
				.find(Boolean) as HTMLInputElement;
			input.value = '3';
		});
		await press(page, 'How many?', 'OK');
		await expect.poll(() => overlays(page)).toEqual([]);
		const answered = (await journal(page)).filter(
			(entry) => entry.command === 'overlay-dismiss' && entry.success
		);
		expect(answered.at(-1)?.input).toMatchObject({ result: 'confirm', value: 3 });
		expect(errors).toEqual([]);
	});

	it("refuses every question from the agent interface, and its cancel of the shell's prompt (F6)", async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		for (const [name, input] of [
			['dialog-open', { title: 'T' }],
			['modal-open', { title: 'T', body: 'B' }],
			['prompt-open', { title: 'T' }],
			['popover-open', { anchor: { surface: 'shell', anchor: 'x' }, kind: 'info', body: 'B' }],
		] as const) {
			expect(((await agentCall(page, name, input)) as Result).error?.code, name).toBe(
				'HUMAN_REQUIRED'
			);
		}
		expect(((await agentCall(page, 'toast-show', { message: 'Done' })) as Result).success).toBe(
			true
		);
		const prompt = (await kernelCall(page, 'prompt-open', { title: 'Name?' })) as Result;
		await expect.poll(async () => (await questions(page)).length).toBe(1);
		for (const result of ['cancel', 'confirm']) {
			const refused = (await agentCall(page, 'overlay-dismiss', {
				overlayId: prompt.data?.overlayId,
				result,
			})) as Result;
			expect(refused.error?.code, result).toBe('HUMAN_REQUIRED');
		}
		// hello's port, which did not raise it, may not cancel it either.
		const port = await portCall(page, 'hello', 'overlay-dismiss', {
			overlayId: prompt.data?.overlayId,
			result: 'cancel',
		});
		expect(port.error?.code).toBe('HUMAN_REQUIRED');
		expect((await questions(page)).map((each) => each.title)).toEqual(['Name?']);
		expect(await axe(page)).toEqual([]);
		await page.keyboard.press('Escape');
		await expect
			.poll(async () => (await overlays(page)).filter((each) => each.kind === 'prompt'))
			.toEqual([]);
	});
});

describe('P4-E7: the global strip (6.1)', () => {
	it('shows a status under the title bar, keeps it across a switch, and closes it with its condition', async () => {
		const { page } = await openShell(browser, site.origin);
		await kernelCall(page, 'overlay-global-set', {
			id: 'offline',
			message: 'You are offline',
			tone: 'warning',
		});
		await surfacesIdle(page);
		const strip = () =>
			page.evaluate(() => {
				const root = document.querySelector('loam-shell')?.shadowRoot;
				const global = root?.querySelector('loam-global') as HTMLElement | null | undefined;
				const line = global?.querySelector('p');
				const titlebar = root?.querySelector('loam-titlebar')?.getBoundingClientRect();
				const top = global?.getBoundingClientRect().top ?? -1;
				return {
					hidden: !line,
					text: line?.textContent ?? '',
					role: global?.getAttribute('role') ?? null,
					live: global?.getAttribute('aria-live') ?? null,
					below: titlebar ? Math.round(top) >= Math.round(titlebar.bottom) - 1 : false,
				};
			});
		// One persistent polite region whose text changes (the review's 12).
		await expect.poll(strip).toEqual({
			hidden: false,
			text: 'You are offline',
			role: 'status',
			live: 'polite',
			below: true,
		});
		await openApp(page, 'hello');
		expect((await strip()).text).toBe('You are offline');
		const agent = (await agentCall(page, 'overlay-global-set', {
			id: 'x',
			message: 'Hi',
		})) as Result;
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');
		await kernelCall(page, 'overlay-global-set', { id: 'offline' });
		await surfacesIdle(page);
		await expect.poll(async () => (await strip()).hidden).toBe(true);
	});
});

describe("step 4's trust review (2, 4, 6, 10)", () => {
	it("answers nothing from a page's event or a script's click: only a person's press on the question's own button", async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		const opened = await portCall(page, 'hello', 'modal-open', {
			title: 'Forged?',
			body: 'Only the person answers.',
			element: 'x-card',
		});
		expect(opened.success).toBe(true);
		await expect.poll(async () => (await questions(page)).length).toBe(1);
		await page.evaluate((overlayId) => {
			const host = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-modal');
			const card = host?.shadowRoot
				?.querySelector('.content loam-mount')
				?.shadowRoot?.querySelector('x-card');
			// The phase 1 event, from inside the app's own element, and a script's press on the confirm button.
			card?.dispatchEvent(
				new CustomEvent('loam-modal-result', {
					detail: { overlayId, result: 'confirm' },
					bubbles: true,
					composed: true,
				})
			);
			(host?.shadowRoot?.querySelector('button.confirm') as HTMLButtonElement | null)?.click();
		}, opened.data?.overlayId);
		await surfacesIdle(page);
		expect((await overlays(page)).map((each) => each.overlayId)).toEqual([opened.data?.overlayId]);
		// A real press answers.
		await page.locator('loam-modal button.confirm').click();
		await expect.poll(() => overlays(page)).toEqual([]);
	});

	it('cancels nothing of the next question when one closes and the next opens at once on the same <dialog>', async () => {
		const { page } = await openShell(browser, site.origin);
		const first = (await kernelCall(page, 'modal-open', {
			title: 'First',
			body: 'One.',
		})) as Result;
		await expect
			.poll(async () => (await questions(page)).map((each) => each.title))
			.toEqual(['First']);
		await page.evaluate(async (overlayId) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown): Promise<unknown> };
			};
			await shell.kernel.call('overlay-dismiss', { overlayId });
			await shell.kernel.call('modal-open', { title: 'Second', body: 'Two.' });
		}, first.data?.overlayId);
		await surfacesIdle(page);
		await page.waitForTimeout(200);
		await expect
			.poll(async () => (await questions(page)).map((each) => each.title))
			.toEqual(['Second']);
		expect((await overlays(page)).map((each) => each.kind)).toEqual(['modal']);
	});

	it("P4-E7: keeps focus where it is when a dialog opens, and follows the active tab's owner between two apps' documents", async () => {
		const { page } = await openShell(browser, site.origin);
		const note = await createNote(page, 'Note');
		const list = (await kernelCall(page, 'document-create', {
			type: 'checklist',
			title: 'List',
		})) as {
			data?: { id: string };
		};
		await open(page, note);
		await page.locator('loam-editor-frame textarea').first().focus();
		const before = await focused(page);
		const dialog = await portCall(page, 'notes', 'dialog-open', { title: 'Notes says' });
		expect(dialog.success).toBe(true);
		await expect
			.poll(async () => (await questions(page)).map((each) => each.title))
			.toEqual(['Notes says']);
		expect((await focused(page)).tag).toBe(before.tag);
		// The checklist's tab takes over: the notes dialog parks, and hides with no app switch.
		await open(page, list.data?.id as string);
		await expect.poll(async () => (await questions(page)).map((each) => each.title)).toEqual([]);
		expect((await overlays(page)).map((each) => each.state)).toEqual(['parked']);
		await open(page, note);
		await expect
			.poll(async () => (await questions(page)).map((each) => each.title))
			.toEqual(['Notes says']);
		// A prompt cancelled by its own Escape leaves the page usable, not inert.
		await kernelCall(page, 'prompt-open', { title: 'Quick?' });
		await expect.poll(async () => (await questions(page)).some((each) => each.modal)).toBe(true);
		await page.keyboard.press('Escape');
		await expect
			.poll(async () => (await overlays(page)).filter((each) => each.kind === 'prompt'))
			.toEqual([]);
		expect(
			await page.evaluate(
				() => document.querySelector('loam-shell')?.shadowRoot?.querySelector('[inert]') == null
			)
		).toBe(true);
	});
});

describe("step 3's deferred Chromium cases (6.3, 6.4)", () => {
	it("P4-E7: anchors a popover on a native editor's own element, in main, the active tab owner's", async () => {
		const { page, errors } = await openShell(browser, site.origin);
		const id = await createNote(page, 'Anchored');
		await open(page, id);
		await page.evaluate(() => {
			const editor = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.querySelector('loam-editor-frame loam-mount')
				?.shadowRoot?.querySelector('notes-editor');
			const area = editor?.shadowRoot?.querySelector('violet-text-area');
			area?.setAttribute('data-loam-anchor', 'body');
		});
		const opened = await portCall(page, 'notes', 'popover-open', {
			anchor: { surface: 'main', anchor: 'body' },
			kind: 'info',
			body: 'Saved as you type.',
		});
		expect(opened.success).toBe(true);
		await editorIdle(page);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document
							.querySelector('loam-shell')
							?.shadowRoot?.querySelector('loam-popover')
							?.matches(':popover-open') === true
				)
			)
			.toBe(true);
		// The same anchor named in the sidebar is not the editor's: refused.
		const elsewhere = await portCall(page, 'notes', 'popover-open', {
			anchor: { surface: 'sidebar', anchor: 'body' },
			kind: 'info',
			body: 'x',
		});
		expect(elsewhere.error?.code).toBe('OVERLAY_ANCHOR_NOT_FOUND');
		expect(errors).toEqual([]);
	});

	it('shows the person a toast with the message and suggestion of a menu pick that failed', async () => {
		const { page } = await openShell(browser, site.origin);
		await openApp(page, 'hello');
		await page.mouse.move(700, 500);
		await page.locator('hello-main violet-button.greet').evaluate((button) => {
			button.setAttribute('data-loam-anchor', 'greet');
			(button as HTMLElement).focus();
		});
		// The pick's own run fails, as a command that throws or is refused would.
		await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input?: unknown, options?: unknown): Promise<unknown> };
			};
			const call = shell.kernel.call.bind(shell.kernel);
			shell.kernel.call = (name, input, options) =>
				name === 'hello-greet'
					? Promise.resolve({
							success: false,
							error: { code: 'X', message: 'Greeting failed.', suggestion: 'Try again later.' },
						})
					: call(name, input, options);
		});
		const opened = await portCall(page, 'hello', 'popover-open', {
			anchor: { surface: 'main', anchor: 'greet' },
			kind: 'menu',
			items: [{ command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } }],
		});
		expect(opened.success).toBe(true);
		await surfacesIdle(page);
		await page.waitForFunction(
			() =>
				document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-popover')
					?.matches(':popover-open') === true
		);
		await page.waitForTimeout(100);
		await page.keyboard.press('Enter');
		await expect
			.poll(async () =>
				(
					(await kernelCall(page, 'overlay-list')) as {
						data: {
							overlays: Array<{ kind: string; input: { message?: string; tone?: string } }>;
						};
					}
				).data.overlays
					.filter((each) => each.kind === 'toast')
					.map((each) => each.input)
			)
			.toEqual([
				expect.objectContaining({ message: 'Greeting failed. Try again later.', tone: 'danger' }),
			]);
	});
});
