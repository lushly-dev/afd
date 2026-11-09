/**
 * What the documents suites share (documents specification, 14): a deployment with `notes`, reads of the
 * editor area through its shadow roots, and a replay of the page's journal with notes' real handlers.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	createFixedEnvironment,
	createFixturePorts,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import type { Page } from 'playwright';
import {
	APPS,
	type AxeViolation,
	axe,
	type DeploymentSite,
	kernelCall,
	packApp,
	settle,
} from '../harness';

/** What one group of the editor area shows. */
export interface GroupView {
	label: string;
	tabs: Array<{ name: string; selected: boolean; title: string }>;
	/** The text of each frame's `notes-editor`, by tab, for the frames mounted. */
	editors: Array<{ tab: string; hidden: HTMLElement['hidden']; text: string | null }>;
}

/** The editor area as it renders: each group's strip and frames, or null when main does not show it. */
export function editorView(page: Page): Promise<GroupView[] | null> {
	return page.evaluate(() => {
		const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
		const area = main?.querySelector('loam-editor-area:not([hidden])');
		if (!area) return null;
		return [...area.querySelectorAll('loam-editor-group')].map((group) => {
			const list = group.shadowRoot?.querySelector('[role="tablist"]');
			return {
				label: list?.getAttribute('aria-label') ?? '',
				tabs: [...(list?.querySelectorAll('[role="tab"]') ?? [])].map((tab) => ({
					name: tab.getAttribute('aria-label') ?? '',
					selected: tab.getAttribute('aria-selected') === 'true',
					title: tab.querySelector('.title')?.textContent ?? '',
				})),
				editors: [...group.querySelectorAll('loam-editor-frame')].map((frame) => {
					const editor = frame
						.querySelector('loam-mount')
						?.shadowRoot?.querySelector('notes-editor') as
						| (HTMLElement & { draft?: string })
						| null;
					return {
						tab: (frame as unknown as { tab: string }).tab,
						hidden: (frame as HTMLElement).hidden,
						text: editor ? (editor.draft ?? null) : null,
					};
				}),
			};
		});
	});
}

/**
 * The editor area's thirteen invariants (documents specification, Status, deviation 16), as its controller holds
 * them, checked after every `editorIdle`:
 * 1. every frame in `frames` or `parking` is of this visit of the scope rendered, in its place for that map,
 *    under its own tab;
 * 2. no frame is in both maps;
 * 3. none in a map is disposed, or off the page while the area shows;
 * 4. a mounted frame in no map has its save or its reopen under way;
 * 5. every tab the active scope marks unsaved has a frame in a map, a leave under way, or the person's own
 *    close running, or saving or asking, of any visit;
 * 6. a group shows at most one frame, its active tab's, and no leaving or parked frame shows;
 * 7. every key of `frames` and `parking` is a tab of the state rendered, and of the kernel's own read, but for
 *    a close of the person's under way;
 * 8. every group's active tab has a frame in `frames`, unless its close or leave is under way;
 * 9. a frame in `frames` whose editor says unsaved has its tab marked unsaved;
 * 10. a tab of the active scope whose leaving frame of that scope, still saving its document unsaved, is
 *     marked unsaved, whatever a newer editor of the tab says;
 * 11. a marked tab whose editor of this visit is ready and clean has an older leaving editor of the same tab,
 *     document and scope whose save is under way, or the person's own close of it saving or asking;
 * 12. for the active scope, each tab's mark is `wantsMark`: its editor, shown or parked, says unsaved, a leave of
 *     that tab, document and scope still holds its draft, or the person's close of it saves or asks. 5, 9, 10
 *     and 11 follow from it, and stay as diagnostics;
 * 13. no tab a leave still owes a mark has `wantsMark` false, but in a scope out of reach, and
 *     every tab marked in a scope with a leave in flight has `wantsMark` true or is owed;
 * 14. a view's editor in `frames` is its group's shown frame, or hidden and kept: its save rejected as its tab
 *     hid, it holds its draft, unsaved, with no edit since, until its tab shows again, or held where it is while
 *     it saves before a move, where the browser has no `moveBefore` (5.6; step 12);
 * 15. a view editor's frame keeps its window while it holds unsaved work: a new window then, its frame moved
 *     or detached and attached again, would have lost the draft; a clean view may start again, and so may one
 *     the controller saved before a move with no `moveBefore` (5.6; step 12's review G-B1 and re-check N-B1).
 * Empty when they hold, or before the editor area has loaded.
 */
export function frameViolations(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		type Frame = HTMLElement & {
			tab: string;
			document: string;
			dirty: boolean;
			state?: string;
			kind?: 'native' | 'view';
			record?: { scope: { workspace: string; project?: string } } | null;
		};
		type Life = {
			visit: number;
			place: string;
			busy?: boolean;
			draft?: boolean;
			edits?: number;
			kept?: number;
			moving?: boolean;
		};
		type State = {
			groups: Array<{ id: string; active: string | null; tabs: Array<{ id: string }> }>;
		};
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: {
				call(
					name: string,
					input?: unknown,
					options?: unknown
				): Promise<{ data?: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean }> }> } }>;
			};
			shadowRoot: ShadowRoot | null;
			editor?: {
				lifecycle: readonly [
					number,
					Map<string, Frame>,
					Map<string, Frame>,
					Set<Frame>,
					WeakMap<Frame, Life>,
					Set<string>,
					State | null,
					Set<string>,
					Map<string, [{ workspace: string; project?: string }, string]>,
					Set<string>,
				];
			};
		};
		const lifecycle = shell.editor?.lifecycle;
		if (!lifecycle) return [];
		const [visit, frames, parking, leaving, lives, closing, rendered, asking, owed, stalled] =
			lifecycle;
		const broken: string[] = [];
		const parked = new Set(parking.values());
		const main = shell.shadowRoot?.querySelector('loam-main');
		// An app's main keeps the editors off the page, with their drafts (Status, deviation 13).
		const showing = !!main?.querySelector('loam-editor-area:not([hidden])');
		const tabs = new Set(
			rendered?.groups.flatMap((group) => group.tabs.map((tab) => tab.id)) ?? []
		);
		// A leaving frame of this visit, or of the scope active in any visit, still saving its draft.
		const active = (
			await (shell.kernel.call('scope-get') as unknown as Promise<{
				data?: { scope?: { workspace?: string; project?: string } };
			}>)
		).data?.scope;
		const leavingHere = (tab: string) =>
			[...leaving].some(
				(frame) =>
					frame.tab === tab &&
					(lives.get(frame)?.visit === visit ||
						(frame.record?.scope.workspace === active?.workspace &&
							frame.record?.scope.project === active?.project))
			);
		const closingHere = (tab: string) => closing.has(`${visit} ${tab}`);
		for (const [name, map, place] of [
			['frames', frames, 'shown'],
			['parking', parking, 'parked'],
		] as const) {
			for (const [tab, frame] of map) {
				const own = lives.get(frame);
				if (own?.visit !== visit)
					broken.push(`1: ${name} ${tab} is of visit ${own?.visit}, not ${visit}`);
				if (own?.place !== place) broken.push(`1: ${name} ${tab} is ${own?.place}`);
				if (frame.tab !== tab) broken.push(`1: ${name} ${tab} holds the frame of ${frame.tab}`);
				if (name === 'frames' && parked.has(frame)) broken.push(`2: ${tab} is in both maps`);
				if (showing && !frame.isConnected) broken.push(`3: ${name} ${tab} is off the page`);
				if (rendered && !tabs.has(tab))
					broken.push(`7: ${name} ${tab} is no tab of the state rendered`);
			}
		}
		const mounted = [...(main?.querySelectorAll('loam-editor-frame') ?? [])] as Frame[];
		for (const frame of mounted) {
			const own = lives.get(frame);
			if (own?.place === 'disposed') broken.push(`3: a disposed frame of ${frame.tab} is mounted`);
			if (frames.get(frame.tab) !== frame && parking.get(frame.tab) !== frame && !own?.busy) {
				broken.push(
					`4: a mounted frame of ${frame.tab} is in no map, with no save or reopen under way`
				);
			}
			if (!frame.hidden && own?.place !== 'shown')
				broken.push(`6: a ${own?.place} frame of ${frame.tab} shows`);
		}
		if (showing && rendered) {
			for (const group of main?.querySelectorAll('loam-editor-group') ?? []) {
				const id = (group as HTMLElement & { group: string }).group;
				const active = rendered.groups.find((each) => each.id === id)?.active;
				const shown = ([...group.children] as Frame[]).filter(
					(child) => child.localName === 'loam-editor-frame' && !child.hidden
				);
				if (shown.length > 1) broken.push(`6: group ${id} shows ${shown.length} frames`);
				if (shown[0] && shown[0].tab !== active)
					broken.push(`6: group ${id} shows ${shown[0].tab}, not ${active}`);
			}
			for (const group of rendered.groups) {
				if (!group.active || frames.has(group.active)) continue;
				if (!closingHere(group.active) && !leavingHere(group.active)) {
					broken.push(`8: group ${group.id}'s active tab ${group.active} has no frame`);
				}
			}
		}
		const read = (await shell.kernel.call('editor-get')) as {
			data?: { groups: Array<{ tabs: Array<{ id: string; dirty: boolean; document: string }> }> };
		};
		const listed = read.data?.groups.flatMap((group) => group.tabs) ?? [];
		// The state rendered goes stale while an app shows; the kernel's read does not.
		for (const [name, map] of [
			['frames', frames],
			['parking', parking],
		] as const) {
			for (const tab of map.keys()) {
				if (!listed.some((each) => each.id === tab) && !closingHere(tab))
					broken.push(`7: ${name} ${tab} is no tab the kernel lists`);
			}
		}
		type Scope = { workspace?: string; project?: string | null } | undefined;
		const keyOf = (scope: Scope) => `${scope?.workspace} ${scope?.project ?? ''}`;
		const key = keyOf(active);
		// `wantsMark`, as the documents specification states it, of a tab of any scope.
		const wantsOf = (scope: Scope, tab: string, document?: string) => {
			const frame = keyOf(scope) === key ? (frames.get(tab) ?? parking.get(tab)) : undefined;
			return (
				(!!frame?.dirty && (document ?? frame.document) === frame.document) ||
				asking.has(`${keyOf(scope)} ${tab}`) ||
				[...leaving].some(
					(each) =>
						each.tab === tab &&
						(document ?? each.document) === each.document &&
						!!lives.get(each)?.draft &&
						keyOf(each.record?.scope) === keyOf(scope)
				)
			);
		};
		const marked = new Map(listed.map((tab) => [tab.id, tab.dirty]));
		for (const frame of leaving) {
			const own = lives.get(frame);
			const tab = listed.find((each) => each.id === frame.tab && each.document === frame.document);
			const ofScope =
				frame.record?.scope.workspace === active?.workspace &&
				frame.record?.scope.project === active?.project;
			if (tab && own?.busy && frame.dirty && ofScope && !tab.dirty) {
				broken.push(
					`10: ${tab.id} has a leaving editor still saving it unsaved, and is not marked`
				);
			}
		}
		for (const [tab, dirty] of marked) {
			if (!dirty || closingHere(tab) || asking.has(`${key} ${tab}`)) continue;
			if (!frames.has(tab) && !parking.has(tab) && !leavingHere(tab)) {
				broken.push(`5: ${tab} is unsaved with no frame and no leave`);
			}
		}
		for (const [tab, frame] of frames) {
			if (lives.get(frame)?.visit !== visit || frame.state !== 'ready' || frame.dirty) continue;
			if (marked.get(tab) !== true || asking.has(`${key} ${tab}`)) continue;
			const older = [...leaving].some(
				(each) =>
					each !== frame &&
					each.tab === tab &&
					each.document === frame.document &&
					!!lives.get(each)?.busy &&
					each.record?.scope.workspace === active?.workspace &&
					each.record?.scope.project === active?.project
			);
			if (!older)
				broken.push(
					`11: ${tab} is marked, its editor ready and clean, with no older save under way`
				);
		}
		for (const tab of listed) {
			const wants = wantsOf(active, tab.id, tab.document);
			if (wants !== tab.dirty)
				broken.push(`12: ${tab.id} is marked ${tab.dirty}, wantsMark ${wants}`);
		}
		const inFlight = new Map<string, Scope>();
		for (const [, [scope]] of owed) inFlight.set(keyOf(scope), scope);
		for (const each of leaving)
			if (each.record) inFlight.set(keyOf(each.record.scope), each.record.scope);
		const reads = new Map<string, typeof read>();
		for (const [scopeKey, scope] of inFlight)
			reads.set(scopeKey, (await shell.kernel.call('editor-get', {}, { scope })) as typeof read);
		for (const [owedKey, [scope, tab]] of owed) {
			// A scope out of reach, its read or a clear refused, keeps what it owes until a later sync (deviation 16).
			if (stalled.has(keyOf(scope))) continue;
			if (!(reads.get(keyOf(scope)) as { success?: boolean } | undefined)?.success) continue;
			if (!wantsOf(scope, tab)) broken.push(`13: ${owedKey} is owed, and wantsMark is false`);
		}
		for (const [scopeKey, scope] of inFlight) {
			for (const tab of reads.get(scopeKey)?.data?.groups.flatMap((group) => group.tabs) ?? []) {
				if (
					tab.dirty &&
					!wantsOf(scope, tab.id, tab.document) &&
					!owed.has(`${scopeKey} ${tab.id}`)
				)
					broken.push(
						`13: ${scopeKey} ${tab.id} is marked, with a leave in flight, unwanted and unowed`
					);
			}
		}
		if (showing) {
			for (const [tab, frame] of frames) {
				if (frame.dirty && marked.get(tab) === false)
					broken.push(`9: ${tab}'s editor is unsaved, its tab not`);
			}
		}
		for (const [tab, frame] of frames) {
			const own = lives.get(frame);
			if (frame.kind !== 'view' || !frame.hidden) continue;
			// Or held where it is while it saves before a move, in a browser with no `moveBefore`, or after its move
			// back was refused, until another move.
			if (own?.moving || (own as { refused?: boolean } | undefined)?.refused) continue;
			if (!frame.dirty || own?.kept === undefined || own.kept !== own.edits)
				broken.push(`14: ${tab}'s view editor is hidden in frames, and not kept with its draft`);
		}
		// 15: a view editor's frame keeps its window while it holds unsaved work, from one check to the next: a
		// clean view may start again, and a reload the controller counts, a saved move with no `moveBefore`, may.
		const holder = window as unknown as {
			viewWindows?: WeakMap<Element, { window: unknown; dirty: boolean; reloads: number }>;
		};
		holder.viewWindows = holder.viewWindows ?? new WeakMap();
		const windows = holder.viewWindows;
		for (const frame of mounted) {
			const iframe = frame.querySelector('loam-view-frame')?.shadowRoot?.querySelector('iframe');
			if (!iframe?.isConnected || !iframe.contentWindow) continue;
			const own = lives.get(frame) as
				| { reloads?: number; edits?: number; savedEdits?: number }
				| undefined;
			const reloads = own?.reloads ?? 0;
			const known = windows.get(frame);
			// Exempt only a reload the controller made with every edit saved: none typed during its save (S3).
			const verified = known?.reloads !== reloads && own?.savedEdits === own?.edits;
			if (known?.dirty && known.window !== iframe.contentWindow && !verified)
				broken.push(`15: ${frame.tab}'s view editor has a new window, its unsaved work gone`);
			windows.set(frame, { window: iframe.contentWindow, dirty: frame.dirty, reloads });
		}
		return broken;
	});
}

/** Wait until the area's editors are idle: its controller's queue, then the journal. */
export async function editorIdle(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			apps: { idle: Promise<void> } | null;
			editor?: { idle: Promise<void> };
		};
		await shell.apps?.idle;
		// Until its queue holds still: a render's own marks may queue another; one that never does is a fault.
		for (let round = 0; ; round++) {
			if (round === 20) throw new Error("The editor area's queue did not settle in 20 rounds");
			const queued = shell.editor?.idle;
			await queued;
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			if (shell.editor?.idle === queued) break;
		}
	});
	await settle(page);
	const broken = await frameViolations(page);
	if (broken.length > 0)
		throw new Error(`The editor's frames broke an invariant: ${broken.join('; ')}`);
}

/** Open `document` and wait for its editor. */
export async function open(page: Page, id: string, options: Record<string, unknown> = {}) {
	await kernelCall(page, 'document-open', { document: id, ...options });
	await editorIdle(page);
	await page.waitForFunction(() => {
		const area = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main')
			?.querySelector('loam-editor-area:not([hidden])');
		return [...(area?.querySelectorAll('loam-editor-frame:not([hidden])') ?? [])].every(
			(frame) => (frame as unknown as { state: string }).state !== 'loading'
		);
	});
}

/** What the seeded walk, and the tests that hold every save, leave on the page. */
export type Walk = Window & {
	pending?: Array<{ resolve: () => void; reject: () => void }>;
	reopens?: number;
	reopenOpens?: number;
	gate?: boolean;
	gates?: Array<() => void>;
};

/** One tab of a scope, its mark, and whether `wantsMark` holds for it. */
export interface TabMark {
	scope: string;
	tab: string;
	document: string;
	dirty: boolean;
	wants: boolean;
}

/**
 * Every tab of each project named by slug (null for the workspace), with the kernel's mark and the rule's
 * answer as the documents specification states it: its editor, shown or parked, of its document, says
 * unsaved; a leave of that tab, document and scope holds its draft; or the person's close of it saves or asks.
 */
export function marksOf(page: Page, projects: Array<string | null>): Promise<TabMark[]> {
	return page.evaluate(async (projects) => {
		type Scope = { workspace?: string; project?: string | null } | undefined;
		type Frame = HTMLElement & {
			tab: string;
			document: string;
			dirty: boolean;
			record?: { scope: Scope } | null;
		};
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: { call(name: string, input?: unknown, options?: unknown): Promise<unknown> };
			editor?: { lifecycle: readonly unknown[] };
		};
		const keyOf = (scope: Scope) => `${scope?.workspace} ${scope?.project ?? ''}`;
		const active = ((await shell.kernel.call('scope-get')) as { data?: { scope?: Scope } }).data
			?.scope;
		const list = (
			(await shell.kernel.call('project-list')) as {
				data?: { projects?: Array<{ id: string; slug: string }> };
			}
		).data?.projects;
		const [, frames, parking, leaving, lives, , , asking] = (shell.editor?.lifecycle ?? []) as [
			number,
			Map<string, Frame>,
			Map<string, Frame>,
			Set<Frame>,
			WeakMap<Frame, { draft?: boolean }>,
			unknown,
			unknown,
			Set<string>,
		];
		const wantsOf = (scope: Scope, tab: string, document: string) => {
			const frame =
				keyOf(scope) === keyOf(active) ? (frames?.get(tab) ?? parking?.get(tab)) : undefined;
			return (
				(!!frame?.dirty && frame.document === document) ||
				!!asking?.has(`${keyOf(scope)} ${tab}`) ||
				[...(leaving ?? [])].some(
					(each) =>
						each.tab === tab &&
						each.document === document &&
						!!lives?.get(each)?.draft &&
						keyOf(each.record?.scope) === keyOf(scope)
				)
			);
		};
		const marks: TabMark[] = [];
		for (const slug of projects) {
			const project = slug === null ? undefined : list?.find((each) => each.slug === slug)?.id;
			if (slug !== null && !project) continue;
			const scope = project
				? { workspace: active?.workspace, project }
				: { workspace: active?.workspace };
			const read = (await shell.kernel.call('editor-get', {}, { scope })) as {
				data?: { groups: Array<{ tabs: Array<{ id: string; document: string; dirty: boolean }> }> };
			};
			for (const group of read.data?.groups ?? [])
				for (const tab of group.tabs)
					marks.push({
						scope: keyOf(scope),
						tab: tab.id,
						document: tab.document,
						dirty: tab.dirty,
						wants: wantsOf(scope, tab.id, tab.document),
					});
		}
		return marks;
	}, projects);
}

/** Type into the `notes-editor` of a tab, as a person does: its text area takes focus, then keys. */
export async function typeInto(page: Page, tab: string, text: string): Promise<void> {
	await page.locator(`loam-editor-frame[data-tab="${tab}"] textarea`).click();
	await page.keyboard.type(text);
}

/** A note, created through the person's interface, with its id. */
export async function createNote(page: Page, title: string, project?: string): Promise<string> {
	const created = (await kernelCall(page, 'document-create', {
		type: 'notes',
		title,
		...(project !== undefined ? { project } : {}),
	})) as { data?: { id: string } };
	return created.data?.id as string;
}

/** The page's journal, whole. */
export function entriesOf(page: Page): Promise<JournalEntry[]> {
	return page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<JournalEntry[]> };
		};
		return shell.journal.read();
	}) as Promise<JournalEntry[]>;
}

/** The ports a replay imports notes' real handlers through. */
async function replayPorts() {
	const packages: Record<string, { manifest: unknown; definition: unknown }> = {};
	for (const app of ['hello', 'notes'] as const) {
		packages[`apps/${app}/`] = {
			manifest: JSON.parse(await readFile(join(await packApp(app), 'app-manifest.json'), 'utf8')),
			definition: (await import(/* @vite-ignore */ join(APPS, app, 'dist/native.js'))).default,
		};
	}
	return createFixturePorts(packages as never);
}

/** Replay the page's journal, and the entries that did not replay the same. */
export async function replayDifferences(site: DeploymentSite, entries: JournalEntry[]) {
	const { report } = await replayKernel(entries, {
		environment: createFixedEnvironment(),
		deployment: site.projection,
		ports: await replayPorts(),
	});
	return report.entries.filter(({ status }) => status !== 'same');
}

/**
 * Axe once every animation and transition in the page and its shadow roots has finished, so no color is
 * sampled half way through a change, as forced colors switching starts one. Never a retry. An animation
 * with no end, a spinner's, is not waited for; one still running after `deadline` fails the test, named.
 */
export async function settledAxe(page: Page, deadline = 5_000): Promise<AxeViolation[]> {
	await page.evaluate(async (deadline) => {
		const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
		const running = () => {
			const roots: Array<Document | ShadowRoot> = [document];
			const walk = (root: Document | ShadowRoot) => {
				for (const element of root.querySelectorAll('*')) {
					if (element.shadowRoot) {
						roots.push(element.shadowRoot);
						walk(element.shadowRoot);
					}
				}
			};
			walk(document);
			return roots
				.flatMap((root) => root.getAnimations())
				.filter(
					(animation) =>
						(animation.playState === 'running' || animation.pending) &&
						animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY
				);
		};
		let over = false;
		const settled = (async () => {
			while (!over) {
				await frame();
				await frame();
				const now = running();
				if (now.length === 0) return;
				await Promise.all(now.map((animation) => animation.finished.catch(() => undefined)));
			}
		})();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				const names = running().map((animation) => {
					const target = (animation.effect as KeyframeEffect | null)?.target;
					const name =
						(animation as CSSAnimation).animationName ??
						(animation as CSSTransition).transitionProperty ??
						animation.id;
					return `${target?.localName ?? '?'}${target?.className ? `.${target.className}` : ''} ${name}`;
				});
				reject(new Error(`Animations still running after ${deadline} ms: ${names.join(', ')}`));
			}, deadline);
		});
		try {
			await Promise.race([settled, late]);
		} finally {
			over = true;
			clearTimeout(timer);
		}
	}, deadline);
	return axe(page);
}
