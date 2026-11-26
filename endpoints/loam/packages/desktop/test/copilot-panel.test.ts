/**
 * P5-A8 on the desktop (phase 5 specification, 6.2 and 18; step 3's follow-up): the copilot's panel in the shell's
 * panel part, over the kernel's own records, in the webview under `tauri-driver` (WebKitGTK in CI, WebView2 on
 * Windows). The app runs on `p5-base` (`fixtures/p5-base.ts`), and the person asks `script:obey-thr-2`: the copilot
 * reads a stranger's message in `mailfix`, so the session is tainted, and its `project-create` is asked (taint lowers
 * it) and its `tally-reset` suggested (the person's row).
 *
 * What it proves: the panel draws the confirmation and the suggestion that `copilot-session-get` records, with the
 * taint's source; it marks the tainted session's reply; a script's click on a card's button answers nothing, and
 * WebDriver's own click, which the page sees as a person's press, declines the confirmation in the kernel; and axe finds
 * nothing with the cards drawn, in light, dark and high contrast. The message is sent with the panel's own `submit`,
 * as its composer sends it; the press that matters here is the card's. Every wait is a poll with a deadline.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inApp, p5Deployment, seedDesktop } from './fixtures/p5-base';
import { type ScenarioModel, startScenarioModel } from './fixtures/scenario-model';
import { type Desktop, openDesktop } from './harness';

let model: ScenarioModel;
let desktop: Desktop;
/** The confirmation the turn raised. */
let notification = '';

const axeSource = readFileSync(
	createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
	'utf8'
);

/** Polls `read` until it answers something, or fails after `timeoutMs` saying what it waited for. */
async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`Waited ${timeoutMs} ms for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

/** What the panel's cards region shows: each card's text by class, and the taint mark. */
interface Shown {
	approvals: number;
	why: string[];
	suggestion: string | null;
	taint: string | null;
	buttons: string[];
}

function shown(): Promise<Shown | null> {
	return desktop.browser.execute(() => {
		const panel = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-copilot-panel');
		const region = panel?.shadowRoot?.querySelector('.cards');
		if (!region) return null;
		const texts = (selector: string) =>
			[...region.querySelectorAll(selector)].map((each) => each.textContent ?? '');
		return {
			approvals: region.querySelectorAll('violet-approval-card').length,
			why: texts('violet-approval-card .card-why'),
			suggestion: region.querySelector('.suggestion .card-title')?.textContent ?? null,
			taint: region.querySelector('.taint')?.textContent ?? null,
			buttons: texts('violet-button').map((each) => each.trim()),
		};
	});
}

async function confirmationState(): Promise<string | undefined> {
	const listed = await inApp(desktop, {
		kind: 'person',
		command: 'notification-list',
		input: { kind: 'confirmation' },
	});
	return (
		listed.data as { notifications: Array<{ id: string; confirmation?: { state: string } }> }
	).notifications.find((each) => each.id === notification)?.confirmation?.state;
}

beforeAll(async () => {
	model = await startScenarioModel();
	desktop = await openDesktop({ deployment: await p5Deployment('p5-base', model) });
	await desktop.browser.setTimeout({ script: 120_000 });
	await seedDesktop(desktop);
	const opened = await inApp(desktop, {
		kind: 'person',
		command: 'layout-set',
		input: { panel: { open: true } },
	});
	if (!opened.success) throw new Error(JSON.stringify(opened.error));
	await until(
		() =>
			desktop.browser
				.execute(() => {
					const composer = document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelector('loam-copilot-panel')
						?.shadowRoot?.querySelector('violet-chat-composer');
					return composer?.isConnected && !composer.hasAttribute('disabled') ? true : null;
				})
				.then((ready) => ready ?? undefined),
		'the panel’s composer'
	);
	await desktop.browser.execute(async () => {
		const panel = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-copilot-panel') as unknown as {
			submit(text: string): Promise<void>;
		};
		await panel.submit('script:obey-thr-2');
	});
	await until(async () => {
		const now = await shown();
		return now && now.approvals > 0 && now.suggestion && now.taint ? now : undefined;
	}, 'the turn’s cards and mark');
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	await model?.close();
});

describe('P5-A8: the panel on the desktop', () => {
	it("P5-A8: draws the confirmation and the suggestion the kernel records, with taint's source, and marks the reply", async () => {
		const listed = await inApp(desktop, {
			kind: 'person',
			command: 'notification-list',
			input: { kind: 'confirmation' },
		});
		const notices = (
			listed.data as {
				notifications: Array<{
					id: string;
					confirmation: { command: string; state: string; asked?: { reason?: string } };
				}>;
			}
		).notifications;
		expect(notices.map((each) => each.confirmation)).toMatchObject([
			{ command: 'project-create', state: 'pending', asked: { reason: 'taint' } },
		]);
		notification = notices[0]?.id as string;
		const now = (await shown()) as Shown;
		expect(now.approvals).toBe(1);
		expect(now.why.join(' ')).toContain('mailfix');
		expect(now.suggestion).toBe('Suggested: tally-reset');
		expect(now.taint).toBe('This answer may repeat text from mailfix');
		expect(now.buttons).toEqual(expect.arrayContaining(['Decline', 'Run it']));
	});

	it('P5-A8: passes axe with the cards and the mark drawn, in light, dark and high contrast', async () => {
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			// The person's: an agent's write of the appearance asks first (6.1), and this is about axe in a theme.
			const set = await inApp(desktop, {
				kind: 'person',
				command: 'appearance-set',
				input: { theme },
			});
			expect(set.success, JSON.stringify(set.error)).toBe(true);
			await desktop.browser.waitUntil(
				async () =>
					(await desktop.browser.execute(() => document.documentElement.dataset.loamTheme)) ===
					theme,
				{ timeout: 5_000 }
			);
			// The theme's colours transition, in the document and in every shadow root, where `document.getAnimations()`
			// does not look; axe reads them once every transition has ended and two readings of every colour agree.
			const colours = () =>
				desktop.browser.execute(async () => {
					// Two frames first, so a transition the theme change starts has started before it is looked for.
					await new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve))
					);
					const roots: Array<Document | ShadowRoot> = [document];
					for (let index = 0; index < roots.length; index++)
						for (const element of (roots[index] as Document | ShadowRoot).querySelectorAll('*'))
							if (element.shadowRoot) roots.push(element.shadowRoot);
					// Settled, not all: a transition cancelled by a node replaced mid-way rejects, and is over all the same. An
					// endless animation (a spinner) is not waited on.
					await Promise.allSettled(
						roots.flatMap((root) =>
							root
								.getAnimations()
								.filter(
									(animation) =>
										animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY
								)
								.map((animation) => animation.finished)
						)
					);
					return roots
						.flatMap((root) => [...root.querySelectorAll('*')])
						.map((element) => {
							const style = getComputedStyle(element);
							return `${style.color}|${style.backgroundColor}|${style.borderColor}`;
						})
						.join(';');
				});
			let before = await colours();
			let settled = false;
			for (let tries = 0; tries < 50 && !settled; tries++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const after = await colours();
				settled = after === before;
				before = after;
			}
			// Colours still changing after five seconds are not a theme to judge: say so rather than scan them.
			expect(settled, `${theme}: the panel's colours never settled`).toBe(true);
			await desktop.browser.execute(axeSource);
			const violations = await desktop.browser.execute(async () => {
				const runner = (
					window as unknown as {
						axe: {
							run(
								context: Document,
								options: object
							): Promise<{
								violations: {
									id: string;
									nodes: { target: unknown[]; any: { data?: unknown }[] }[];
								}[];
							}>;
						};
					}
				).axe;
				const result = await runner.run(document, {
					runOnly: {
						type: 'tag',
						values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
					},
				});
				// Each node by its target and what the check measured (a contrast's colours and ratio), so a failure says where.
				return result.violations.map(({ id, nodes }) => ({
					id,
					nodes: nodes.map((node) => ({
						target: node.target,
						data: node.any.map((check) => check.data ?? null),
					})),
				}));
			});
			expect(violations, theme).toEqual([]);
		}
	});

	it("P5-A8: a script's click on a card answers nothing; the person's press declines it in the kernel", async () => {
		expect(await confirmationState()).toBe('pending');
		await desktop.browser.execute(() => {
			const buttons = document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-copilot-panel')
				?.shadowRoot?.querySelectorAll('.cards violet-button');
			for (const button of buttons ?? []) (button as HTMLElement).click();
		});
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(await confirmationState()).toBe('pending');
		// WebDriver's own click on the card's Decline: a press the page sees as the person's (`isTrusted`). The panel
		// redraws its cards from the kernel's records while a confirmation waits, so a button found just before a redraw
		// is gone when clicked ("stale element"); that click pressed nothing, and the button is found again.
		const findDecline = () =>
			desktop.browser.execute(() => {
				const buttons = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-copilot-panel')
					?.shadowRoot?.querySelectorAll('.cards violet-approval-card violet-button');
				return (
					[...(buttons ?? [])].find((button) => button.textContent?.trim() === 'Decline') ?? null
				);
			});
		let pressed = false;
		for (let tries = 0; tries < 10 && !pressed; tries++) {
			const decline = await findDecline();
			expect(decline).not.toBeNull();
			try {
				await (await desktop.browser.$(decline as never)).click();
				pressed = true;
			} catch (error) {
				if (!/stale element/i.test(String(error))) throw error;
			}
		}
		expect(pressed, 'the Decline button stayed stale through ten redraws').toBe(true);
		expect(
			await until(
				async () => ((await confirmationState()) === 'declined' ? 'declined' : undefined),
				'the confirmation to be declined',
				10_000
			)
		).toBe('declined');
	});
});
