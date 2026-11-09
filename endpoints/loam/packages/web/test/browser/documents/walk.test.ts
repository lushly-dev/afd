/**
 * The editor area's seeded walk (documents specification, Status, deviation 16): random steps of a person, an
 * agent and held saves, the thirteen invariants checked after each, then every mark against the rule and a
 * trash of every document. Since step 11 the person also opens from the documents section's tree; since step
 * 12 two seeds of their own also open the `sheet` fixture's view editors, type into their sandboxed frames,
 * which a hidden tab tears down, and have an agent embed one document in a note; every seed checks a
 * fourteenth invariant, for a kept view editor. Since step 13 one seed of its own walks a deployment that also
 * holds `checklist`, the second type, whose editors it opens, adds to and ticks in their sandboxed frames.
 * Its own CI job, `loam.yml`'s "Editor walk", runs it beside the Chromium suite.
 */

import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	openShell,
	packApp,
	serveDeployment,
} from '../harness';
import { sheetPackage } from './sheet';
import { createNote, editorIdle, frameViolations, marksOf, open, type Walk } from './support';

let browser: Browser;
let site: DeploymentSite;
/** The same with `checklist`, for the seed that walks the second type; the others keep `site`, and their paths. */
let typesSite: DeploymentSite;

beforeAll(async () => {
	browser = await chromium.launch();
	site = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('notes', await packApp('notes')),
			deploymentEntry('sheet', await sheetPackage())
		),
	});
	typesSite = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('notes', await packApp('notes')),
			deploymentEntry('sheet', await sheetPackage()),
			deploymentEntry('checklist', await packApp('checklist'))
		),
	});
}, 120_000);

afterAll(async () => {
	await site?.close();
	await typesSite?.close();
	await browser?.close();
});

/** The fewest reopens a walk's seed may reach, so its coverage cannot drop unseen. */
const REOPEN_FLOOR = 1;

describe('P2-D5: the editor area, a seeded walk', () => {
	// The eleven seeds walk as they always have; the last two also take step 12's view steps, from a stream of
	// their own, since any added step moves a seed's path and the eleven's paths are what found their bugs. Kept
	// to these two dedicated seeds, so the eleven keep their paths and their reopens, as the coordinator accepted
	// on 2026-11-09.
	it.each([
		[0x5eed10, 200, 0],
		[9, 200, 0],
		[12, 200, 0],
		[20, 200, 0],
		[32, 300, 0],
		[43, 300, 0],
		[100, 200, 0],
		[1, 200, 0],
		[2, 200, 0],
		[0xdeadbeef, 200, 0],
		[42, 200, 0],
		[5, 200, 0.17],
		[77, 200, 0.17],
		// And one that also has an agent move view editors' tabs, with `moveBefore` (the re-check's N-B1).
		[7, 200, 0.17, true],
		// And one, step 13's, whose view steps also open, add to and tick checklists, the second type.
		[13, 200, 0.17, false, true],
	])(
		'P2-D5: a seeded walk, seed %i, of %i steps with view steps at %d, keeps the fifteen invariants after each and reaches reopens',
		async (start, length, views, moves = false, checklists = false) => {
			const opened = await openShell(browser, (checklists ? typesSite : site).root);
			const { page } = opened;
			// Seed 77 walks a browser with no `moveBefore`, across its reloads too: a view editor with unsaved work
			// then saves before an agent's move, which it refuses when that save rejects (5.6, step 12).
			if (start === 77) {
				const strip = () => delete (Element.prototype as { moveBefore?: unknown }).moveBefore;
				await opened.context.addInitScript(strip);
				await page.evaluate(strip);
			}
			// mulberry32: the same steps for the same seed every run.
			let seed = start;
			const random = () => {
				seed = (seed + 0x6d2b79f5) | 0;
				let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
			const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
			const holdSaves = () =>
				page.evaluate(() => {
					const held = window as Walk;
					held.pending = [];
					// Once the editor's chunk defines its frame, which a reload into an app may not have yet.
					void customElements.whenDefined('loam-editor-frame').then(() => {
						const frame = customElements.get('loam-editor-frame')?.prototype as {
							save(): Promise<void>;
						};
						frame.save = () =>
							new Promise<void>((resolve, reject) => {
								held.pending?.push({
									resolve,
									reject: () =>
										reject(Object.assign(new Error('Refused by the walk'), { code: 'WALK' })),
								});
							});
					});
				});
			// Counts the reopens reached, a draft taken by another tab or a reopen's own open, and holds the next of
			// those opens at a gate when asked.
			const instrument = () =>
				page.evaluate(() => {
					const held = window as Walk;
					held.reopens = 0;
					held.reopenOpens = 0;
					held.gates = [];
					const shell = document.querySelector('loam-shell') as unknown as {
						kernel: { call(name: string, input?: unknown, ...rest: unknown[]): Promise<unknown> };
						shadowRoot: ShadowRoot;
					};
					const call = shell.kernel.call.bind(shell.kernel);
					shell.kernel.call = async (name: string, input?: unknown, ...rest: unknown[]) => {
						if (name === 'document-open' && (input as { stay?: string } | undefined)?.stay) {
							held.reopenOpens = (held.reopenOpens ?? 0) + 1;
							if (held.gate) {
								held.gate = false;
								await new Promise<void>((resolve) => held.gates?.push(resolve));
							}
						}
						return call(name, input, ...rest);
					};
					new MutationObserver((records) => {
						for (const record of records) {
							const now = (record.target as HTMLElement).dataset.tab;
							if (record.oldValue && record.oldValue !== now)
								held.reopens = (held.reopens ?? 0) + 1;
						}
					}).observe(shell.shadowRoot, {
						subtree: true,
						attributeFilter: ['data-tab'],
						attributeOldValue: true,
					});
				});
			let reopens = 0;
			let reopenOpens = 0;
			const counted = async () => {
				const [taken, opens] = await page.evaluate(() => [
					(window as Walk).reopens ?? 0,
					(window as Walk).reopenOpens ?? 0,
				]);
				reopens += taken;
				reopenOpens += opens;
			};
			// Signed in, with Vault restricted to the person: a sign-out takes it out of reach.
			const signIn = () =>
				kernelCall(page, 'auth-sign-in', {
					method: 'credentials',
					email: 'person@example.com',
					password: 'x',
				});
			await signIn();
			await kernelCall(page, 'project-create', { name: 'Atlas' });
			await kernelCall(page, 'project-create', {
				name: 'Vault',
				access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
			});
			// Every document the walk makes, for its last check.
			const documents: string[] = [];
			const note = async (title: string, project?: string) => {
				const id = await createNote(page, title, project);
				documents.push(id);
				return id;
			};
			for (const title of ['One', 'Two', 'Three']) await open(page, await note(title));
			await holdSaves();
			await instrument();
			const kinds = [
				'park',
				'park',
				'take',
				'take',
				'type',
				'type',
				'type',
				'resolve',
				'reject',
				'hold',
				'switch',
				'move',
				'close',
				'mark',
				'trash',
				'relocate',
				'person-close',
				'modal',
				'pagehide',
				'held-read',
				'reload',
				'app',
				'beside',
				'pin',
				'activate',
				'stay',
				'pagehide-reject',
				'move-held',
				'round-trip',
				'type-held',
				'rename',
				'close-move',
				'close-close',
				'save-key',
				'person-close-held',
				'gate',
				'release',
				'race',
				'person-open',
				'content-set',
				'type-close',
				'type-close',
				'type-close-reject',
				'type-close-reject',
				'modal',
				'vault',
				'sign-out',
				'sign-in',
			] as const;
			// Step 12's view steps draw from a stream of their own, so each seed's steps above stay as they were.
			let viewSeed = start ^ 0x5ee712;
			const viewRandom = () => {
				viewSeed = (viewSeed + 0x6d2b79f5) | 0;
				let t = Math.imul(viewSeed ^ (viewSeed >>> 15), 1 | viewSeed);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
			const viewKinds = checklists
				? ([
						'sheet',
						'sheet-type',
						'checklist',
						'checklist-change',
						'checklist-change',
						'embed',
					] as const)
				: moves
					? (['sheet', 'sheet-type', 'sheet-type', 'embed', 'sheet-move'] as const)
					: (['sheet', 'sheet-type', 'sheet-type', 'embed'] as const);
			// The sheets the walk made, which its view moves pick from.
			const sheets = new Set<string>();
			let project: string | undefined;
			let app = false;
			const steps: string[] = [];
			for (let step = 0; step < length; step++) {
				const kind = pick(kinds);
				steps.push(kind);
				const read = (await agentCall(page, 'editor-get')) as {
					data?: { groups: Array<{ id: string; tabs: Array<{ id: string; document: string }> }> };
				};
				const groups = read.data?.groups ?? [];
				const tabs = groups.flatMap((group) => group.tabs);
				const some = () => pick(tabs);
				if (kind === 'park') {
					await kernelCall(page, 'document-open', {
						document: await note(`Walk ${step}`, project),
					});
				} else if (kind === 'take' && tabs.length > 0) {
					await kernelCall(page, 'editor-activate', { tab: some().id });
				} else if (kind === 'type') {
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					if ((await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('x');
					}
				} else if (kind === 'resolve' || kind === 'reject') {
					// Any held save, not only the oldest.
					await page.evaluate(
						({ kind, at }) => {
							const pending = (window as Walk).pending ?? [];
							pending.splice(Math.floor(at * pending.length), 1)[0]?.[kind]();
						},
						{ kind, at: random() }
					);
				} else if (kind === 'switch') {
					project = project ? undefined : 'atlas';
					await kernelCall(page, 'scope-set', { project: project ?? null });
				} else if (kind === 'move' && tabs.length > 0) {
					await agentCall(page, 'editor-move', {
						tab: some().id,
						group: random() < 0.5 ? 'new' : pick(groups).id,
					});
				} else if (kind === 'close' && tabs.length > 0) {
					await agentCall(page, 'editor-close', { tab: some().id, discard: random() < 0.5 });
				} else if (kind === 'mark' && tabs.length > 0) {
					await agentCall(page, 'editor-dirty-set', { tab: some().id, dirty: random() < 0.5 });
				} else if (kind === 'trash' && tabs.length > 0) {
					await agentCall(page, 'document-trash', { document: some().document });
				} else if (kind === 'relocate' && tabs.length > 0) {
					await agentCall(page, 'document-move', {
						document: some().document,
						project: project ? null : 'atlas',
					});
				} else if (kind === 'person-close') {
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					if ((await tab.count()) > 0) {
						await tab.focus().catch(() => undefined);
						await page.keyboard.press('Delete');
					}
				} else if (kind === 'modal') {
					const choice = page.locator('loam-modal button', {
						hasText: random() < 0.5 ? 'Discard' : 'Keep editing',
					});
					if ((await choice.count()) > 0)
						await choice
							.first()
							.click({ timeout: 500 })
							.catch(() => undefined);
				} else if (kind === 'pagehide') {
					await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
				} else if (kind === 'held-read') {
					await page.evaluate(() => {
						const shell = document.querySelector('loam-shell') as unknown as {
							kernel: { call(name: string, ...rest: unknown[]): Promise<unknown> };
						};
						const call = shell.kernel.call.bind(shell.kernel);
						let once = true;
						shell.kernel.call = async (name: string, ...rest: unknown[]) => {
							const answer = await call(name, ...rest);
							if (name === 'editor-get' && once) {
								once = false;
								await new Promise((resolve) => setTimeout(resolve, 150));
							}
							return answer;
						};
					});
				} else if (kind === 'reload') {
					await counted();
					await page.reload();
					await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
					await page.waitForTimeout(300);
					await holdSaves();
					await instrument();
					app = false;
				} else if (kind === 'app') {
					app = !app;
					await kernelCall(
						page,
						app ? 'app-open' : 'section-open',
						app ? { instance: 'hello' } : { section: 'documents' }
					);
				} else if (kind === 'beside' && tabs.length > 0) {
					await kernelCall(page, 'document-open', { document: some().document, group: 'beside' });
				} else if (kind === 'pin' && tabs.length > 0) {
					await agentCall(page, 'editor-pin', { tab: some().id, pinned: random() < 0.5 });
				} else if (kind === 'activate' && tabs.length > 0) {
					await agentCall(page, 'editor-activate', { tab: some().id });
				} else if (kind === 'stay' && tabs.length > 0) {
					await agentCall(page, 'document-open', { document: some().document, stay: 'background' });
				} else if (kind === 'pagehide-reject') {
					await page.evaluate(() => {
						window.dispatchEvent(new Event('pagehide'));
						for (const each of (window as Walk).pending?.splice(0) ?? []) each.reject();
					});
				} else if (kind === 'round-trip') {
					// The other scope's documents, and back.
					await kernelCall(page, 'scope-set', { project: project ? null : 'atlas' });
					await kernelCall(page, 'section-open', { section: 'documents' });
					await editorIdle(page).catch((cause) => {
						throw new Error(
							`Seed ${start}, step ${step} (${kind}, away): ${(cause as Error).message}. Steps: ${steps.join(', ')}`
						);
					});
					await kernelCall(page, 'scope-set', { project: project ?? null });
					await kernelCall(page, 'section-open', { section: 'documents' });
				} else if (kind === 'type-held' || kind === 'save-key') {
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					if ((await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						if (kind === 'type-held') await page.keyboard.type('h');
						else await page.keyboard.press('ControlOrMeta+s');
					}
				} else if (kind === 'rename' && tabs.length > 0) {
					await kernelCall(page, 'document-rename', {
						document: some().document,
						title: `Renamed ${step}`,
					});
				} else if (kind === 'close-move' && tabs.length > 1) {
					await agentCall(page, 'editor-close', { tab: some().id, discard: true });
					await agentCall(page, 'editor-move', { tab: some().id, group: 'new' });
				} else if (kind === 'close-close' && tabs.length > 0) {
					const tab = some().id;
					await agentCall(page, 'editor-close', { tab, discard: true });
					await agentCall(page, 'editor-close', { tab, discard: true });
				} else if (kind === 'person-close-held') {
					if (await page.evaluate(() => ((window as Walk).pending?.length ?? 0) > 0)) {
						const tab = page
							.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
							.first();
						if ((await tab.count()) > 0) {
							await tab.focus().catch(() => undefined);
							await page.keyboard.press('Delete');
						}
					}
				} else if (kind === 'vault') {
					project = 'vault';
					await kernelCall(page, 'scope-set', { project: 'vault' });
					await kernelCall(page, 'section-open', { section: 'documents' });
				} else if (kind === 'sign-out') {
					await agentCall(page, 'auth-sign-out');
				} else if (kind === 'sign-in') {
					await signIn();
				} else if (kind === 'gate') {
					await page.evaluate(() => {
						(window as Walk).gate = true;
					});
				} else if (kind === 'release') {
					await page.evaluate(() => {
						for (const release of (window as Walk).gates?.splice(0) ?? []) release();
					});
				} else if (kind === 'race') {
					// Typing, the person's close and an agent's close of the same tab, none waited for.
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					const id = (await tab.count()) > 0 ? await tab.getAttribute('data-tab') : null;
					if (id && (await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('r');
						await tab.focus().catch(() => undefined);
						await page.keyboard.press('Delete');
						await agentCall(page, 'editor-close', { tab: id, discard: true });
					}
				} else if (kind === 'type-close' || kind === 'type-close-reject') {
					// A draft an agent's close takes, its save held: what a reopen brings back when that save rejects.
					const tab = page
						.locator('loam-editor-group:not([hidden]) [role="tab"][aria-selected="true"]')
						.first();
					const area = page
						.locator('loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) textarea')
						.first();
					const id = (await tab.count()) > 0 ? await tab.getAttribute('data-tab') : null;
					if (id && (await area.count()) > 0) {
						await area.click({ timeout: 500 }).catch(() => undefined);
						await page.keyboard.type('c');
						await agentCall(page, 'editor-close', { tab: id, discard: random() < 0.5 });
						// Its leave's save, the newest held, rejects at once: the reopen runs while the area shows.
						if (kind === 'type-close-reject') {
							await page.waitForTimeout(50);
							await page.evaluate(() => (window as Walk).pending?.pop()?.reject());
						}
					}
				} else if (kind === 'person-open' && tabs.length > 0) {
					// On an even step, through the documents section's tree, as the person presses its row (step
					// 11): a preview, or the tab kept when it already is one. With no draw of its own, so each
					// seed's draws are what they were.
					const document = some().document;
					const pressed =
						step % 2 === 0 &&
						!app &&
						(await page.evaluate((document) => {
							const tree = document
								? (globalThis.document
										.querySelector('loam-shell')
										?.shadowRoot?.querySelector('loam-documents-sidebar')
										?.shadowRoot?.querySelector('loam-tree') ?? null)
								: null;
							const label = tree?.shadowRoot?.querySelector<HTMLElement>(
								`violet-tree-item[data-id="recent:${document}"] > .label`
							);
							label?.click();
							return label !== undefined && label !== null;
						}, document));
					if (!pressed) await kernelCall(page, 'document-open', { document });
				} else if (kind === 'content-set' && tabs.length > 0) {
					await agentCall(page, 'notes-content-set', {
						document: some().document,
						text: `Agent ${step}`,
					});
				} else if (kind === 'move-held' && tabs.length > 0) {
					// A tab moved while a save is held, of its editor or another's.
					if (await page.evaluate(() => ((window as Walk).pending?.length ?? 0) > 0)) {
						await agentCall(page, 'editor-move', { tab: some().id, group: 'new' });
					}
				}
				// A view step, on about one step in six in the seeds that take them: a sheet's editor opened, typed
				// into, or an embed.
				if (viewRandom() < views) {
					const view = viewKinds[Math.floor(viewRandom() * viewKinds.length)] as string;
					const other = () => tabs[Math.floor(viewRandom() * tabs.length)] as (typeof tabs)[number];
					steps.push(view);
					if (view === 'sheet') {
						// A view's editor, in a sandboxed frame: hidden, it saves and is torn down (5.6).
						const created = (await kernelCall(page, 'document-create', {
							type: 'sheet',
							title: `Sheet ${step}`,
							...(project ? { project } : {}),
						})) as { data?: { id: string } };
						if (created.data) {
							documents.push(created.data.id);
							sheets.add(created.data.id);
							await kernelCall(page, 'document-open', { document: created.data.id });
						}
					} else if (view === 'sheet-type') {
						// Into a view editor a person sees, inside its frame, which reports dirty to the shell.
						await page
							.frameLocator(
								'loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) loam-view-frame iframe'
							)
							.first()
							.frameLocator('iframe')
							.locator('#text')
							.pressSequentially('y', { timeout: 1_000 })
							.catch(() => undefined);
					} else if (view === 'checklist') {
						// The second type's editor, a view that holds no draft: every change a command at once.
						const created = (await kernelCall(page, 'document-create', {
							type: 'checklist',
							title: `Checklist ${step}`,
							...(project ? { project } : {}),
						})) as { data?: { id: string } };
						if (created.data) {
							documents.push(created.data.id);
							await kernelCall(page, 'document-open', { document: created.data.id });
						}
					} else if (view === 'checklist-change') {
						// Inside a checklist a person sees: tick its first item, or add one.
						const inner = page
							.frameLocator(
								'loam-editor-group:not([hidden]) loam-editor-frame:not([hidden]) loam-view-frame iframe'
							)
							.first()
							.frameLocator('iframe');
						const first = inner.locator('#items button.item').first();
						if (viewRandom() < 0.5 && (await first.count().catch(() => 0)) > 0)
							await first.click({ timeout: 1_000 }).catch(() => undefined);
						else
							await inner
								.locator('#new-item')
								.fill(`Item ${step}`, { timeout: 1_000 })
								.then(() => inner.locator('#new-item').press('Enter', { timeout: 1_000 }))
								.catch(() => undefined);
					} else if (view === 'sheet-move') {
						// An agent moves a view editor's tab: with `moveBefore` its frame keeps its window and draft;
						// without, as seed 77 walks, it is moved back unsaved (5.6; the re-check's N-B1).
						const held = tabs.filter((tab) => sheets.has(tab.document));
						const tab = held[Math.floor(viewRandom() * held.length)];
						if (tab)
							await agentCall(page, 'editor-move', {
								tab: tab.id,
								group:
									viewRandom() < 0.5
										? 'new'
										: (groups[Math.floor(viewRandom() * groups.length)]?.id ?? 'new'),
							});
					} else if (tabs.length > 1) {
						// An agent embeds one open document in another, which a note shows read-only.
						await agentCall(page, 'notes-content-set', {
							document: other().document,
							text: `Embeds ${step}`,
							embeds: [other().document],
						});
					}
				}
				try {
					await editorIdle(page);
				} catch (cause) {
					throw new Error(
						`Seed ${start}, step ${step} (${kind}): ${(cause as Error).message}. Steps: ${steps.join(', ')}`
					);
				}
			}
			// Everything settles: gates open, held saves reject, and every modal a close opens is answered Discard,
			// until nothing is held.
			for (let round = 0; round < 10; round++) {
				// Signed in, so Vault can be read, and the documents area, where a kept draft comes back.
				await signIn();
				await kernelCall(page, 'section-open', { section: 'documents' });
				await page.evaluate(() => {
					for (const release of (window as Walk).gates?.splice(0) ?? []) release();
					for (const each of (window as Walk).pending?.splice(0) ?? []) each.reject();
				});
				await editorIdle(page);
				const discard = page.locator('loam-modal button', { hasText: 'Discard' });
				const asked = (await discard.count()) > 0;
				if (asked)
					await discard
						.first()
						.click({ timeout: 1000 })
						.catch(() => undefined);
				await editorIdle(page);
				// Settled once nothing is held, asked, leaving or closing.
				const busy = await page.evaluate(() => {
					const shell = document.querySelector('loam-shell') as unknown as {
						editor?: { lifecycle: readonly unknown[] };
					};
					const life = shell.editor?.lifecycle;
					return (
						((window as Walk).pending?.length ?? 0) +
						((life?.[3] as Set<unknown> | undefined)?.size ?? 0) +
						((life?.[7] as Set<unknown> | undefined)?.size ?? 0)
					);
				});
				if (!asked && busy === 0) break;
				await page.waitForTimeout(200);
			}
			expect(await frameViolations(page)).toEqual([]);
			// Every scope: every tab's mark is the rule's answer, and a trash of every document the walk made
			// meets EDITOR_TAB_DIRTY only for an open tab the rule marks.
			const marks = await marksOf(page, [null, 'atlas', 'vault']);
			expect(
				marks.filter((each) => each.dirty !== each.wants),
				`Seed ${start}: marks the rule does not give. Steps: ${steps.join(', ')}`
			).toEqual([]);
			for (const id of documents) {
				const trash = (await agentCall(page, 'document-trash', { document: id })) as {
					error?: { code: string; message?: string };
				};
				if (trash.error?.code !== 'EDITOR_TAB_DIRTY') continue;
				const tab = /tab (t\d+)/.exec(trash.error.message ?? '')?.[1];
				const held = marks.some((each) => each.tab === tab && each.document === id && each.wants);
				const state = held
					? ''
					: await page.evaluate(() => {
							const shell = document.querySelector('loam-shell') as unknown as {
								editor?: { lifecycle: readonly unknown[] };
							};
							const life = shell.editor?.lifecycle;
							if (!life) return 'no editor area loaded';
							return JSON.stringify({
								leaving: [...(life[3] as Set<{ tab: string }>)].map((each) => each.tab),
								asking: [...(life[7] as Set<string>)],
								owed: [...(life[8] as Map<string, unknown>).keys()],
								stalled: [...(life[9] as Set<string>)],
							});
						});
				expect(
					held,
					`Seed ${start}: ${id} is refused for ${tab}, which is no open tab the rule marks: ${(trash.error as { suggestion?: string }).suggestion} ${state} ${JSON.stringify(marks)}. Steps: ${steps.join(', ')}`
				).toBe(true);
			}
			await counted();
			// A seed that takes view steps takes some.
			if (views > 0)
				expect(steps.some((each) => (viewKinds as readonly string[]).includes(each))).toBe(true);
			// The second type's seed opens checklists and changes them, through their frames.
			if (checklists) {
				expect(new Set(steps.filter((each) => each.startsWith('checklist')))).toEqual(
					new Set(['checklist', 'checklist-change'])
				);
				const changed = (await journal(page)).filter(
					(entry) => entry.command.startsWith('checklist-item-') && entry.success
				);
				expect(changed.length).toBeGreaterThan(0);
			}
			// Straight to the output, so every seed's count shows, passing or not.
			process.stdout.write(
				`Seed ${start}: ${reopens} drafts taken by another tab, ${reopenOpens} reopen opens, ${steps.filter((each) => (viewKinds as readonly string[]).includes(each)).length} view steps\n`
			);
			expect(reopens + reopenOpens).toBeGreaterThanOrEqual(REOPEN_FLOOR);
			await opened.context.close();
		},
		600_000
	);
});
