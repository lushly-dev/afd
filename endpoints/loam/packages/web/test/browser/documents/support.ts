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
		const area = main?.querySelector('loam-editor-area');
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

/** Wait until the area's editors are idle: its controller's queue, then the journal. */
export async function editorIdle(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			apps: { idle: Promise<void> } | null;
			editor?: { idle: Promise<void> };
		};
		await shell.apps?.idle;
		await shell.editor?.idle;
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await settle(page);
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
